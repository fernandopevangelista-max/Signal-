require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'signal2025';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── Database ──────────────────────────────────────────────────────────────────

const db = new Database(path.join(__dirname, 'signal.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS segmentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    descricao TEXT,
    ativo INTEGER DEFAULT 1,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS registros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    atendente TEXT NOT NULL,
    matricula TEXT NOT NULL,
    segmento_id INTEGER NOT NULL REFERENCES segmentos(id),
    tipo TEXT NOT NULL CHECK(tipo IN ('melhoria','impacto','erro_sistema','outro')),
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    sugestao TEXT,
    impacto TEXT NOT NULL CHECK(impacto IN ('baixo','medio','alto')),
    status TEXT NOT NULL DEFAULT 'novo' CHECK(status IN ('novo','lido','em_analise','implementado','descartado')),
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_registros_segmento ON registros(segmento_id);
  CREATE INDEX IF NOT EXISTS idx_registros_tipo ON registros(tipo);
  CREATE INDEX IF NOT EXISTS idx_registros_status ON registros(status);
  CREATE INDEX IF NOT EXISTS idx_registros_criado_em ON registros(criado_em);
`);

// Seed initial segments
const countSegs = db.prepare('SELECT COUNT(*) as c FROM segmentos').get();
if (countSegs.c === 0) {
  const insertSeg = db.prepare('INSERT INTO segmentos (nome, descricao) VALUES (?, ?)');
  const seedSegments = [
    ['Vivo Fixo - Ilha Cobre', 'Atendimento Vivo Fixo — Ilha Cobre'],
    ['Vivo Móvel', 'Atendimento Vivo Móvel'],
    ['Perda e Roubo', 'Atendimento Perda e Roubo'],
    ['Portabilidade', 'Atendimento Portabilidade'],
    ['Corporativo', 'Atendimento Corporativo'],
  ];
  seedSegments.forEach(([nome, descricao]) => insertSeg.run(nome, descricao));
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

// ── Admin route ───────────────────────────────────────────────────────────────

app.get('/admin/:secret', (req, res) => {
  if (req.params.secret !== ADMIN_SECRET) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── API: Segmentos ────────────────────────────────────────────────────────────

app.get('/api/segmentos', (req, res) => {
  try {
    const rows = db.prepare('SELECT id, nome, descricao FROM segmentos WHERE ativo = 1 ORDER BY nome').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/segmentos/all', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM segmentos ORDER BY nome').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/segmentos', (req, res) => {
  try {
    const nome = sanitize(req.body.nome, 100);
    const descricao = sanitize(req.body.descricao || '', 300);
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    const result = db.prepare('INSERT INTO segmentos (nome, descricao) VALUES (?, ?)').run(nome, descricao);
    res.status(201).json({ id: result.lastInsertRowid, nome, descricao, ativo: 1 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Segmento já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/segmentos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const seg = db.prepare('SELECT * FROM segmentos WHERE id = ?').get(id);
    if (!seg) return res.status(404).json({ error: 'Segmento não encontrado' });

    const nome = req.body.nome !== undefined ? sanitize(req.body.nome, 100) : seg.nome;
    const descricao = req.body.descricao !== undefined ? sanitize(req.body.descricao, 300) : seg.descricao;
    const ativo = req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : seg.ativo;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    db.prepare('UPDATE segmentos SET nome = ?, descricao = ?, ativo = ? WHERE id = ?').run(nome, descricao, ativo, id);
    res.json({ id, nome, descricao, ativo });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Nome já existe' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/segmentos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const linked = db.prepare('SELECT COUNT(*) as c FROM registros WHERE segmento_id = ?').get(id);
    if (linked.c > 0) return res.status(409).json({ error: 'Segmento possui registros vinculados' });
    const result = db.prepare('DELETE FROM segmentos WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Segmento não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Registros ────────────────────────────────────────────────────────────

const TIPOS_VALIDOS = ['melhoria', 'impacto', 'erro_sistema', 'outro'];
const IMPACTOS_VALIDOS = ['baixo', 'medio', 'alto'];

app.post('/api/registros', (req, res) => {
  try {
    const atendente = sanitize(req.body.atendente, 100);
    const matricula = sanitize(req.body.matricula, 50);
    const segmento_id = Number(req.body.segmento_id);
    const tipo = sanitize(req.body.tipo, 20);
    const titulo = sanitize(req.body.titulo, 100);
    const descricao = sanitize(req.body.descricao, 1000);
    const sugestao = sanitize(req.body.sugestao || '', 500);
    const impacto = sanitize(req.body.impacto, 10);

    const erros = [];
    if (!atendente) erros.push('atendente');
    if (!matricula) erros.push('matricula');
    if (!segmento_id) erros.push('segmento_id');
    if (!TIPOS_VALIDOS.includes(tipo)) erros.push('tipo');
    if (!titulo) erros.push('titulo');
    if (!descricao) erros.push('descricao');
    if (!IMPACTOS_VALIDOS.includes(impacto)) erros.push('impacto');
    if (erros.length) return res.status(400).json({ error: `Campos inválidos ou ausentes: ${erros.join(', ')}` });

    const seg = db.prepare('SELECT id FROM segmentos WHERE id = ? AND ativo = 1').get(segmento_id);
    if (!seg) return res.status(400).json({ error: 'Segmento inválido' });

    const result = db.prepare(
      'INSERT INTO registros (atendente, matricula, segmento_id, tipo, titulo, descricao, sugestao, impacto) VALUES (?,?,?,?,?,?,?,?)'
    ).run(atendente, matricula, segmento_id, tipo, titulo, descricao, sugestao || null, impacto);

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/registros/export/csv', (req, res) => {
  try {
    const { segmento, tipo, impacto, status, busca, data_inicio, data_fim } = req.query;
    const { sql, params } = buildRegistrosQuery({ segmento, tipo, impacto, status, busca, data_inicio, data_fim }, false);
    const rows = db.prepare(sql).all(...params);
    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="signal-export-${Date.now()}.csv"`);
    res.send('﻿' + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/registros/:id', (req, res) => {
  try {
    const row = db.prepare(`
      SELECT r.*, s.nome as segmento_nome
      FROM registros r JOIN segmentos s ON s.id = r.segmento_id
      WHERE r.id = ?
    `).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildRegistrosQuery({ segmento, tipo, impacto, status, busca, data_inicio, data_fim }, paginar = true, page = 1, limit = 20) {
  const conditions = [];
  const params = [];

  if (segmento) { conditions.push('r.segmento_id = ?'); params.push(Number(segmento)); }
  if (tipo) { conditions.push('r.tipo = ?'); params.push(tipo); }
  if (impacto) { conditions.push('r.impacto = ?'); params.push(impacto); }
  if (status) { conditions.push('r.status = ?'); params.push(status); }
  if (busca) { conditions.push('(r.titulo LIKE ? OR r.descricao LIKE ?)'); params.push(`%${busca}%`, `%${busca}%`); }
  if (data_inicio) { conditions.push("date(r.criado_em) >= date(?)"); params.push(data_inicio); }
  if (data_fim) { conditions.push("date(r.criado_em) <= date(?)"); params.push(data_fim); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const base = `SELECT r.id, r.atendente, r.matricula, r.tipo, r.titulo, r.descricao, r.sugestao, r.impacto, r.status, r.criado_em, r.atualizado_em, s.nome as segmento_nome FROM registros r JOIN segmentos s ON s.id = r.segmento_id ${where} ORDER BY r.criado_em DESC`;

  if (!paginar) return { sql: base, params };

  const offset = (page - 1) * limit;
  return { sql: `${base} LIMIT ? OFFSET ?`, params: [...params, limit, offset] };
}

app.get('/api/registros', (req, res) => {
  try {
    const { segmento, tipo, impacto, status, busca, data_inicio, data_fim } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

    const countConditions = [];
    const countParams = [];
    if (segmento) { countConditions.push('segmento_id = ?'); countParams.push(Number(segmento)); }
    if (tipo) { countConditions.push('tipo = ?'); countParams.push(tipo); }
    if (impacto) { countConditions.push('impacto = ?'); countParams.push(impacto); }
    if (status) { countConditions.push('status = ?'); countParams.push(status); }
    if (busca) { countConditions.push('(titulo LIKE ? OR descricao LIKE ?)'); countParams.push(`%${busca}%`, `%${busca}%`); }
    if (data_inicio) { countConditions.push("date(criado_em) >= date(?)"); countParams.push(data_inicio); }
    if (data_fim) { countConditions.push("date(criado_em) <= date(?)"); countParams.push(data_fim); }

    const countWhere = countConditions.length ? 'WHERE ' + countConditions.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) as c FROM registros ${countWhere}`).get(...countParams).c;

    const { sql, params } = buildRegistrosQuery({ segmento, tipo, impacto, status, busca, data_inicio, data_fim }, true, page, limit);
    const rows = db.prepare(sql).all(...params);

    res.json({ total, page, limit, pages: Math.ceil(total / limit), data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/registros/:id/status', (req, res) => {
  try {
    const STATUS_VALIDOS = ['novo', 'lido', 'em_analise', 'implementado', 'descartado'];
    const status = req.body.status;
    if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const result = db.prepare(
      "UPDATE registros SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(status, Number(req.params.id));
    if (result.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/registros/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM registros WHERE id = ?').run(Number(req.params.id));
    if (result.changes === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Dashboard ────────────────────────────────────────────────────────────

app.get('/api/dashboard', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM registros').get().c;

    const porTipo = db.prepare("SELECT tipo, COUNT(*) as total FROM registros GROUP BY tipo").all();
    const porSegmento = db.prepare(`
      SELECT s.nome as segmento, COUNT(r.id) as total
      FROM segmentos s LEFT JOIN registros r ON r.segmento_id = s.id
      GROUP BY s.id ORDER BY total DESC
    `).all();
    const porImpacto = db.prepare("SELECT impacto, COUNT(*) as total FROM registros GROUP BY impacto").all();
    const porStatus = db.prepare("SELECT status, COUNT(*) as total FROM registros GROUP BY status").all();

    const serie = db.prepare(`
      SELECT date(criado_em) as dia, COUNT(*) as total
      FROM registros
      WHERE criado_em >= date('now', '-30 days')
      GROUP BY dia ORDER BY dia
    `).all();

    res.json({ total, porTipo, porSegmento, porImpacto, porStatus, serie });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Signal rodando em http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin/${ADMIN_SECRET}`);
});
