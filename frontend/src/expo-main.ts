import { HandScene } from './hand';
import { captureStep, windowLabel, readTrainingEvents, TOTAL_SECONDS } from './expo-protocol';
import type { ExpoLabel } from './expo-protocol';
import layout from './expo-layout.html?raw';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import './expo-style.css';

type View = 'channels' | 'training' | 'hand';
type Sample = { t: number; values: number[] };
type Frame = { type: 'frame'; timestamp: number; samples: Sample[]; rms: number[]; mav: number[]; angles: number[]; gesture: string; sample_count: number; unit: string; window_ms: number; source: string; hop_ms?: number; requested_hop_ms?: number };
type Model = { id: string; name: string; algorithm: string; validation_accuracy: number; sample_rate: number; window_ms: number; hop_ms?: number; classes?: string[]; winner_key?: string };
type TrainingPhase = 'idle' | 'waiting' | 'capture' | 'training' | 'complete';
type Config = { source: 'demo' | 'serial'; port?: string; baudrate: number; sample_rate: number; channels: number; window_ms: number; hop_ms: number; rest: number; mvc: number; model: 'baseline' | 'expo'; model_id?: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { $(id).textContent = value; };
document.querySelector<HTMLDivElement>('#app')!.innerHTML = layout;
const COLORS = ['#7ce2c5', '#f0b56b', '#78a9ff', '#e988a1', '#c39af3', '#75d0e8', '#d7df7a', '#f08c6a'];
const MODEL_INFO = [
  { key: 'forest', title: 'Random Forest', kicker: 'UN BOSQUE DE DECISIONES', description: 'Muchos árboles, una decisión compartida.', layers: [1, 2, 4, 8] },
  { key: 'compact', title: 'Red neuronal simple', kicker: 'UNA CAPA OCULTA', description: 'Aprende conexiones entre señal y gesto.', layers: [4, 6, 2] },
  { key: 'deep', title: 'Red neuronal de dos capas', kicker: 'DOS CAPAS OCULTAS', description: 'Dos etapas para reconocer tu movimiento.', layers: [4, 6, 4, 2] },
];
let view: View = 'channels';
let phase: TrainingPhase = 'idle';
let config: Config = { source: 'serial', baudrate: 115200, sample_rate: 1000, channels: 8, window_ms: 200, hop_ms: 50, rest: .05, mvc: .6, model: 'baseline' };
let socket: WebSocket | null = null;
let connectionRevision = 0;
let lastFrame: Frame | null = null;
let lastReceived = 0;
let sourceError = false;
let raw: Sample[] = [];
let models: Model[] = [];
let scene: HandScene | undefined;
let sceneReady = false;
let captureStart: number | null = null;
let features: number[][] = [];
let labels: ExpoLabel[] = [];
let lastCaptured = -1;
let trainingName = '';
let trainingAbort: AbortController | null = null;
let refreshingSources = true;
let scale = .1;

for (let index = 0; index < 8; index++) {
  const card = document.createElement('article');
  card.className = 'channel-card';
  card.style.setProperty('--channel', COLORS[index]);
  card.innerHTML = `<header><span class="channel-name"><i></i>Canal ${index + 1}</span><output id="rms-${index}">—</output></header><canvas id="channel-${index}" aria-label="Señal EMG del canal ${index + 1}, últimos cinco segundos" role="img"></canvas>`;
  $('channel-grid').append(card);
}

function diagram(key: string, layers: number[]): string {
  const forest = key === 'forest';
  const points = layers.map((count, layer) => Array.from({ length: count }, (_, i) => forest
    ? { x: 22 + (i + .5) * 256 / count, y: 22 + layer * 48 }
    : { x: 30 + layer * 240 / (layers.length - 1), y: 25 + (i + .5) * 148 / count }));
  let lines = '';
  let particles = '';
  points.slice(1).forEach((next, layer) => {
    points[layer].forEach((from, i) => next.forEach((to, j) => {
      if (forest && Math.floor(j / 2) !== i) return;
      lines += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`;
      if ((i + j) % 3 === 0) particles += `<circle class="pulse" r="2"><animateMotion dur="1.8s" begin="${(layer * .3 + i * .12).toFixed(2)}s" repeatCount="indefinite" path="M${from.x},${from.y} L${to.x},${to.y}"/></circle>`;
    }));
  });
  const nodes = points.flatMap(layer => layer.map(p => `<circle data-node cx="${p.x}" cy="${p.y}" r="${forest ? 6 : 5}"/>`)).join('');
  return `<svg viewBox="0 0 300 200" role="img" aria-label="Representación simplificada de ${MODEL_INFO.find(m => m.key === key)!.title}">${lines}${nodes}${particles}</svg>`;
}

for (const info of MODEL_INFO) {
  const card = document.createElement('article');
  card.className = 'model-card'; card.dataset.key = info.key;
  card.innerHTML = `<div class="model-kicker"><span>${info.kicker}</span><span class="winner-label" hidden>ELEGIDO</span></div><h2>${info.title}</h2><p>${info.description}</p>${diagram(info.key, info.layers)}<div class="model-detail">Esperando tu señal</div><div class="model-progress"><span></span></div><div class="score-line"><span>Aciertos en validación</span><strong class="model-score">—</strong></div>`;
  $('model-grid').append(card);
}

function notice(message = '') { text('notice', message); $('notice').hidden = !message; }
function status(message: string, live = false) { text('connection-status', message); $('signal-dot').classList.toggle('live', live); }
function busy() { return phase === 'waiting' || phase === 'capture' || phase === 'training'; }
function lockControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { button.disabled = busy(); });
  $<HTMLInputElement>('participant').disabled = busy();
  $<HTMLSelectElement>('signal-source').disabled = busy();
  $<HTMLButtonElement>('train-button').disabled = phase === 'training';
  const thesis = $('thesis-link');
  thesis.setAttribute('aria-disabled', String(busy()));
}
$('thesis-link').addEventListener('click', event => { if (busy()) event.preventDefault(); });

function ensureScene() {
  if (scene) return;
  try {
    scene = new HandScene($('expo-hand-canvas'));
    scene.setMode('robotic');
    scene.setCoordinatedControl(false);
    void scene.ready.then(() => { sceneReady = true; updateHand(); }).catch(() => {
      text('hand-state', 'No se pudo iniciar el movimiento 3D.');
      notice('La geometría de la mano no pudo validarse. Recarga la página.');
    });
  } catch {
    text('hand-state', 'La vista 3D necesita aceleración gráfica.');
    notice('Abre el simulador en Chrome o Edge con aceleración gráfica activada.');
  }
}
function updateHand() {
  if (!sceneReady) return;
  const selected = $<HTMLSelectElement>('saved-model').value;
  if (!selected) { scene?.setAngles([0, 0, 0, 0, 0]); text('hand-state', 'Selecciona un modelo entrenado'); return; }
  if (!lastFrame || config.model !== 'expo' || config.model_id !== selected) {
    scene?.setAngles([0, 0, 0, 0, 0]); text('hand-state', 'Esperando tu señal…'); return;
  }
  scene?.setAngles(lastFrame.angles);
  text('hand-state', lastFrame.gesture === 'fist' ? 'Puño cerrado' : 'Mano abierta');
}

function switchView(next: View) {
  if (busy()) return;
  view = next;
  for (const candidate of ['channels', 'training', 'hand']) {
    $('view-' + candidate).hidden = candidate !== next;
    const tab = $('tab-' + candidate);
    if (candidate === next) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  if (next === 'hand') { ensureScene(); requestAnimationFrame(() => scene?.resize()); }
  const wanted = next === 'hand' ? $<HTMLSelectElement>('saved-model').value : '';
  if (config.model_id !== (wanted || undefined)) void connect();
  updateHand();
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view as View)));
$('saved-model').addEventListener('change', () => { void connect(); });

async function refreshModels(selected?: string) {
  const response = await fetch('/api/expo/models');
  if (!response.ok) throw new Error('No se pudieron consultar los modelos guardados.');
  const data = await response.json();
  // Earlier prototypes with extra classes are not binary open/fist models.
  models = data.models.filter((model: Model) => model.classes?.length === 2 && model.classes.includes('open') && model.classes.includes('fist'));
  const picker = $<HTMLSelectElement>('saved-model');
  const previous = selected ?? picker.value;
  picker.replaceChildren(new Option(models.length ? 'Selecciona un modelo' : 'Entrena tu primer modelo', ''));
  models.forEach(model => picker.add(new Option(model.name, model.id)));
  if (models.some(model => model.id === previous)) picker.value = previous;
  picker.disabled = models.length === 0;
}

async function connect() {
  const revision = ++connectionRevision;
  const old = socket; socket = null;
  lastFrame = null; lastReceived = performance.now(); raw = []; sourceError = false;
  scene?.setAngles([0, 0, 0, 0, 0]);
  for (let i = 0; i < 8; i++) text('rms-' + i, '—');
  text('channel-unit', 'ESPERANDO SEÑAL');
  if (old && old.readyState !== WebSocket.CLOSED) {
    await new Promise<void>(resolve => { old.addEventListener('close', () => resolve(), { once: true }); old.close(); setTimeout(resolve, 350); });
  }
  if (revision !== connectionRevision) return;
  const selected = $<HTMLSelectElement>('signal-source').value;
  if (!selected) { status('Conecta el brazalete para comenzar'); updateHand(); return; }
  const wanted = view === 'hand' ? $<HTMLSelectElement>('saved-model').value : '';
  const model = models.find(item => item.id === wanted);
  config = { ...config, source: selected === 'demo' ? 'demo' : 'serial', port: selected === 'demo' ? undefined : selected, model: wanted ? 'expo' : 'baseline', model_id: wanted || undefined,
    sample_rate: model?.sample_rate ?? 1000, window_ms: model?.window_ms ?? 200, hop_ms: model?.hop_ms ?? 50 };
  scale = selected === 'demo' ? .1 : 1;
  status('Conectando…'); notice(); updateHand();
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/emg`);
  socket = ws;
  ws.onopen = () => { if (socket === ws) ws.send(JSON.stringify(config)); };
  ws.onmessage = event => {
    if (socket !== ws) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'error') { sourceError = true; notice(data.message); failCapture('La adquisición se detuvo. Revisa el brazalete y vuelve a comenzar.'); ws.close(); return; }
      if (data.type !== 'frame') return;
      if (data.rms.length !== 8 || data.mav.length !== 8) throw new Error('La exposición necesita los ocho canales.');
      lastFrame = data; lastReceived = performance.now(); sourceError = false;
      const frame = data as Frame;
      const adapted = frame.hop_ms && frame.hop_ms > (frame.requested_hop_ms ?? config.hop_ms);
      status(frame.source === 'demo' ? 'Demostración · señal sintética' : adapted ? `Brazalete conectado · ${Math.round(1000 / frame.hop_ms!)} actualizaciones/s` : 'Brazalete conectado · señal en tiempo real', true);
      text('channel-unit', frame.source === 'demo' ? 'SEÑAL SINTÉTICA' : frame.unit === 'normalized-adc' ? 'ADC NORMALIZADO' : 'SEÑAL DEL SENSOR');
      raw.push(...frame.samples);
      const first = raw.findIndex(sample => sample.t >= frame.timestamp - 5);
      if (first > 0) raw.splice(0, first);
      frame.rms.forEach((value, i) => text('rms-' + i, 'RMS ' + value.toLocaleString('es-CL', { maximumSignificantDigits: 3 })));
      acceptCapture(frame);
      if (view === 'hand') updateHand();
    } catch (error) { sourceError = true; notice(error instanceof Error ? error.message : 'Llegó una señal incompatible.'); failCapture('No se pudo leer la señal.'); ws.close(); }
  };
  ws.onerror = () => { if (socket === ws) { sourceError = true; notice('No se pudo conectar con el servicio de adquisición. Inicia el simulador con iniciar.ps1.'); } };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null; lastFrame = null; scene?.setAngles([0, 0, 0, 0, 0]);
    status('Adquisición desconectada'); text('channel-unit', 'SIN SEÑAL');
    if (!sourceError) notice('La conexión se cerró. Selecciona de nuevo el brazalete para reconectar.');
    failCapture('La captura se interrumpió. Vuelve a comenzar.');
    if (view === 'hand') text('hand-state', 'Sin señal · mano en reposo');
  };
}
$('signal-source').addEventListener('change', () => { void connect(); });

async function refreshSources() {
  const response = await fetch('/api/ports');
  if (!response.ok) throw new Error('No se pudo consultar el brazalete.');
  const data = await response.json() as { ports: { device: string; description: string }[] };
  const picker = $<HTMLSelectElement>('signal-source');
  const previous = picker.value;
  picker.replaceChildren(new Option(data.ports.length ? 'Selecciona el brazalete' : 'Sin brazalete conectado', ''));
  data.ports.forEach(port => picker.add(new Option('Brazalete · ' + port.device, port.device)));
  picker.add(new Option('Demostración sin sensor', 'demo'));
  if (previous === 'demo' || data.ports.some(port => port.device === previous)) picker.value = previous;
  else {
    const preferred = data.ports.find(port => /CH340|USB-SERIAL/i.test(port.description));
    if (preferred) picker.value = preferred.device;
    else if (data.ports.length === 1) picker.value = data.ports[0].device;
  }
}

function resetModels() {
  document.querySelectorAll<HTMLElement>('.model-card').forEach(card => {
    card.classList.remove('running', 'winner');
    card.querySelector<HTMLElement>('.winner-label')!.hidden = true;
    card.querySelector<HTMLElement>('.model-score')!.textContent = '—';
    card.querySelector<HTMLElement>('.model-detail')!.textContent = 'Esperando tu señal';
    card.querySelector<HTMLElement>('.model-progress span')!.style.width = '0%';
    card.querySelectorAll('[data-node]').forEach(node => node.classList.remove('learned'));
  });
}
function failCapture(message: string) {
  if (phase !== 'waiting' && phase !== 'capture') return;
  phase = 'idle'; captureStart = null;
  text('capture-title', message); text('capture-detail', 'Los datos incompletos no se usarán para entrenar.');
  text('countdown', '—'); text('train-button', 'Comenzar entrenamiento →'); lockControls();
}
$('training-form').addEventListener('submit', event => {
  event.preventDefault();
  if (phase === 'training') return;
  if (phase === 'waiting' || phase === 'capture') { failCapture('Captura detenida.'); return; }
  if (!lastFrame || performance.now() - lastReceived > 2000 || !socket) { notice('Conecta el brazalete o selecciona la demostración antes de entrenar.'); return; }
  trainingName = $<HTMLInputElement>('participant').value.trim();
  if (!trainingName) return;
  phase = 'waiting'; captureStart = null; features = []; labels = []; lastCaptured = -1;
  $('capture-panel').classList.remove('learning', 'complete'); $('model-grid').hidden = true;
  resetModels(); notice(); $('training-result').classList.remove('ready');
  text('training-result', 'Mantén el brazo y el brazalete en la misma posición.');
  text('capture-title', 'Preparando la captura…'); text('train-button', 'Detener captura'); lockControls();
});

function acceptCapture(frame: Frame) {
  if (phase !== 'waiting' && phase !== 'capture') return;
  if (captureStart === null) { captureStart = frame.timestamp; phase = 'capture'; }
  const elapsed = frame.timestamp - captureStart;
  const step = captureStep(elapsed);
  $('capture-fill').style.width = `${Math.min(100, elapsed / TOTAL_SECONDS * 100)}%`;
  if (step.complete) { void trainModels(); return; }
  text('pose-symbol', step.label === 'open' ? '✋' : '✊');
  text('capture-title', step.capturing ? step.label === 'open' ? 'Mantén la mano abierta.' : 'Mantén el puño cerrado.' : step.label === 'open' ? 'Prepárate: abre la mano.' : 'Prepárate: cierra el puño.');
  text('capture-detail', step.capturing ? 'Registrando tu actividad muscular…' : 'Imita la postura. La captura comienza al terminar la cuenta.');
  text('countdown', step.remaining.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s');
  const label = windowLabel(elapsed, frame.window_ms / 1000);
  if (!label || lastCaptured === frame.sample_count) return;
  const vector = [...frame.rms, ...frame.mav];
  if (!vector.every(Number.isFinite)) { failCapture('La señal contiene valores inválidos.'); return; }
  features.push(vector); labels.push(label); lastCaptured = frame.sample_count;
}

async function trainModels() {
  phase = 'training'; lockControls();
  $('capture-panel').classList.add('learning'); $('model-grid').hidden = false;
  text('pose-symbol', '✦'); text('capture-title', 'Tu señal está enseñando a los tres modelos.');
  text('capture-detail', 'El avance muestra árboles construidos y etapas de aprendizaje completadas.');
  text('countdown', ''); text('train-button', 'Entrenando…');
  text('training-result', 'Entrenando y evaluando con datos reservados de ambas posturas.');
  const abort = new AbortController(); trainingAbort = abort;
  try {
    const response = await fetch('/api/expo/compare', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trainingName, features, labels, channels: 8, sample_rate: config.sample_rate, window_ms: config.window_ms, hop_ms: config.hop_ms }) });
    let result: Model | undefined;
    await readTrainingEvents(response, async event => {
      if (event.type === 'result') { result = event.model; return; }
      const card = document.querySelector<HTMLElement>(`.model-card[data-key="${event.key}"]`);
      if (!card) return;
      if (event.type === 'progress') {
        const progress = Math.max(0, Math.min(1, event.progress));
        card.classList.toggle('running', progress < 1);
        card.querySelector<HTMLElement>('.model-detail')!.textContent = event.detail;
        card.querySelector<HTMLElement>('.model-progress span')!.style.width = progress * 100 + '%';
        const nodes = card.querySelectorAll('[data-node]');
        nodes.forEach((node, i) => node.classList.toggle('learned', i < Math.ceil(progress * nodes.length)));
        // Pace the display of actual completed steps for the classroom demonstration.
        // Scores and winner selection are never animated or fabricated.
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 80));
      } else if (event.type === 'evaluated') {
        card.classList.remove('running');
        card.querySelector<HTMLElement>('.model-score')!.textContent = (event.validation_accuracy * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%';
        card.querySelector<HTMLElement>('.model-detail')!.textContent = 'Evaluación completada';
      }
    });
    if (!result) throw new Error('No llegó el modelo ganador.');
    const winner = result;
    const card = document.querySelector<HTMLElement>(`.model-card[data-key="${winner.winner_key}"]`)!;
    card.classList.add('winner'); card.querySelector<HTMLElement>('.winner-label')!.hidden = false;
    // Publish the saved model immediately, even if a later list request fails.
    models = [winner, ...models.filter(model => model.id !== winner.id)];
    const picker = $<HTMLSelectElement>('saved-model');
    picker.options[0].text = 'Selecciona un modelo';
    picker.add(new Option(winner.name, winner.id)); picker.value = winner.id; picker.disabled = false;
    phase = 'complete';
    $('capture-panel').classList.remove('learning'); $('capture-panel').classList.add('complete');
    text('capture-title', 'Modelo guardado: ' + winner.name);
    text('capture-detail', 'Ya puedes pasar a Mano 3D desde la barra superior.');
    text('training-result', `Modelo “${winner.name}” guardado · ${winner.algorithm} · ${(winner.validation_accuracy * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })}% de aciertos. Pasa a Mano 3D para probarlo.`);
    $('training-result').classList.add('ready');
  } catch (error) {
    phase = 'idle';
    $('capture-panel').classList.remove('learning', 'complete');
    notice(error instanceof Error ? error.message : 'No se pudo completar el entrenamiento.');
    text('capture-title', 'El entrenamiento no pudo completarse.');
    text('capture-detail', 'Revisa la señal y vuelve a comenzar.');
    text('training-result', 'No se ha seleccionado un modelo ganador para esta captura.');
    document.querySelectorAll('.model-card').forEach(card => card.classList.remove('running'));
  } finally {
    trainingAbort = null; text('train-button', 'Volver a entrenar →'); lockControls();
  }
}

let lastDraw = 0;
function drawCharts(now: number) {
  requestAnimationFrame(drawCharts);
  if (view !== 'channels' || now - lastDraw < 50) return;
  lastDraw = now;
  let peak = .03;
  for (const sample of raw) for (const value of sample.values) peak = Math.max(peak, Math.abs(value));
  scale = Math.max(peak * 1.08, scale * .99);
  const end = lastFrame?.timestamp ?? 5;
  for (let channel = 0; channel < 8; channel++) {
    const canvas = $<HTMLCanvasElement>('channel-' + channel);
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = rect.width; const height = rect.height;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = canvas.getContext('2d'); if (!ctx) continue;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#1c2a36'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) { const x = i * width / 10; ctx.moveTo(x, 10); ctx.lineTo(x, height - 19); }
    for (const fraction of [.25, .5, .75]) { const y = 10 + fraction * (height - 29); ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    ctx.strokeStyle = COLORS[channel]; ctx.lineWidth = 1;
    ctx.beginPath();
    // Preserve local min/max in pixel bins so brief EMG peaks remain visible.
    const bins = new Map<number, [number, number]>();
    for (const sample of raw) {
      const x = Math.floor((sample.t - end + 5) / 5 * width);
      if (x < 0 || x >= width) continue;
      const value = sample.values[channel];
      const range = bins.get(x);
      if (range) { range[0] = Math.min(range[0], value); range[1] = Math.max(range[1], value); }
      else bins.set(x, [value, value]);
    }
    for (const [x, [min, max]] of bins) {
      const center = 10 + (height - 29) / 2;
      const amplitude = (height - 29) * .46 / scale;
      ctx.moveTo(x, center - min * amplitude); ctx.lineTo(x, center - max * amplitude + .5);
    }
    ctx.stroke();
    ctx.fillStyle = '#61788c'; ctx.font = '9px "DM Sans"';
    ctx.fillText('−5 s', 12, height - 5); ctx.fillText('ahora', width - 37, height - 5);
    if (raw.length) ctx.fillText('±' + scale.toLocaleString('es-CL', { maximumSignificantDigits: 2 }), 12, 17);
  }
}
requestAnimationFrame(drawCharts);
setInterval(() => {
  if (!socket || performance.now() - lastReceived < 2500 || sourceError) return;
  sourceError = true; lastFrame = null;
  status('Esperando muestras del brazalete'); text('channel-unit', 'SIN MUESTRAS NUEVAS');
  scene?.setAngles([0, 0, 0, 0, 0]);
  failCapture('No están llegando muestras. Revisa el brazalete.');
  if (view === 'hand') text('hand-state', 'Sin señal · mano en reposo');
}, 500);
setInterval(() => {
  if (busy() || refreshingSources || document.activeElement === $('signal-source')) return;
  refreshingSources = true;
  const previous = $<HTMLSelectElement>('signal-source').value;
  void refreshSources().then(() => {
    const selected = $<HTMLSelectElement>('signal-source').value;
    if (selected !== previous || (selected && !socket)) return connect();
  }).catch(() => {}).finally(() => { refreshingSources = false; });
}, 5000);
window.addEventListener('pagehide', () => { trainingAbort?.abort(); connectionRevision++; socket?.close(); scene?.dispose(); });

async function initialize() {
  const results = await Promise.allSettled([refreshSources(), refreshModels()]);
  const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failure) notice(failure.reason instanceof Error ? failure.reason.message : 'Inicia el servicio de adquisición para comenzar.');
  if (results[0].status === 'fulfilled') await connect();
  else status('Servicio de adquisición no disponible');
  refreshingSources = false;
}
void initialize();
