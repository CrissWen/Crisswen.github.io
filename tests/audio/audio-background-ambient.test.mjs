import assert from 'node:assert';

const registry = [];
function makeTarget(name, extra = {}) {
  const target = {
    ...extra,
    addEventListener(type, fn, opts) {
      const capture = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      registry.push({ name, type, fn, capture });
    },
    removeEventListener(type, fn, opts) {
      const capture = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      const i = registry.findIndex(r => r.name === name && r.type === type && r.fn === fn && r.capture === capture);
      if (i >= 0) registry.splice(i, 1);
    },
    dispatchEvent(type, eventObj = {}) {
      const list = registry.filter(r => r.name === name && r.type === type);
      for (const r of list) r.fn(eventObj);
    }
  };
  return target;
}

class MockAudioParam {
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}

const PARAM_NAMES = new Set(['gain', 'frequency', 'Q', 'pan', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release', 'delayTime', 'playbackRate']);
const genericNode = () => new Proxy({}, {
  get: (t, p) => (p in t ? t[p] : PARAM_NAMES.has(p) ? (t[p] = new MockAudioParam()) : p === 'connect' ? (n => n) : () => {})
});

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
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
  constructor(opts) {
    this.opts = opts;
    this.playCount = 0;
    this._playing = false;
    this._vol = 1;
    MockHowl.last = this;
  }
  state() { return 'loaded'; }
  play() {
    this.playCount++;
    this._playing = true;
    return this.playCount;
  }
  pause() {
    this._playing = false;
  }
  stop() {
    this._playing = false;
  }
  playing() { return this._playing; }
  volume(v) {
    if (v !== undefined) this._vol = v;
    return this._vol;
  }
  rate() {}
  loop() {}
  once() {}
  fade(from, to, ms) {
    this._vol = to;
    if (to === 0) this._playing = false;
  }
}

const windowMock = makeTarget('window', {
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  Howler: { mute() {}, stop() {} },
  Howl: MockHowl
});

const documentMock = makeTarget('document', {
  hidden: false,
  getElementById: () => null
});

let storageData = {};
const localStorageMock = {
  getItem: (k) => storageData[k] ?? null,
  setItem: (k, v) => { storageData[k] = String(v); },
  clear: () => { storageData = {}; }
};

globalThis.window = windowMock;
globalThis.document = documentMock;
globalThis.localStorage = localStorageMock;

const { soundManager, SOUND_IDS } = await import('../../js/services/sound-manager.js');
const { AudioSynth } = await import('../../js/services/audio-synth.js');

console.log('Running audio-background-ambient tests...');
soundManager.init();
await soundManager.unlock();

// 1. Test: startAmbient() while document.hidden && !backgroundAmbient must NOT start audible playback in background
documentMock.hidden = true;
soundManager.setBackgroundAmbient(false);
soundManager.stopAmbient();

soundManager.startAmbient();
assert.strictEqual(
  soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT),
  false,
  'startAmbient() while document.hidden && !backgroundAmbient must NOT be playing in background'
);

// When document becomes visible, it must resume smoothly
documentMock.hidden = false;
documentMock.dispatchEvent('visibilitychange');
assert.strictEqual(
  soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT),
  true,
  'ambient must resume playing when document becomes visible'
);

// 2. Test: setBackgroundAmbient(false) while document.hidden must immediately pause playing ambient
soundManager.setBackgroundAmbient(true);
documentMock.hidden = true;
documentMock.dispatchEvent('visibilitychange');
// Since backgroundAmbient was true, ambient should be playing in background
assert.strictEqual(
  soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT),
  true,
  'ambient should be playing in background when backgroundAmbient is true'
);

// Now disable background ambient while still hidden: it must pause immediately without tab switch
soundManager.setBackgroundAmbient(false);
assert.strictEqual(
  soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT),
  false,
  'setBackgroundAmbient(false) while document.hidden must immediately pause ambient'
);

// 3. Test: storage event disabling backgroundAmbient while document.hidden must immediately pause ambient
soundManager.setBackgroundAmbient(true);
documentMock.hidden = true;
documentMock.dispatchEvent('visibilitychange');
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true);

// Simulate storage event from another tab disabling backgroundAmbient
storageData['bunker-audio-settings'] = JSON.stringify({
  masterVolume: 0.8,
  sfxVolume: 1,
  uiVolume: 1,
  musicVolume: 0.8,
  muted: false,
  backgroundAmbient: false
});
windowMock.dispatchEvent('storage', { key: 'bunker-audio-settings' });

assert.strictEqual(
  soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT),
  false,
  'storage event with backgroundAmbient: false while document.hidden must immediately pause ambient'
);

console.log('PASS: All audio-background-ambient tests passed!');
