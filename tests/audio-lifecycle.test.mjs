import assert from 'node:assert';

// ===== Мок-середовище: реєстр слухачів подій, лічильник AudioContext, керований Howl =====
const listeners = new Set(); // "target|type|capture" + посилання на обробник
const registry = [];
function makeTarget(name, extra = {}) {
  return {
    ...extra,
    addEventListener(type, fn, opts) {
      const capture = typeof opts === 'object' ? !!opts?.capture : !!opts;
      registry.push({ name, type, fn, capture });
    },
    removeEventListener(type, fn, opts) {
      const capture = typeof opts === 'object' ? !!opts?.capture : !!opts;
      const i = registry.findIndex(r => r.name === name && r.type === type && r.fn === fn && r.capture === capture);
      if (i >= 0) registry.splice(i, 1);
    }
  };
}

class MockAudioParam {
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
let contextCount = 0;
const PARAM_NAMES = new Set(['gain', 'frequency', 'Q', 'pan', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate']);
const genericNode = () => new Proxy({}, {
  get: (t, p) => (p in t ? t[p] : PARAM_NAMES.has(p) ? (t[p] = new MockAudioParam()) : p === 'connect' ? (n => n) : () => {})
});
class MockAudioContext {
  constructor() {
    contextCount++;
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
    // Будь-який create* без явної реалізації повертає загальний вузол, щоб мок не видавав себе за баг у коді
    return new Proxy(this, {
      get: (t, p) => (p in t ? t[p] : typeof p === 'string' && p.startsWith('create') ? genericNode : undefined)
    });
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createOscillator() { return { type: 'sine', frequency: new MockAudioParam(440), connect(n) { return n; }, start() {}, stop() {}, disconnect(n) { return n; }, addEventListener() {} }; }
  createBiquadFilter() { return { type: 'lowpass', frequency: new MockAudioParam(350), Q: new MockAudioParam(1), connect(n) { return n; }, disconnect(n) { return n; } }; }
  createGain() { return { gain: new MockAudioParam(1), connect(n) { return n; }, disconnect(n) { return n; } }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, connect(n) { return n; }, start() {}, stop() {}, disconnect(n) { return n; }, addEventListener() {} }; }
}

class MockHowl {
  constructor(opts) { this.opts = opts; this.playCount = 0; this._playing = false; MockHowl.last = this; }
  state() { return 'loaded'; }
  play() { this.playCount++; this._playing = true; return this.playCount; }
  stop() { this._playing = false; setTimeout(() => this.opts.onstop?.(1), 0); } // Howler повідомляє про зупинку асинхронно
  playing() { return this._playing; }
  volume() { return 1; }
  rate() {}
  loop() {}
  once() {}
  fade() {}
}

globalThis.window = makeTarget('window', {
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  Howler: { mute() {}, stop() {} },
  Howl: null
});
globalThis.document = makeTarget('document', { hidden: false, getElementById: () => null });
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { soundManager, SOUND_IDS } = await import('../js/services/sound-manager.js');
const { AudioSynth } = await import('../js/services/audio-synth.js');
const sfx = await import('../js/utils/sfx.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function reset() {
  soundManager.setMuted(false);
  soundManager.stopAll();
  await sleep(450); // дати відпрацювати згасанню синтезатора
}

let failed = 0;
async function check(name, fn) {
  try {
    await reset();
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    const where = err.name !== 'AssertionError' ? `\n       at ${(err.stack || '').split('\n').slice(1, 3).join(' | ').trim()}` : '';
    console.error(`  FAIL ${name}\n       ${err.message}${where}`);
  }
}

console.log('Running audio-lifecycle tests...');
soundManager.init();

await check('A-C1: повторний play(BUNKER_AMBIENT) не вимикає синтез-ембієнт', async () => {
  window.Howl = null;
  soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true, 'перший play має запустити ембієнт');
  soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true, 'другий play вимкнув ембієнт (toggle)');
  assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true);
});

await check('A-C1: startAmbient() багато разів поспіль лишає ембієнт увімкненим', async () => {
  window.Howl = null;
  for (let i = 0; i < 3; i++) { // непарна кількість: парна випадково «латала» б toggle
    soundManager.startAmbient();
    soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true }); // як _resumeAmbientIfWanted / visibilitychange
  }
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true);
});

await check('A-C1: stopAmbient() справді зупиняє, а наступний startAmbient() знову вмикає', async () => {
  window.Howl = null;
  soundManager.startAmbient();
  soundManager.stopAmbient();
  assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false);
  soundManager.startAmbient();
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true);
});

await check('A-C2: асинхронний onstop Howler не скидає бажання грати ембієнт (відновлення після unmute)', async () => {
  window.Howl = MockHowl;
  soundManager.startAmbient();
  await sleep(10); // тут приходить onstop від howl.stop() усередині play() (interrupt)
  const howl = MockHowl.last;
  assert.ok(howl, 'Howl має бути створений');
  howl._playing = false; // браузер/Howler зупинив відтворення
  soundManager.setMuted(true);
  soundManager.setMuted(false);
  assert.strictEqual(howl.playCount >= 2, true, `ембієнт не відновився після unmute (play викликано ${howl.playCount} раз)`);
  window.Howl = null;
});

await check('A-C3: sfx.js і AudioSynth ділять один AudioContext', async () => {
  window.Howl = null;
  AudioSynth.getContext();
  sfx.unlockAudio();
  sfx.playHeartbeat(1);
  // Усе застосунку (SoundManager + AudioSynth + sfx) має користуватись одним контекстом: на мобільних ліміт контекстів малий
  assert.strictEqual(contextCount, 1, `створено ${contextCount} AudioContext, очікувався 1`);
});

await check('A-C4: destroy() прибирає всі глобальні слухачі', async () => {
  // Слухачі sfx.js (onGesture) модульні й самознімаються після розблокування контексту — це не слухачі SoundManager
  const own = () => registry.filter(r => r.fn.name !== 'onGesture').map(r => `${r.name}:${r.type}`);
  assert.ok(own().length > 0, 'передумова: слухачі SoundManager зареєстровано');
  assert.strictEqual(typeof soundManager.destroy, 'function', 'soundManager.destroy() відсутній');
  soundManager.destroy();
  assert.deepStrictEqual(own(), [], 'після destroy лишились слухачі');
  soundManager.init(); // повторна ініціалізація після destroy має працювати без подвоєння
  const afterReinit = own().length;
  soundManager.destroy();
  assert.ok(afterReinit > 0, 'init() після destroy() не зареєстрував слухачів');
  assert.deepStrictEqual(own(), [], 'після другого destroy лишились слухачі');
});

if (failed) {
  console.error(`FAIL: audio-lifecycle (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all audio-lifecycle tests passed!');
process.exit(0);
