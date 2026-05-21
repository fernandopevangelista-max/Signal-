require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'signal2025';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Database ──────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS segmentos (
        id        SERIAL PRIMARY KEY,
        nome      TEXT NOT NULL UNIQUE,
        descricao TEXT,
        ativo     SMALLINT NOT NULL DEFAULT 1,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tipos (
        id        SERIAL PRIMARY KEY,
        nome      TEXT NOT NULL UNIQUE,
        label     TEXT NOT NULL,
        ativo     SMALLINT NOT NULL DEFAULT 1,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS registros (
        id            SERIAL PRIMARY KEY,
        atendente     TEXT NOT NULL,
        matricula     TEXT NOT NULL,
        segmento_id   INTEGER NOT NULL REFERENCES segmentos(id),
        tipo          TEXT NOT NULL,
        titulo        TEXT NOT NULL,
        descricao     TEXT NOT NULL,
        sugestao      TEXT,
        impacto       TEXT NOT NULL CHECK(impacto IN ('baixo','medio','alto')),
        status        TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo','lido','em_analise','implementado','descartado')),
        criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_registros_segmento  ON registros(segmento_id);
      CREATE INDEX IF NOT EXISTS idx_registros_tipo      ON registros(tipo);
      CREATE INDEX IF NOT EXISTS idx_registros_status    ON registros(status);
      CREATE INDEX IF NOT EXISTS idx_registros_criado_em ON registros(criado_em);
    `);

    const { rows: [{ c: segCount }] } = await client.query('SELECT COUNT(*)::int AS c FROM segmentos');
    if (segCount === 0) {
      await client.query(`
        INSERT INTO segmentos (nome, descricao) VALUES
          ('Vivo Fixo - Ilha Cobre', 'Atendimento Vivo Fixo — Ilha Cobre'),
          ('Vivo Móvel',             'Atendimento Vivo Móvel'),
          ('Perda e Roubo',          'Atendimento Perda e Roubo'),
          ('Portabilidade',          'Atendimento Portabilidade'),
          ('Corporativo',            'Atendimento Corporativo')
        ON CONFLICT DO NOTHING
      `);
    }

    const { rows: [{ c: tipCount }] } = await client.query('SELECT COUNT(*)::int AS c FROM tipos');
    if (tipCount === 0) {
      await client.query(`
        INSERT INTO tipos (nome, label) VALUES
          ('melhoria',     'Sugestão de melhoria de processo'),
          ('impacto',      'Problema/impacto no dia'),
          ('erro_sistema', 'Erro de sistema/ferramenta'),
          ('outro',        'Outro')
        ON CONFLICT DO NOTHING
      `);
    }
  } finally {
    client.release();
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (NODE_ENV === 'development') {
  app.use(cors({ origin: /localhost/ }));
}

app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitize(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

// Build parameterized WHERE filters for registros
function buildRegistrosFilters({ segmento, tipo, impacto, status, busca, data_inicio, data_fim }) {
  const conds = [];
  const params = [];
  let i = 1;

  if (segmento)    { conds.push(`r.segmento_id = $${i++}`);                                                       params.push(Number(segmento)); }
  if (tipo)        { conds.push(`r.tipo = $${i++}`);                                                              params.push(tipo); }
  if (impacto)     { conds.push(`r.impacto = $${i++}`);                                                           params.push(impacto); }
  if (status)      { conds.push(`r.status = $${i++}`);                                                            params.push(status); }
  if (busca)       { conds.push(`(r.titulo ILIKE $${i} OR r.descricao ILIKE $${i})`); params.push(`%${busca}%`); i++; }
  if (data_inicio) { conds.push(`r.criado_em::date >= $${i++}::date`);                                            params.push(data_inicio); }
  if (data_fim)    { conds.push(`r.criado_em::date <= $${i++}::date`);                                            params.push(data_fim); }

  return { conds, params, nextIdx: i };
}

// ── Admin route ───────────────────────────────────────────────────────────────

app.get('/admin/:secret', (req, res) => {
  if (req.params.secret !== ADMIN_SECRET) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── API: Segmentos ────────────────────────────────────────────────────────────

app.get('/api/segmentos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, descricao FROM segmentos WHERE ativo = 1 ORDER BY nome');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/segmentos/all', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM segmentos ORDER BY nome');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/segmentos', async (req, res) => {
  try {
    const nome      = sanitize(req.body.nome, 100);
    const descricao = sanitize(req.body.descricao || '', 300);
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const { rows } = await pool.query(
      'INSERT INTO segmentos (nome, descricao) VALUES ($1, $2) RETURNING id, nome, descricao, ativo',
      [nome, descricao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Segmento já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/segmentos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM segmentos WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Segmento não encontrado' });
    const seg = rows[0];

    const nome      = req.body.nome      !== undefined ? sanitize(req.body.nome, 100)      : seg.nome;
    const descricao = req.body.descricao !== undefined ? sanitize(req.body.descricao, 300) : seg.descricao;
    const ativo     = req.body.ativo     !== undefined ? (req.body.ativo ? 1 : 0)          : seg.ativo;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    await pool.query('UPDATE segmentos SET nome = $1, descricao = $2, ativo = $3 WHERE id = $4', [nome, descricao, ativo, id]);
    res.json({ id, nome, descricao, ativo });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nome já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/segmentos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM registros WHERE segmento_id = $1', [id]);
    if (rows[0].c > 0) return res.status(409).json({ error: 'Segmento possui registros vinculados' });
    const { rowCount } = await pool.query('DELETE FROM segmentos WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Segmento não encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Tipos ────────────────────────────────────────────────────────────────

app.get('/api/tipos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, label FROM tipos WHERE ativo = 1 ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tipos/all', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tipos ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tipos', async (req, res) => {
  try {
    const label = sanitize(req.body.label, 100);
    if (!label) return res.status(400).json({ error: 'Label é obrigatório' });
    const nome = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 50);
    const { rows } = await pool.query(
      'INSERT INTO tipos (nome, label) VALUES ($1, $2) RETURNING id, nome, label, ativo',
      [nome, label]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tipo já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tipos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM tipos WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Tipo não encontrado' });
    const t = rows[0];
    const label = req.body.label !== undefined ? sanitize(req.body.label, 100) : t.label;
    const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : t.ativo;
    if (!label) return res.status(400).json({ error: 'Label é obrigatório' });
    await pool.query('UPDATE tipos SET label = $1, ativo = $2 WHERE id = $3', [label, ativo, id]);
    res.json({ id, nome: t.nome, label, ativo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tipos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query('SELECT * FROM tipos WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Tipo não encontrado' });
    const t = rows[0];
    const { rows: linked } = await pool.query('SELECT COUNT(*)::int AS c FROM registros WHERE tipo = $1', [t.nome]);
    if (linked[0].c > 0) return res.status(409).json({ error: 'Tipo possui registros vinculados' });
    await pool.query('DELETE FROM tipos WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Registros ────────────────────────────────────────────────────────────

const IMPACTOS_VALIDOS = ['baixo', 'medio', 'alto'];

app.post('/api/registros', async (req, res) => {
  try {
    const atendente   = sanitize(req.body.atendente, 100);
    const matricula   = sanitize(req.body.matricula, 50);
    const segmento_id = Number(req.body.segmento_id);
    const tipo        = sanitize(req.body.tipo, 20);
    const titulo      = sanitize(req.body.titulo, 100);
    const descricao   = sanitize(req.body.descricao, 1000);
    const sugestao    = sanitize(req.body.sugestao || '', 500);
    const impacto     = sanitize(req.body.impacto, 10);

    const erros = [];
    if (!atendente)                          erros.push('atendente');
    if (!matricula)                          erros.push('matricula');
    if (!segmento_id)                        erros.push('segmento_id');
    if (!tipo)                               erros.push('tipo');
    if (!titulo)                             erros.push('titulo');
    if (!descricao)                          erros.push('descricao');
    if (!IMPACTOS_VALIDOS.includes(impacto)) erros.push('impacto');
    if (erros.length) return res.status(400).json({ error: `Campos inválidos ou ausentes: ${erros.join(', ')}` });

    const { rows: tipoRows } = await pool.query('SELECT id FROM tipos WHERE nome = $1 AND ativo = 1', [tipo]);
    if (!tipoRows.length) return res.status(400).json({ error: 'Tipo inválido' });

    const { rows: segRows } = await pool.query('SELECT id FROM segmentos WHERE id = $1 AND ativo = 1', [segmento_id]);
    if (!segRows.length) return res.status(400).json({ error: 'Segmento inválido' });

    const { rows } = await pool.query(
      'INSERT INTO registros (atendente, matricula, segmento_id, tipo, titulo, descricao, sugestao, impacto) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [atendente, matricula, segmento_id, tipo, titulo, descricao, sugestao || null, impacto]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/registros/export/csv', async (req, res) => {
  try {
    const { conds, params } = buildRegistrosFilters(req.query);
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rows } = await pool.query(`
      SELECT r.id, r.atendente, r.matricula, r.tipo, r.titulo, r.descricao, r.sugestao,
             r.impacto, r.status, r.criado_em, r.atualizado_em, s.nome AS segmento_nome
      FROM registros r JOIN segmentos s ON s.id = r.segmento_id
      ${where} ORDER BY r.criado_em DESC
    `, params);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="signal-export-${Date.now()}.csv"`);
    res.send('﻿' + toCSV(rows));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/registros/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, s.nome AS segmento_nome
      FROM registros r JOIN segmentos s ON s.id = r.segmento_id
      WHERE r.id = $1
    `, [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/registros', async (req, res) => {
  try {
    const { segmento, tipo, impacto, status, busca, data_inicio, data_fim } = req.query;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const { conds, params, nextIdx } = buildRegistrosFilters({ segmento, tipo, impacto, status, busca, data_inicio, data_fim });
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const { rows: [{ c: total }] } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM registros r ${where}`, params
    );

    const offset = (page - 1) * limit;
    const { rows } = await pool.query(`
      SELECT r.id, r.atendente, r.matricula, r.tipo, r.titulo, r.descricao, r.sugestao,
             r.impacto, r.status, r.criado_em, r.atualizado_em, s.nome AS segmento_nome
      FROM registros r JOIN segmentos s ON s.id = r.segmento_id
      ${where} ORDER BY r.criado_em DESC
      LIMIT $${nextIdx} OFFSET $${nextIdx + 1}
    `, [...params, limit, offset]);

    res.json({ total, page, limit, pages: Math.ceil(total / limit), data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/registros/:id/status', async (req, res) => {
  try {
    const STATUS_VALIDOS = ['novo', 'lido', 'em_analise', 'implementado', 'descartado'];
    const status = req.body.status;
    if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const { rowCount } = await pool.query(
      'UPDATE registros SET status = $1, atualizado_em = NOW() WHERE id = $2',
      [status, Number(req.params.id)]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/registros/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM registros WHERE id = $1', [Number(req.params.id)]);
    if (rowCount === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── API: Dashboard ────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const [
      { rows: [{ c: total }] },
      { rows: porTipo },
      { rows: porSegmento },
      { rows: porImpacto },
      { rows: porStatus },
      { rows: serie },
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM registros'),
      pool.query('SELECT tipo, COUNT(*)::int AS total FROM registros GROUP BY tipo'),
      pool.query(`
        SELECT s.nome AS segmento, COUNT(r.id)::int AS total
        FROM segmentos s LEFT JOIN registros r ON r.segmento_id = s.id
        GROUP BY s.id, s.nome ORDER BY total DESC
      `),
      pool.query('SELECT impacto, COUNT(*)::int AS total FROM registros GROUP BY impacto'),
      pool.query('SELECT status, COUNT(*)::int AS total FROM registros GROUP BY status'),
      pool.query(`
        SELECT criado_em::date AS dia, COUNT(*)::int AS total
        FROM registros
        WHERE criado_em >= NOW() - INTERVAL '30 days'
        GROUP BY dia ORDER BY dia
      `),
    ]);

    res.json({ total, porTipo, porSegmento, porImpacto, porStatus, serie });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────────

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Signal rodando em http://localhost:${PORT}`);
      console.log(`Admin: http://localhost:${PORT}/admin/${ADMIN_SECRET}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar banco de dados:', err);
    process.exit(1);
  });
