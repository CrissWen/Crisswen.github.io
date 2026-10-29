// ===== Звукові ефекти (Web Audio API, без файлів і бібліотек) =====
// Звуки синтезуються в браузері, тож нічого не вантажать і не мають питань з ліцензіями. За бажання будь-який з них
// можна замінити власним mp3/ogg через configureSfx({ files: { tick, reveal } }) (див. cataclysmRoulette.sounds у game-config.base.js);
// якщо файл не завантажився, лишається синтез.
// Перемикач «без звуку» зберігається в localStorage й діє на всі звуки гри, тож кнопку можна повісити де завгодно.

const MUTE_KEY = 'bunker-sfx-muted';
const MIN_TICK_GAP_MS = 30; // «тіки» частіші за це зливаються в тріск, тож пропускаємо зайві

let audioCtx = null;
let masterGain = null;
let muted = readMuted();
let enabled = true;
let volume = 0.5;
const fileUrls = new Map();    // назва звуку → URL власного файлу
const fileBuffers = new Map(); // назва звуку → AudioBuffer (або null, якщо завантаження не вдалося)
let lastTickAt = 0;

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

// Контекст створюється ліниво і лише після першої дії користувача: інакше браузер пише в консоль попередження про автозапуск
function ensureContext() {
  if (audioCtx) return audioCtx;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted || !enabled ? 0 : volume;
    masterGain.connect(audioCtx.destination);
    fileUrls.forEach((url, name) => loadFile(name, url));
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

async function loadFile(name, url) {
  if (!audioCtx || fileBuffers.has(name)) return;
  fileBuffers.set(name, null);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await audioCtx.decodeAudioData(await response.arrayBuffer());
    fileBuffers.set(name, buffer);
  } catch (err) {
    console.warn(`[sfx] Не вдалося завантажити звук «${name}» (${url}), лишається синтез:`, err);
  }
}

function applyGain() {
  if (masterGain) masterGain.gain.value = muted || !enabled ? 0 : volume;
}

// Перемикач звуку в іншій вкладці (напр. у грі, поки тест відкритий окремо): події storage приходять лише в інші вкладки
window.addEventListener('storage', event => {
  if (event.key !== MUTE_KEY) return;
  muted = event.newValue === '1';
  applyGain();
});

// Браузери вмикають звук лише після жесту користувача; iOS Safari вимагає resume() саме всередині обробника жесту
export function unlockAudio() {
  const ctx = ensureContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function onGesture() {
  unlockAudio();
  if (audioCtx && audioCtx.state === 'running') {
    ['pointerdown', 'keydown', 'touchend'].forEach(type => window.removeEventListener(type, onGesture, true));
  }
}
['pointerdown', 'keydown', 'touchend'].forEach(type => window.addEventListener(type, onGesture, { capture: true, passive: true }));

// Налаштування з конфігу: { enabled, volume (0..1), files: { tick: 'url', reveal: 'url' } }. Можна викликати багато разів.
export function configureSfx({ enabled: isEnabled = true, volume: level = 0.5, files = {} } = {}) {
  enabled = isEnabled !== false;
  volume = Math.min(1, Math.max(0, Number(level) || 0));
  applyGain();
  Object.entries(files).forEach(([name, url]) => {
    if (typeof url !== 'string' || !url) return;
    fileUrls.set(name, url);
    if (audioCtx) loadFile(name, url);
  });
}

export function isSfxMuted() {
  return muted;
}

export function setSfxMuted(value) {
  muted = !!value;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch { /* приватний режим: вимкнення діє до перезавантаження */ }
  applyGain();
  if (!muted) unlockAudio();
}

function ready() {
  if (muted || !enabled) return null;
  const ctx = ensureContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx.state === 'running' ? ctx : null;
}

function playBuffer(ctx, buffer, { rate = 1, gain = 1 } = {}) {
  const source = ctx.createBufferSource();
  const level = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  level.gain.value = gain;
  source.connect(level).connect(masterGain);
  source.start();
}

// Короткий «клац» стрілки, що проходить повз елемент. speed (0..1): швидка стрічка — вищий і тихіший звук,
// повільна наприкінці — глибший і виразніший, тож «доповзання» звучить як гальмування.
export function playTick(speed = 0) {
  const nowMs = performance.now();
  if (nowMs - lastTickAt < MIN_TICK_GAP_MS) return;
  const ctx = ready();
  if (!ctx) return;
  lastTickAt = nowMs;

  const v = Math.min(1, Math.max(0, speed));
  const own = fileBuffers.get('tick');
  if (own) {
    playBuffer(ctx, own, { rate: 0.92 + v * 0.16, gain: 0.9 - v * 0.35 });
    return;
  }

  // «Клац» механічної храповки: різкий шумовий імпульс (сухий тріск) + дуже короткий «тук» зверху.
  // Повільна стрічка (v → 0) звучить нижче й гучніше, швидка — вище й тихіше.
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.022);
  const noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const noise = ctx.createBufferSource();
  const band = ctx.createBiquadFilter();
  const noiseEnv = ctx.createGain();
  noise.buffer = noiseBuffer;
  band.type = 'bandpass';
  band.frequency.value = 4200 - (1 - v) * 1400;
  band.Q.value = 1.1;
  noiseEnv.gain.setValueAtTime(1.0 - v * 0.35, t);
  noiseEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.024);
  noise.connect(band).connect(noiseEnv).connect(masterGain);
  noise.start(t);

  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(2300 + v * 700, t);
  osc.frequency.exponentialRampToValueAtTime(650, t + 0.018);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.32 - v * 0.14, t + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);
  osc.connect(env).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.03);
}

// ===== Напруження перед ривком (тільки синтез: власних файлів для них немає) =====

// Серцебиття: два глухих удари «тук-тук». strength (0..1) наростає разом із напругою
export function playHeartbeat(strength = 0.7) {
  const ctx = ready();
  if (!ctx) return;
  const level = Math.min(1, Math.max(0, strength));
  const t = ctx.currentTime;
  [[0, 1], [0.17, 0.72]].forEach(([offset, gain]) => {
    const start = t + offset;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(78, start);
    osc.frequency.exponentialRampToValueAtTime(34, start + 0.16);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime((0.35 + 0.5 * level) * gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(env).connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.22);
  });
}

// Наростаючий «райзер»: гудіння, що піднімається вгору на ms мілісекунд.
// Повертає stop(): плавно глушить звук, якщо рулетку закрито раніше
export function playRiser(ms) {
  const ctx = ready();
  if (!ctx) return () => {};
  const dur = Math.max(0.3, Number(ms) / 1000 || 0.3);
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const env = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(760, t + dur);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(350, t);
  filter.frequency.exponentialRampToValueAtTime(4800, t + dur);
  filter.Q.value = 2.5;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.92);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
  osc.connect(filter).connect(env).connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + 0.06);
  return () => {
    try {
      const now = ctx.currentTime;
      env.gain.cancelScheduledValues(now);
      env.gain.setTargetAtTime(0.0001, now, 0.02);
      osc.stop(now + 0.12);
    } catch { /* уже зупинено */ }
  };
}

// Ривок на справжній результат: різкий «візг» шуму, що падає по частоті, і глухий удар
// для ваги (до того ж, що райзер обривається рівно в цей момент)
export function playSnap() {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;

  const len = Math.floor(ctx.sampleRate * 0.16);
  const noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const noise = ctx.createBufferSource();
  const band = ctx.createBiquadFilter();
  const noiseEnv = ctx.createGain();
  noise.buffer = noiseBuffer;
  band.type = 'bandpass';
  band.frequency.setValueAtTime(5200, t);
  band.frequency.exponentialRampToValueAtTime(700, t + 0.15);
  band.Q.value = 0.9;
  noiseEnv.gain.setValueAtTime(0.7, t);
  noiseEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  noise.connect(band).connect(noiseEnv).connect(masterGain);
  noise.start(t);

  const thud = ctx.createOscillator();
  const thudEnv = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(170, t);
  thud.frequency.exponentialRampToValueAtTime(58, t + 0.12);
  thudEnv.gain.setValueAtTime(0.0001, t);
  thudEnv.gain.exponentialRampToValueAtTime(0.55, t + 0.008);
  thudEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  thud.connect(thudEnv).connect(masterGain);
  thud.start(t);
  thud.stop(t + 0.18);
}

// Розв'язка «лишилась»: стрілка не підсунулась, напруження спадає. М'який глухий удар і коротка «видихаюча» нота вгору, без різкого «візгу» ривка
export function playRelief() {
  const ctx = ready();
  if (!ctx) return;
  const t = ctx.currentTime;

  const thud = ctx.createOscillator();
  const thudEnv = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(125, t);
  thud.frequency.exponentialRampToValueAtTime(48, t + 0.2);
  thudEnv.gain.setValueAtTime(0.0001, t);
  thudEnv.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
  thudEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  thud.connect(thudEnv).connect(masterGain);
  thud.start(t);
  thud.stop(t + 0.26);

  const tone = ctx.createOscillator();
  const toneEnv = ctx.createGain();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(392, t + 0.02);
  tone.frequency.exponentialRampToValueAtTime(523.25, t + 0.22);
  toneEnv.gain.setValueAtTime(0.0001, t + 0.02);
  toneEnv.gain.exponentialRampToValueAtTime(0.13, t + 0.05);
  toneEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  tone.connect(toneEnv).connect(masterGain);
  tone.start(t + 0.02);
  tone.stop(t + 0.36);
}

// Фінальний акцент: низький «удар» і короткий висхідний акорд
export function playReveal() {
  const ctx = ready();
  if (!ctx) return;

  const own = fileBuffers.get('reveal');
  if (own) {
    playBuffer(ctx, own);
    return;
  }

  const t = ctx.currentTime;

  const boom = ctx.createOscillator();
  const boomEnv = ctx.createGain();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(130, t);
  boom.frequency.exponentialRampToValueAtTime(42, t + 0.55);
  boomEnv.gain.setValueAtTime(0.0001, t);
  boomEnv.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
  boomEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  boom.connect(boomEnv).connect(masterGain);
  boom.start(t);
  boom.stop(t + 0.75);

  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const start = t + 0.06 + i * 0.07;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
    osc.connect(env).connect(masterGain);
    osc.start(start);
    osc.stop(start + 1.15);
  });
}
