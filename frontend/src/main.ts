import { createIcons, Activity, Box, Workflow, FolderOpen, CircleHelp, Download, SlidersHorizontal, Hand, Grab, ScanLine, Scissors, MousePointer2, Info, RotateCcw, Mouse, Radio, AudioLines, RefreshCw, FlaskConical, Play, Square, ArrowUpRight, Cpu, Settings2, ChevronRight, Timer, X, FileCode2, Check, Files, FileJson, Maximize2, Minimize2, Sparkles, BrainCircuit } from 'lucide';
import { HandScene, type HandView } from './hand';
import type { ContactState } from './hand-contact';
import layout from './layout.html?raw';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = layout;
const iconSet = { Activity, Box, Workflow, FolderOpen, CircleHelp, Download, SlidersHorizontal, Hand, Grab, ScanLine, Scissors, MousePointer2, Info, RotateCcw, Mouse, Radio, AudioLines, RefreshCw, FlaskConical, Play, Square, ArrowUpRight, Cpu, Settings2, ChevronRight, Timer, X, FileCode2, Check, Files, FileJson, Maximize2, Minimize2, Sparkles, BrainCircuit };
const icons = () => createIcons({ icons: iconSet });
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { $(id).textContent = value; };
const n = (value: number, digits = 2) => value.toLocaleString('es-CL', { maximumFractionDigits: digits, minimumFractionDigits: digits });

type Config = { source: 'demo' | 'serial'; port?: string; baudrate: number; sample_rate: number; channels: number; window_ms: number; hop_ms: number; rest: number; mvc: number; model: 'baseline' | 'custom' | 'expo'; model_id?: string };
type Sample = { t: number; values: number[] };
type Frame = { type: 'frame'; timestamp: number; samples: Sample[]; rms: number[]; mav: number[]; activation: number; angles: number[]; gesture: string; confidence: number | null; latency_ms: number; sample_count: number; source: string; model: string; unit: string; sample_rate: number; window_ms: number; hop_ms: number };
type RecordedFrame = Omit<Frame, 'samples'>;
type Session = { started_at: string; config: Config; raw: Sample[]; frames: RecordedFrame[]; start_t: number | null; pre_roll_samples: number };
type ExpoModel = { id: string; name: string; created_at: string; algorithm: string; channels: number; samples: number; validation_accuracy: number; classes?: string[] };
type ExpoPhase = 'idle' | 'waiting' | 'prepare' | 'capture' | 'training' | 'complete';
const fingerNames = ['Pulgar', 'Índice', 'Medio', 'Anular', 'Meñique'];
const poses: Record<string, number[]> = { open: [0, 0, 0, 0, 0], fist: [75, 90, 90, 90, 90], pinch: [58, 65, 10, 14, 20], peace: [65, 0, 0, 90, 90] };
let config: Config = { source: 'demo', baudrate: 115200, sample_rate: 1000, channels: 8, window_ms: 200, hop_ms: 50, rest: 0.05, mvc: 0.6, model: 'baseline' };
let mode: 'manual' | 'emg' = 'manual';
let angles = [0, 0, 0, 0, 0];
let scene: HandScene | undefined;
let motionReady = false;
let socket: WebSocket | null = null;
let running = false;
let connecting = false;
let lastFrame: Frame | null = null;
let samples: Sample[] = [];
let visibleChannels = Array(8).fill(true) as boolean[];
let recording = false;
let session: Session | null = null;
let configAtStart: Config = { ...config };
let lastFrameReceivedAt = 0;
let streamHadError = false;
let messageTimeout: ReturnType<typeof setTimeout>;
const LIMIT = 120_000;
const CHANNEL_COLORS = ['#7ce2c5', '#f0b56b', '#78a9ff', '#e988a1', '#c39af3', '#75d0e8', '#d7df7a', '#f08c6a'];
const EXPO_GESTURES = [
  { id: 'open', name: 'Mano abierta', instruction: 'Abre la mano por completo y mantén todos los dedos extendidos.', angles: [0, 0, 0, 0, 0] },
  { id: 'fist', name: 'Puño cerrado', instruction: 'Cierra todos los dedos formando un puño cómodo.', angles: [75, 90, 90, 90, 90] },
] as const;
const EXPO_NAMES = Object.fromEntries(EXPO_GESTURES.map(gesture => [gesture.id, gesture.name]));
const EXPO_TASKS = [
  ...EXPO_GESTURES.map(gesture => ({ ...gesture, round: 'hold' as const })),
  { ...EXPO_GESTURES[1], round: 'dynamic' as const, name: 'Abrir y cerrar la mano', instruction: 'Abre y cierra toda la mano siguiendo el ritmo de la referencia 3D.' },
];
const EXPO_PREP_MS = 2200;
const EXPO_CAPTURE_MS = 10_000;
const EXPO_DYNAMIC_HALF_CYCLE_MS = 900;
const EXPO_TRANSITION_GUARD_MS = 250;
let expoModels: ExpoModel[] = [];
let expoPhase: ExpoPhase = 'idle';
let expoTaskIndex = 0;
let expoPhaseEndsAt = 0;
let expoFeatures: number[][] = [];
let expoLabels: string[] = [];
let expoLastSampleCount = -1;
let expoTaskCaptured = 0;
let expoDynamicFlexed = false;
let expoDynamicChangedAt = 0;
let expoTimer: ReturnType<typeof setInterval> | undefined;
let trainedExpoModel: ExpoModel | null = null;
let expoStartedStream = false;

function notify(message: string, error = false, persistent = false) {
  clearTimeout(messageTimeout);
  text('message', message);
  $('message').hidden = false;
  $('message').classList.toggle('error', error);
  if (!persistent) messageTimeout = setTimeout(() => { $('message').hidden = true; }, 8000);
}
function showDialog(id: string) {
  if (id === 'sessions-dialog') updateSession();
  if (id === 'expo-dialog') prepareExpoDialog();
  $(id as string).querySelector<HTMLElement>('.close-dialog')?.blur();
  if (id === 'expo-dialog') $<HTMLDialogElement>(id).show();
  else $<HTMLDialogElement>(id).showModal();
}
document.querySelectorAll<HTMLButtonElement>('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); }
}));
for (const id of ['configure-button', 'model-settings']) $(id).addEventListener('click', () => showDialog('settings-dialog'));
$('export-session').addEventListener('click', () => showDialog('sessions-dialog'));
$('expo-button').addEventListener('click', () => { location.href = '/'; });

fingerNames.forEach((name, index) => {
  const row = document.createElement('div');
  row.className = 'joint-row';
  row.innerHTML = '<label for="joint-' + index + '">' + name + '</label><input id="joint-' + index + '" type="range" min="0" max="90" step="1" value="0" aria-label="Flexión ' + name + '"><output id="angle-' + index + '" for="joint-' + index + '">0°</output>';
  $('joint-controls').append(row);
  row.querySelector('input')!.addEventListener('input', event => {
    angles[index] = Number((event.target as HTMLInputElement).value);
    setAngles(angles);
    document.querySelectorAll('.pose-button').forEach(b => b.classList.remove('selected'));
  });
});
function updateMotion(state: ContactState) {
  state.achieved.forEach((angle, index) => {
    text('achieved-' + index, n(angle, 1) + '°');
    $('achieved-' + index).classList.toggle('limited', state.limited[index]);
  });
  const blocked = fingerNames.filter((_, index) => state.limited[index]);
  text('contact-status', scene?.getTransitionLabel() || (blocked.length ? 'Tope de contacto · ' + blocked.join(', ') : state.moving ? 'Movimiento en curso' : 'Recorrido libre'));
  $('contact-status').classList.toggle('limited', blocked.length > 0);
}
try {
  scene = new HandScene($('hand-canvas')); scene.setMode('robotic');
  scene.onMotion = updateMotion;
  void scene.ready.then(() => { motionReady = true; setMode(mode); }).catch(error => {
    console.error(error); text('contact-status', 'Movimiento deshabilitado');
    notify('No se pudo validar la geometría de contacto. La mano permanece detenida; revisa el diagnóstico de la consola.', true, true);
  });
} catch (error) {
  const fallback = document.createElement('p'); fallback.className = 'render-error'; fallback.textContent = 'No se pudo iniciar WebGL. Abre el simulador en Chrome o Edge con aceleración gráfica activada.'; $('hand-canvas').append(fallback); console.error(error);
  text('contact-status', 'Vista 3D no disponible');
}
function setAngles(next: number[]) {
  angles = angles.map((previous, index) => Number.isFinite(next[index]) ? Math.max(0, Math.min(90, next[index])) : previous);
  scene?.setAngles(angles);
  angles.forEach((angle, index) => {
    const input = $<HTMLInputElement>('joint-' + index); input.value = String(angle); input.style.setProperty('--fill', angle / 90 * 100 + '%'); text('angle-' + index, Math.round(angle) + '°');
  });
}
function setMode(next: 'manual' | 'emg') {
  mode = next;
  scene?.setCoordinatedControl(next === 'manual');
  $('mode-manual').classList.toggle('selected', next === 'manual'); $('mode-emg').classList.toggle('selected', next === 'emg');
  $('mode-manual').setAttribute('aria-pressed', String(next === 'manual')); $('mode-emg').setAttribute('aria-pressed', String(next === 'emg'));
  document.querySelectorAll<HTMLInputElement>('.joint-row input').forEach(input => { input.disabled = next === 'emg' || !motionReady; });
  document.querySelectorAll<HTMLButtonElement>('.pose-button').forEach(button => { button.disabled = next === 'emg' || !motionReady; });
  text('control-badge', next === 'manual' ? 'CONTROL MANUAL' : 'CONTROL POR EMG');
  text('control-hint', next === 'manual' ? 'Los dedos ceden el paso y retoman los ángulos solicitados.' : running ? 'La salida del modelo controla los cinco dedos.' : 'Inicia la adquisición para mover la mano con EMG.');
  if (next === 'emg' && lastFrame && running) setAngles(lastFrame.angles);
}
$('mode-manual').addEventListener('click', () => setMode('manual'));
$('mode-emg').addEventListener('click', () => setMode('emg'));
document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach(button => button.addEventListener('click', () => {
  setAngles(poses[button.dataset.pose!]);
  scene?.setPosture(poses[button.dataset.pose!]);
  document.querySelectorAll('.pose-button').forEach(b => b.classList.toggle('selected', b === button));
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  scene?.setView(button.dataset.view as HandView);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('selected', b === button));
}));
$('reset-view').addEventListener('click', () => { scene?.setView('perspective'); scene?.setZoom(1); document.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.classList.toggle('selected', b.dataset.view === 'perspective')); });
function expandView(expanded: boolean) {
  document.querySelector('.viewport-panel')!.classList.toggle('expanded-view', expanded);
  document.documentElement.style.overflow = expanded ? 'hidden' : '';
  const button = $('expand-view'); button.setAttribute('aria-pressed', String(expanded)); button.setAttribute('aria-label', expanded ? 'Reducir vista 3D' : 'Ampliar vista 3D');
  button.innerHTML = expanded ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
  icons(); scene?.resize();
}
$('expand-view').addEventListener('click', () => expandView($('expand-view').getAttribute('aria-pressed') !== 'true'));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('expand-view').getAttribute('aria-pressed') === 'true') expandView(false); });
$<HTMLInputElement>('wireframe').addEventListener('change', e => scene?.setWireframe((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('skeleton').addEventListener('change', e => scene?.setSkeleton((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('axes').addEventListener('change', e => scene?.setAxes((e.target as HTMLInputElement).checked));

function renderChannelLegend() {
  const legend = $('channel-legend'); legend.replaceChildren();
  visibleChannels = Array.from({ length: config.channels }, (_, index) => visibleChannels[index] ?? true);
  for (let index = 0; index < config.channels; index++) {
    const item = document.createElement('label'); item.className = 'channel-key';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = visibleChannels[index]; input.setAttribute('aria-label', 'Mostrar canal ' + (index + 1)); input.style.accentColor = CHANNEL_COLORS[index % CHANNEL_COLORS.length];
    const swatch = document.createElement('b'); swatch.style.background = CHANNEL_COLORS[index % CHANNEL_COLORS.length];
    input.addEventListener('change', () => { visibleChannels[index] = input.checked; updateVisibleRms(); drawChart(); });
    item.append(input, swatch, 'CH' + (index + 1)); legend.append(item);
  }
  text('signal-description', 'EMG sin filtrar · ' + config.channels + ' canales simultáneos');
  document.querySelector('.signal-metrics>div>span')!.textContent = 'RMS · CANALES VISIBLES';
}
function activeChannelIndexes() { return visibleChannels.flatMap((visible, index) => visible ? [index] : []); }
function updateVisibleRms() {
  const active = activeChannelIndexes();
  if (!lastFrame || !active.length) { text('rms-value', '— u.'); return; }
  const meanRms = active.reduce((sum, index) => sum + (lastFrame!.rms[index] ?? 0), 0) / active.length;
  text('rms-value', n(meanRms, 4) + ' u.');
}
function modelSelectValue() { return config.model === 'expo' ? 'expo:' + (config.model_id ?? '') : config.model; }
function renderModelOptions() {
  const group = $('expo-model-options'); group.replaceChildren();
  for (const model of expoModels) group.append(new Option(model.name + ' · ' + Math.round(model.validation_accuracy * 100) + '%', 'expo:' + model.id));
  const select = $<HTMLSelectElement>('model');
  select.value = modelSelectValue();
  if (!select.value) { config.model = 'baseline'; delete config.model_id; select.value = 'baseline'; }
}
function selectedExpoModel() { return expoModels.find(model => model.id === config.model_id); }
function syncConfig() {
  text('rate-summary', config.sample_rate.toLocaleString('es-CL') + ' Hz'); text('window-summary', config.window_ms + ' ms'); text('channel-summary', String(config.channels).padStart(2, '0'));
  const expoModel = selectedExpoModel();
  text('model-name', config.model === 'baseline' ? 'Control proporcional RMS' : config.model === 'custom' ? 'Modelo Python personalizado' : expoModel?.name ?? 'Modelo Expo');
  const classCount = expoModel?.classes?.length ?? 2;
  text('model-description', config.model === 'baseline' ? 'Referencia de demostración' : config.model === 'custom' ? 'TensorFlow / PyTorch vía adaptador' : 'Random Forest · ' + classCount + ' gestos personalizados');
  text('prediction-kind', config.model === 'expo' ? 'CLASIFICACIÓN PERSONALIZADA · ' + classCount + ' GESTOS' : 'REGRESIÓN CONTINUA · 5 ÁNGULOS');
  renderChannelLegend();
  for (const [id, key] of [['sample-rate','sample_rate'],['channels','channels'],['window-ms','window_ms'],['hop-ms','hop_ms'],['baudrate','baudrate'],['rest','rest'],['mvc','mvc']] as const) $<HTMLInputElement>(id).value = String(config[key]);
  renderModelOptions();
}
async function refreshExpoModels() {
  try {
    const response = await fetch('/api/expo/models'); if (!response.ok) throw new Error();
    const data = await response.json() as { models: ExpoModel[] }; expoModels = data.models; renderModelOptions();
  } catch { expoModels = []; renderModelOptions(); }
}
type SerialPort = { device: string; description: string };
async function refreshPorts(): Promise<SerialPort[]> {
  const button = $<HTMLButtonElement>('refresh-ports'); button.disabled = true;
  try {
    const response = await fetch('/api/ports'); if (!response.ok) throw new Error();
    const data = await response.json() as { ports: SerialPort[] };
    const port = $<HTMLSelectElement>('port'); const previous = port.value; port.replaceChildren(new Option(data.ports.length ? 'Selecciona un puerto' : 'No se detectaron puertos seriales', ''));
    data.ports.forEach(p => port.add(new Option(p.device + ' · ' + p.description, p.device)));
    if (data.ports.some(p => p.device === previous)) port.value = previous;
    else {
      const preferred = data.ports.find(p => /CH340|USB-SERIAL/i.test(p.description));
      if (preferred) port.value = preferred.device;
      else if (data.ports.length === 1) port.value = data.ports[0].device;
    }
    if (!data.ports.length) notify('No se detectaron puertos seriales. Un receptor EMG con protocolo propio puede necesitar su SDK; el conector CSV/JSON no lo reemplaza.');
    return data.ports;
  } catch { notify('No se pudo consultar el servicio Python. Ejecuta iniciar.ps1 desde la carpeta del proyecto.', true); return []; }
  finally { button.disabled = false; }
}
$('refresh-ports').addEventListener('click', refreshPorts);
$<HTMLSelectElement>('source').addEventListener('change', event => {
  config.source = (event.target as HTMLSelectElement).value as Config['source'];
  samples = []; lastFrame = null; resetMetrics(); drawChart();
  $('serial-fields').hidden = config.source !== 'serial';
  text('source-note', config.source === 'demo' ? 'Señal sintética · sin sensor conectado' : 'Detección automática · EMG PRO binario o CSV/JSON');
  text('signal-unit', config.source === 'demo' ? 'u. normalizadas · demo' : 'unidades crudas del sensor');
  if (config.source === 'serial') void refreshPorts();
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  if (running || connecting) { text('settings-feedback', 'Detén la adquisición para cambiar la configuración.'); return; }
  const value = (id: string) => Number($<HTMLInputElement>(id).value);
  const selectedModel = $<HTMLSelectElement>('model').value;
  const model = selectedModel.startsWith('expo:') ? 'expo' : selectedModel as Config['model'];
  const model_id = model === 'expo' ? selectedModel.slice(5) : undefined;
  const next: Config = { ...config, sample_rate: value('sample-rate'), channels: value('channels'), window_ms: value('window-ms'), hop_ms: value('hop-ms'), baudrate: value('baudrate'), rest: value('rest'), mvc: value('mvc'), model, model_id };
  if (next.mvc <= next.rest) { text('settings-feedback', 'La contracción de referencia debe ser mayor que el reposo.'); return; }
  if (next.hop_ms > next.window_ms) { text('settings-feedback', 'El salto no puede ser mayor que la ventana.'); return; }
  config = next; samples = []; lastFrame = null; syncConfig(); resetMetrics(); drawChart(); $<HTMLDialogElement>('settings-dialog').close(); notify('Configuración guardada para la próxima adquisición.');
});
function resetMetrics() {
  text('rms-value', '— u.'); text('sample-count', '0'); text('elapsed', '00:00.0'); text('gesture', 'Esperando señal'); text('activation-value', '—'); text('confidence', config.model === 'baseline' ? 'Referencia proporcional' : config.model === 'expo' ? 'Esperando clasificación' : 'Regresión de ángulos'); text('latency', '— ms'); $('activation-fill').style.width = '0%'; document.querySelectorAll('#angle-readout b').forEach(el => { el.textContent = '—'; });
}
function updateStreamUI() {
  $<HTMLSelectElement>('source').disabled = running || connecting; $<HTMLSelectElement>('port').disabled = running || connecting; $<HTMLButtonElement>('refresh-ports').disabled = running || connecting;
  const start = $('start-button'); start.classList.toggle('running', running || connecting); start.innerHTML = running || connecting ? '<i data-lucide="square"></i><span>Detener adquisición</span>' : '<i data-lucide="play"></i><span>Iniciar adquisición</span>';
  text('connection-status', connecting ? 'CONECTANDO' : running ? 'ADQUIRIENDO' : 'EN ESPERA'); $('connection-status').classList.toggle('live', running);
  $<HTMLButtonElement>('record-button').disabled = !running; setMode(mode); icons();
}
function stopStream() {
  const current = socket; socket = null; current?.close(); running = false; connecting = false; recording = false; updateRecording(); updateStreamUI();
}
function startStream() {
  if (running || connecting) { stopStream(); return; }
  if (config.source === 'serial' && !$<HTMLSelectElement>('port').value) { notify('Selecciona un puerto serial compatible antes de iniciar.', true); return; }
  clearTimeout(messageTimeout); $('message').hidden = true;
  configAtStart = { ...config, ...(config.source === 'serial' ? { port: $<HTMLSelectElement>('port').value } : {}) };
  samples = []; lastFrame = null; resetMetrics(); streamHadError = false; connecting = true; lastFrameReceivedAt = performance.now(); updateStreamUI();
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/emg'); socket = ws;
  const connectTimer = setTimeout(() => { if (socket === ws && connecting) { notify('No se pudo iniciar la adquisición. Comprueba el servicio Python, el modelo y la configuración.', true); streamHadError = true; stopStream(); } }, config.model === 'custom' ? 60000 : 12000);
  ws.onopen = () => { if (socket !== ws) return; ws.send(JSON.stringify(configAtStart)); };
  ws.onmessage = event => {
    if (socket !== ws) return;
    try {
      const data = JSON.parse(event.data) as Frame | { type: 'status' | 'error'; message: string };
      if (data.type === 'error') {
        streamHadError = true;
        const message = /could not open port|acceso denegado|permissionerror/i.test(data.message)
          ? 'El puerto ' + (configAtStart.port ?? 'serial') + ' está en uso por otra pestaña o aplicación. Detén allí la adquisición y vuelve a intentarlo.'
          : data.message;
        notify(message, true, true); stopStream();
      }
      else if (data.type === 'status') {
        if (/Puerto .+ abierto/i.test(data.message)) clearTimeout(connectTimer);
        text('connection-status', 'ESPERANDO DATOS');
        if (/descart|inválid/i.test(data.message)) notify(data.message, true);
        else text('backend-status', data.message);
      } else if (data.type === 'frame') {
        clearTimeout(connectTimer); lastFrameReceivedAt = performance.now(); lastFrame = data;
        if (!running) { running = true; connecting = false; updateStreamUI(); }
        text('connection-status', 'ADQUIRIENDO'); acceptFrame(data);
      }
    } catch (error) { console.error(error); streamHadError = true; notify('Se recibió una trama incompatible desde el servidor.', true); stopStream(); }
  };
  ws.onerror = () => { if (socket === ws) { streamHadError = true; notify('No se pudo conectar con Python. Ejecuta iniciar.ps1 y abre http://127.0.0.1:8765.', true, true); } };
  ws.onclose = () => {
    clearTimeout(connectTimer); if (socket !== ws) return;
    const unexpectedly = running || connecting; socket = null; running = false; connecting = false; recording = false; updateRecording(); updateStreamUI();
    if (unexpectedly && !streamHadError) notify('La adquisición terminó porque se cerró la conexión. El registro que ya recibiste sigue disponible para exportar.', true);
  };
}
$('start-button').addEventListener('click', startStream);
function acceptFrame(frame: Frame) {
  samples.push(...frame.samples); const cutoff = frame.timestamp - 5;
  let old = 0; while (old < samples.length && samples[old].t < cutoff) old++; if (old) samples.splice(0, old);
  updateVisibleRms(); text('sample-count', frame.sample_count.toLocaleString('es-CL'));
  const sec = Math.floor(frame.timestamp); text('elapsed', String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0') + '.' + Math.floor(frame.timestamp % 1 * 10));
  if (expoPhase === 'waiting' || expoPhase === 'prepare' || expoPhase === 'capture') updateExpoClock();
  captureExpoFrame(frame);
  text('gesture', frame.model === 'baseline' ? 'Flexión proporcional' : frame.model === 'expo' ? EXPO_NAMES[frame.gesture] ?? frame.gesture : 'Ángulos estimados'); text('activation-value', Math.round(frame.activation * 100) + '%'); $('activation-fill').style.width = frame.activation * 100 + '%';
  document.querySelectorAll('#angle-readout b').forEach((el, index) => { el.textContent = n(frame.angles[index], 1) + '°'; });
  text('confidence', frame.model === 'baseline' ? 'Referencia proporcional' : frame.model === 'expo' && frame.confidence !== null ? 'Confianza ' + Math.round(frame.confidence * 100) + '%' : 'Regresión de ángulos'); text('latency', n(frame.latency_ms, 2) + ' ms');
  text('backend-status', frame.source === 'demo' ? 'Python conectado · señal sintética' : 'Python conectado · adquisición serial');
  $('backend-dot').className = 'status-dot'; text('signal-unit', frame.unit === 'normalized' ? 'u. normalizadas · demo' : frame.unit === 'normalized-adc' ? 'ADC centrado · −1 a 1' : 'unidades crudas del sensor');
  if (mode === 'emg') { setAngles(frame.angles); document.querySelectorAll('.pose-button').forEach(b => b.classList.remove('selected')); }
  if (recording && session) {
    const remaining = LIMIT - session.raw.length;
    if (frame.samples.length > remaining) {
      recording = false; notify('La grabación se detuvo antes de superar 120.000 muestras, conservando la última ventana completa. Exporta la sesión.');
    } else {
      session.raw.push(...frame.samples);
      if (session.start_t === null && frame.samples.length) session.start_t = frame.samples[0].t;
      const { samples: _samples, ...record } = frame; session.frames.push(record);
      if (session.raw.length >= LIMIT) { recording = false; notify('La grabación alcanzó 120.000 muestras y se detuvo. Exporta los datos de la sesión.'); }
    }
    updateRecording();
  }
  drawChart();
}

function setExpoStage(stage: 'prepare' | 'capture' | 'train') {
  const order = ['prepare', 'capture', 'train']; const current = order.indexOf(stage);
  document.querySelectorAll<HTMLElement>('[data-expo-stage]').forEach(item => {
    const index = order.indexOf(item.dataset.expoStage ?? '');
    item.classList.toggle('active', index === current); item.classList.toggle('done', index < current);
  });
}
function renderExpoGestureList() {
  const list = $('expo-gesture-list'); list.replaceChildren();
  EXPO_TASKS.forEach((task, index) => {
    const item = document.createElement('span'); item.textContent = String(index + 1); item.title = task.name;
    item.classList.toggle('active', index === expoTaskIndex); item.classList.toggle('done', index < expoTaskIndex);
    list.append(item);
  });
}
function prepareExpoDialog() {
  clearInterval(expoTimer); expoTimer = undefined; expoPhase = 'idle'; trainedExpoModel = null; expoStartedStream = false;
  $('expo-intro').hidden = false; $('expo-training').hidden = true; $('expo-result').hidden = true; setExpoStage('prepare');
  const source = config.source === 'serial' ? 'Brazalete EMG · ' + ($<HTMLSelectElement>('port').value || 'sin puerto') : 'Generador de demostración';
  text('expo-source-title', source);
  text('expo-source-detail', running ? 'La adquisición ya está activa y se utilizará sin reiniciarla.' : 'La adquisición comenzará al iniciar el entrenamiento.');
  text('expo-feedback', 'Coloca el brazalete firme y conserva la misma posición del brazo durante toda la secuencia.');
}
function cancelExpoTraining(closeDialog = false) {
  clearInterval(expoTimer); expoTimer = undefined; expoPhase = 'idle'; expoFeatures = []; expoLabels = [];
  setAngles([0, 0, 0, 0, 0]); scene?.setPosture([0, 0, 0, 0, 0]);
  if (expoStartedStream) { stopStream(); expoStartedStream = false; }
  if (closeDialog && $<HTMLDialogElement>('expo-dialog').open) $<HTMLDialogElement>('expo-dialog').close();
}
function failExpoTraining(message: string) {
  clearInterval(expoTimer); expoTimer = undefined; expoPhase = 'idle';
  text('expo-training-status', message); $('expo-training-status').classList.add('error-text');
  $<HTMLButtonElement>('expo-cancel').textContent = 'Volver';
}
function beginExpoGesture() {
  const task = EXPO_TASKS[expoTaskIndex]; expoPhase = 'prepare'; expoPhaseEndsAt = ((lastFrame?.timestamp ?? 0) * 1000) + EXPO_PREP_MS;
  expoLastSampleCount = -1; expoTaskCaptured = 0; expoDynamicFlexed = false; expoDynamicChangedAt = 0; setExpoStage('capture'); renderExpoGestureList();
  const round = task.round === 'hold' ? 'Ronda 1 · postura mantenida' : 'Ronda 2 · movimiento repetido';
  text('expo-progress-label', round + ' · ' + (expoTaskIndex + 1) + ' de ' + EXPO_TASKS.length);
  text('expo-phase', 'PREPÁRATE'); text('expo-gesture', task.name); text('expo-instruction', task.round === 'hold' ? task.instruction : 'Flexiona y abre siguiendo el ritmo de la mano 3D.');
  text('expo-training-status', 'Observa la mano 3D y adopta la misma postura.'); $('expo-training-status').classList.remove('error-text');
  setAngles([...task.angles]); scene?.setPosture([...task.angles]);
}
function updateDynamicExpoTarget(signalNow: number, remaining: number) {
  const task = EXPO_TASKS[expoTaskIndex]; if (task.round !== 'dynamic') return;
  const elapsed = EXPO_CAPTURE_MS - remaining;
  const flexed = Math.floor(elapsed / EXPO_DYNAMIC_HALF_CYCLE_MS) % 2 === 0;
  if (flexed === expoDynamicFlexed && expoDynamicChangedAt) return;
  expoDynamicFlexed = flexed; expoDynamicChangedAt = signalNow;
  const target = flexed ? [...task.angles] : [0, 0, 0, 0, 0]; setAngles(target); scene?.setPosture(target);
  text('expo-phase', flexed ? 'FLEXIONA' : 'ABRE');
  text('expo-instruction', flexed ? 'Imita la flexión que muestra la mano 3D.' : 'Extiende de nuevo el dedo siguiendo la mano 3D.');
}
function updateExpoClock() {
  if (expoPhase === 'waiting') {
    if (running && lastFrame) beginExpoGesture();
    else text('expo-training-status', connecting ? 'Conectando con el brazalete…' : 'Esperando la primera ventana de señal…');
    return;
  }
  if (expoPhase !== 'prepare' && expoPhase !== 'capture') return;
  if (!running) { failExpoTraining('La adquisición se detuvo. Revisa el sensor y vuelve a comenzar.'); return; }
  const signalNow = (lastFrame?.timestamp ?? 0) * 1000; const remaining = Math.max(0, expoPhaseEndsAt - signalNow); text('expo-countdown', n(remaining / 1000, 1) + ' s');
  const phaseProgress = expoPhase === 'prepare' ? (EXPO_PREP_MS - remaining) / EXPO_PREP_MS * .2 : .2 + (EXPO_CAPTURE_MS - remaining) / EXPO_CAPTURE_MS * .8;
  $('expo-progress-fill').style.width = ((expoTaskIndex + Math.max(0, Math.min(1, phaseProgress))) / EXPO_TASKS.length * 100) + '%';
  if (expoPhase === 'capture') updateDynamicExpoTarget(signalNow, remaining);
  if (remaining > 0) return;
  if (expoPhase === 'prepare') {
    expoPhase = 'capture'; expoPhaseEndsAt = signalNow + EXPO_CAPTURE_MS;
    if (EXPO_TASKS[expoTaskIndex].round === 'hold') text('expo-phase', 'MANTÉN EL GESTO');
    else { expoDynamicChangedAt = 0; updateDynamicExpoTarget(signalNow, EXPO_CAPTURE_MS); }
    text('expo-training-status', 'Registrando la actividad muscular de este movimiento.');
    return;
  }
  if (expoTaskCaptured < 8) { failExpoTraining('No llegaron suficientes ventanas para este movimiento. Comprueba la señal y repite el entrenamiento.'); return; }
  expoTaskIndex++;
  if (expoTaskIndex < EXPO_TASKS.length) beginExpoGesture();
  else void trainCapturedExpoModel();
}
function captureExpoFrame(frame: Frame) {
  if (expoPhase !== 'capture' || frame.sample_count === expoLastSampleCount || frame.rms.length !== 8 || frame.mav.length !== 8) return;
  const features = [...frame.rms, ...frame.mav];
  if (!features.every(Number.isFinite)) return;
  const task = EXPO_TASKS[expoTaskIndex];
  if (task.round === 'dynamic' && frame.timestamp * 1000 - expoDynamicChangedAt < EXPO_TRANSITION_GUARD_MS) return;
  const label = task.round === 'dynamic' && !expoDynamicFlexed ? 'open' : task.id;
  expoLastSampleCount = frame.sample_count; expoTaskCaptured++; expoFeatures.push(features); expoLabels.push(label);
  text('expo-window-count', expoFeatures.length.toLocaleString('es-CL') + ' ventanas');
}
async function trainCapturedExpoModel() {
  clearInterval(expoTimer); expoTimer = undefined; expoPhase = 'training'; setExpoStage('train'); renderExpoGestureList();
  text('expo-phase', 'ENTRENANDO MODELO'); text('expo-gesture', 'Random Forest personalizado'); text('expo-instruction', 'Separando datos de entrenamiento y validación.'); text('expo-countdown', '…');
  text('expo-training-status', 'El procesamiento se realiza localmente en este equipo.');
  setAngles([0, 0, 0, 0, 0]); scene?.setPosture([0, 0, 0, 0, 0]);
  try {
    const response = await fetch('/api/expo/train', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $<HTMLInputElement>('expo-model-name').value, features: expoFeatures, labels: expoLabels, channels: configAtStart.channels, sample_rate: configAtStart.sample_rate, window_ms: configAtStart.window_ms }) });
    const data = await response.json() as { model?: ExpoModel; detail?: string };
    if (!response.ok || !data.model) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo entrenar el modelo.');
    trainedExpoModel = data.model; expoPhase = 'complete'; expoModels = [data.model, ...expoModels.filter(model => model.id !== data.model!.id)]; renderModelOptions();
    $('expo-training').hidden = true; $('expo-result').hidden = false; text('expo-result-name', data.model.name);
    text('expo-accuracy', Math.round(data.model.validation_accuracy * 100) + '%'); text('expo-samples', data.model.samples.toLocaleString('es-CL'));
    text('expo-result-summary', 'El clasificador fue entrenado y guardado en este equipo con ' + data.model.algorithm + '.'); icons();
  } catch (error) { failExpoTraining(error instanceof Error ? error.message : 'No se pudo entrenar el modelo.'); }
}
function startExpoTraining() {
  if (config.channels !== 8) { text('expo-feedback', 'Configura 8 canales antes de comenzar el entrenamiento Expo.'); return; }
  if (config.source === 'serial' && !$<HTMLSelectElement>('port').value) { text('expo-feedback', 'Selecciona el puerto del brazalete antes de comenzar.'); return; }
  if (!$<HTMLInputElement>('expo-model-name').value.trim()) { text('expo-feedback', 'Escribe un nombre para identificar el modelo.'); return; }
  expoTaskIndex = 0; expoFeatures = []; expoLabels = []; expoLastSampleCount = -1; expoTaskCaptured = 0; trainedExpoModel = null;
  $('expo-intro').hidden = true; $('expo-training').hidden = false; $('expo-result').hidden = true; $<HTMLButtonElement>('expo-cancel').textContent = 'Cancelar';
  text('expo-window-count', '0 ventanas'); $('expo-progress-fill').style.width = '0%'; setMode('manual'); renderExpoGestureList();
  expoPhase = 'waiting'; text('expo-phase', 'CONECTANDO'); text('expo-gesture', 'Esperando señal EMG'); text('expo-instruction', 'La secuencia comenzará cuando llegue la primera ventana válida.'); text('expo-countdown', '—');
  if (!running && !connecting) { expoStartedStream = true; startStream(); }
  expoTimer = setInterval(updateExpoClock, 100); updateExpoClock();
}
function useTrainedExpoModel() {
  if (!trainedExpoModel) return;
  stopStream(); config.model = 'expo'; config.model_id = trainedExpoModel.id; syncConfig(); setMode('emg');
  $<HTMLDialogElement>('expo-dialog').close(); notify('Modelo “' + trainedExpoModel.name + '” activo. Reiniciando la adquisición para controlar la mano 3D.');
  setTimeout(() => startStream(), 400);
}
$('expo-start').addEventListener('click', startExpoTraining);
$('expo-cancel').addEventListener('click', () => cancelExpoTraining(true));
$('expo-use-model').addEventListener('click', useTrainedExpoModel);
$('expo-dialog').addEventListener('close', () => { if (expoPhase !== 'complete') cancelExpoTraining(); });

function updateRecording() {
  const button = $('record-button'); button.classList.toggle('recording', recording); button.innerHTML = '<span class="record-dot"></span>' + (recording ? 'Detener registro' : 'Grabar');
  text('record-status', recording ? 'Grabando · ' + session!.raw.length.toLocaleString('es-CL') + ' muestras' : session?.raw.length ? 'Sesión en memoria · ' + session.raw.length.toLocaleString('es-CL') + ' muestras' : 'Sin sesión grabada');
  $('record-status').classList.toggle('session-active', recording);
}
$('record-button').addEventListener('click', () => {
  if (recording) { recording = false; updateRecording(); return; }
  if (!running) { notify('Inicia la adquisición antes de grabar.'); return; }
  if (session?.raw.length && !window.confirm('La nueva grabación reemplazará la sesión en memoria. ¿Ya exportaste los datos y deseas continuar?')) return;
  // Preserve preceding context so the first saved inference has a complete raw window.
  const context = samples.slice(-Math.max(1, Math.round(configAtStart.sample_rate * configAtStart.window_ms / 1000) - 1));
  session = { started_at: new Date().toISOString(), config: { ...configAtStart }, raw: [...context], frames: [], start_t: context[0]?.t ?? null, pre_roll_samples: context.length }; recording = true; updateRecording(); notify('Grabación iniciada con contexto previo de ventana. Guarda los CSV antes de cerrar esta pestaña.');
});
function updateSession() {
  const count = session?.raw.length ?? 0;
  text('session-summary', count ? count.toLocaleString('es-CL') + ' muestras · ' + session!.frames.length + ' ventanas' : 'Todavía no hay muestras grabadas.');
  text('session-detail', count ? (session!.config.source === 'demo' ? 'Señal sintética' : 'Señal serial cruda') + ' · ' + session!.config.channels + ' canales · ' + session!.config.sample_rate + ' Hz. ' + (recording ? 'El registro continúa.' : 'Lista para exportar.') : 'Inicia la adquisición y pulsa Grabar. El registro se mantiene en esta pestaña hasta que la cierres.');
  ['download-raw', 'download-windows', 'download-metadata'].forEach(id => { $<HTMLButtonElement>(id).disabled = !count; });
}
function download(content: string, extension: string, suffix: string, mime: string) {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = 'myohand-' + session!.started_at.replace(/[:.]/g, '-') + '-' + suffix + '.' + extension; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (rows: (string | number | null)[][]) => rows.map(row => row.map(cell => cell === null ? '' : typeof cell === 'number' ? String(cell) : '"' + cell.replace(/"/g, '""') + '"').join(',')).join('\r\n');
$('download-raw').addEventListener('click', () => {
  if (!session?.raw.length) return;
  const header = ['time_s', ...Array.from({ length: session.config.channels }, (_, i) => 'ch_' + (i + 1)), 'source'];
  const rows = session.raw.map(s => [s.t, ...s.values, session!.config.source]);
  download(csv([header, ...rows]), 'csv', 'signal', 'text/csv;charset=utf-8');
});
$('download-windows').addEventListener('click', () => {
  if (!session?.frames.length) return;
  const channels = Array.from({ length: session.config.channels }, (_, i) => i + 1);
  const header = ['window_end_s', 'sample_count', ...channels.map(c => 'rms_' + c), ...channels.map(c => 'mav_' + c), 'activation', 'thumb_deg', 'index_deg', 'middle_deg', 'ring_deg', 'little_deg', 'gesture', 'confidence', 'inference_ms', 'source', 'model'];
  const rows = session.frames.map(f => [f.timestamp, f.sample_count, ...f.rms, ...f.mav, f.activation, ...f.angles, f.gesture, f.confidence, f.latency_ms, f.source, f.model]);
  download(csv([header, ...rows]), 'csv', 'predictions', 'text/csv;charset=utf-8');
});
$('download-metadata').addEventListener('click', () => {
  if (!session) return;
  download(JSON.stringify({ version: '0.1.0', started_at: session.started_at, config: session.config, raw_sample_count: session.raw.length, frames: session.frames.length, pre_roll_samples: session.pre_roll_samples, acquisition_time_start_s: session.start_t, acquisition_time_end_s: session.raw.at(-1)?.t, timestamp_basis: 'sample_index / declared_sample_rate; not hardware timestamps', preprocessing: 'none in acquisition; custom model adapter responsible for training preprocessing', baseline_activation: 'clipped mean-channel RMS scaled by rest and mvc', units: session.config.source === 'demo' ? 'normalized synthetic' : 'raw sensor units', inference_latency_scope: 'server feature extraction and inference only', hand: { controls: '5 coupled flexion commands, 0..90; exported predictions are unmodified by collision constraints', geometry: 'mechanical hand v3, seated finger mounts and three-link CMC/MCP/IP thumb', contact: 'Rapier convex rigid enclosures with conservative motion advances and local joint exemptions', clearance_model_units: 0.004, max_control_speed_deg_s: 120, dynamics: 'no force, friction or deformation calculation; not calibrated against physical hardware' } }, null, 2), 'json', 'metadata', 'application/json');
});

const chart = $<HTMLCanvasElement>('signal-chart');
function drawChart() {
  const rect = chart.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2); const width = rect.width; const height = rect.height;
  if (chart.width !== Math.round(width * ratio) || chart.height !== Math.round(height * ratio)) { chart.width = Math.round(width * ratio); chart.height = Math.round(height * ratio); }
  const ctx = chart.getContext('2d')!; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
  const left = 40, right = width - 6, top = 6, bottom = height - 23, mid = (top + bottom) / 2, half = (bottom - top) / 2;
  const activeChannels = activeChannelIndexes();
  let max = config.source === 'demo' ? 1 : 0.001;
  for (const sample of samples) for (const channel of activeChannels) max = Math.max(max, Math.abs(sample.values[channel] ?? 0));
  max *= 1.08;
  ctx.font = '8px "Space Grotesk", monospace'; ctx.fillStyle = '#607d91'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let row = 0; row < 5; row++) { const y = top + (bottom - top) * row / 4; ctx.strokeStyle = row === 2 ? '#2a4050' : '#1d2c38'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); const label = max * (1 - row / 2); ctx.fillText(Math.abs(label) >= 10 ? label.toFixed(0) : label.toFixed(2), left - 8, y); }
  for (let col = 0; col <= 10; col++) { const x = left + (right - left) * col / 10; ctx.strokeStyle = '#1e2d38'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); if (col % 2 === 0 && col < 10) { ctx.textAlign = 'center'; ctx.fillStyle = '#526f85'; ctx.fillText(String(-5 + col / 2) + ' s', x, height - 9); } }
  if (!activeChannels.length) { ctx.textAlign = 'center'; ctx.fillStyle = '#7590a3'; ctx.font = '10px "DM Sans", sans-serif'; ctx.fillText('Activa los canales que quieras comparar', (left + right) / 2, mid - 12); return; }
  if (!samples.length) { ctx.textAlign = 'center'; ctx.fillStyle = '#577488'; ctx.font = '10px "DM Sans", sans-serif'; ctx.fillText('Inicia la adquisición · ' + config.channels + ' canales disponibles', (left + right) / 2, mid - 12); return; }
  const end = lastFrame?.timestamp ?? 5; const start = end - 5; const xAt = (t: number) => left + (t - start) / 5 * (right - left);
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
  // Preserve each channel's min/max extrema per horizontal pixel so peaks remain visible.
  for (const channel of activeChannels) {
    const buckets = new Map<number, [number, number]>();
    for (const sample of samples) {
      const x = Math.floor(xAt(sample.t)); const value = sample.values[channel] ?? 0; const range = buckets.get(x);
      if (range) { range[0] = Math.min(range[0], value); range[1] = Math.max(range[1], value); }
      else buckets.set(x, [value, value]);
    }
    ctx.strokeStyle = CHANNEL_COLORS[channel % CHANNEL_COLORS.length]; ctx.lineWidth = .85; ctx.globalAlpha = .9; ctx.beginPath();
    let first = true;
    for (const [x, [min, maxValue]] of buckets) {
      const a = mid - min / max * half, b = mid - maxValue / max * half;
      if (first) { ctx.moveTo(x, a); first = false; } else ctx.lineTo(x, a);
      ctx.lineTo(x, b);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.restore();
}
new ResizeObserver(drawChart).observe(chart);
setInterval(() => {
  if (running && performance.now() - lastFrameReceivedAt > 3000) { text('connection-status', 'SIN DATOS'); text('backend-status', 'Sin muestras nuevas; comprueba el sensor'); }
}, 1000);
async function health() {
  try { const response = await fetch('/api/health', { signal: AbortSignal.timeout(3000) }); if (!response.ok) throw new Error(); if (!running && !connecting) { text('backend-status', 'Servicio Python conectado'); $('backend-dot').className = 'status-dot'; } }
  catch { if (!running) { text('backend-status', 'Servicio Python no disponible · ejecuta iniciar.ps1'); $('backend-dot').className = 'status-dot error'; } }
}
window.addEventListener('beforeunload', event => { if (session?.raw.length) { event.preventDefault(); } });
window.addEventListener('pagehide', () => { socket?.close(); scene?.dispose(); });
async function selectConnectedSensor() {
  const ports = await refreshPorts();
  const preferred = ports.find(port => /CH340|USB-SERIAL/i.test(port.description));
  if (!preferred && ports.length !== 1) return;
  config.source = 'serial'; $<HTMLSelectElement>('source').value = 'serial'; $('serial-fields').hidden = false;
  text('source-note', ($<HTMLSelectElement>('port').value || preferred?.device) + ' detectado · listo para iniciar');
  text('signal-unit', 'ADC centrado · −1 a 1'); drawChart();
}
syncConfig(); setAngles(angles); setMode('manual'); updateStreamUI(); icons(); void health(); void refreshExpoModels(); void selectConnectedSensor(); setInterval(health, 15000); drawChart();
