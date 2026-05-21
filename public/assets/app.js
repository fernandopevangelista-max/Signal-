// ── Toast helper ──────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show toast-${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3500);
}

// ── Char counters ─────────────────────────────────────────────────────────────
function bindCounter(inputId, counterId) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;
  input.addEventListener('input', () => { counter.textContent = input.value.length; });
}
bindCounter('titulo', 'tituloCount');
bindCounter('descricao', 'descricaoCount');
bindCounter('sugestao', 'sugestaoCount');

// ── Radio labels ──────────────────────────────────────────────────────────────
document.querySelectorAll('.radio-label').forEach(label => {
  label.addEventListener('click', () => {
    document.querySelectorAll('.radio-label').forEach(l => l.classList.remove('selected'));
    label.classList.add('selected');
    label.querySelector('input').checked = true;
  });
});

// ── Load segmentos ────────────────────────────────────────────────────────────
async function loadSegmentos() {
  const sel = document.getElementById('segmento');
  try {
    const res = await fetch('/api/segmentos');
    const data = await res.json();
    sel.innerHTML = '<option value="">Selecione seu segmento</option>' +
      data.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  } catch {
    sel.innerHTML = '<option value="">Erro ao carregar — recarregue a página</option>';
  }
}
loadSegmentos();

// ── Form submit ───────────────────────────────────────────────────────────────
const form = document.getElementById('signalForm');
const submitBtn = document.getElementById('submitBtn');
const formSection = document.getElementById('formSection');
const successOverlay = document.getElementById('successOverlay');
const successMsg = document.getElementById('successMsg');
const newRecordBtn = document.getElementById('newRecordBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const atendente = form.atendente.value.trim();
  const matricula = form.matricula.value.trim();
  const segmento_id = form.segmento_id.value;
  const tipo = form.tipo.value;
  const titulo = form.titulo.value.trim();
  const descricao = form.descricao.value.trim();
  const sugestao = form.sugestao.value.trim();
  const impacto = form.querySelector('input[name="impacto"]:checked')?.value;

  if (!atendente || !matricula || !segmento_id || !tipo || !titulo || !descricao || !impacto) {
    showToast('Preencha todos os campos obrigatórios.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/registros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atendente, matricula, segmento_id, tipo, titulo, descricao, sugestao, impacto }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erro ao enviar');
    }

    successMsg.textContent = `Sinal enviado. Obrigado, ${atendente}!`;
    formSection.style.display = 'none';
    successOverlay.classList.add('show');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar sinal';
  }
});

newRecordBtn.addEventListener('click', () => {
  form.reset();
  document.querySelectorAll('.radio-label').forEach(l => l.classList.remove('selected'));
  document.querySelectorAll('.char-counter span').forEach(s => { s.textContent = '0'; });
  formSection.style.display = '';
  successOverlay.classList.remove('show');
  loadSegmentos();
});
