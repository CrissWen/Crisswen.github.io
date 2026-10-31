import assert from 'node:assert';

let visibilityCallback = null;

class MockAudioParam {
  constructor(val = 1) {
    this.value = val;
  }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}

class MockGainNode {
  constructor() {
    this.gain = new MockAudioParam(1);
  }
  connect() {}
  disconnect() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
    this.oscCount = 0;
  }
  resume() { return Promise.resolve(); }
  createOscillator() {
    this.oscCount++;
    return {
      type: 'sine',
      frequency: new MockAudioParam(440),
      connect() {},
      start() {},
      stop() {},
      disconnect() {},
    };
  }
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: new MockAudioParam(350),
      Q: new MockAudioParam(1),
      connect() {},
      disconnect() {},
    };
  }
  createGain() {
    return new MockGainNode();
  }
  createBuffer(ch, len, sr) {
    return {
      getChannelData: () => new Float32Array(len),
    };
  }
  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start() {},
      stop() {},
      disconnect() {},
    };
  }
}

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  Howler: { mute: () => {}, stop: () => {} },
  // Howl відсутній або кидає помилку завантаження -> перевіряємо фоллбек на AudioSynth
  Howl: null,
};

globalThis.document = {
  hidden: false,
  addEventListener: (event, cb) => {
    if (event === 'visibilitychange') visibilityCallback = cb;
  },
  removeEventListener: () => {},
  getElementById: () => null,
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { soundManager, SOUND_IDS } = await import('../js/services/sound-manager.js');
const { AudioSynth } = await import('../js/services/audio-synth.js');

async function runTests() {
  console.log('Running sound-manager-fallback tests...');
  soundManager.init();

  // 1. Перевіряємо, що SoundManager використовує AudioSynth як фоллбек для всіх основних звуків
  const ctx = AudioSynth.getContext();
  const beforeOsc = ctx.oscCount;

  soundManager.play(SOUND_IDS.UI_CLICK, { bypassThrottle: true });
  assert.ok(ctx.oscCount > beforeOsc, 'SoundManager fallback must delegate to AudioSynth');

  // 2. Перевіряємо делегування зацикленої сирени та її зупинку через soundManager.stop()
  soundManager.play(SOUND_IDS.CATACLYSM_ALERT, { bypassThrottle: true, loop: true });
  soundManager.stop(SOUND_IDS.CATACLYSM_ALERT);

  // 3. Перевіряємо делегування фонового ембієнт-дрона до AudioSynth
  soundManager._toggleAmbientDrone(0.5);
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true, 'AudioSynth ambient must be playing after _toggleAmbientDrone');
  assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true, 'soundManager.isPlaying(BUNKER_AMBIENT) must reflect AudioSynth state');

  // 4. Перевіряємо stopAll()
  soundManager.stopAll();
  assert.strictEqual(AudioSynth.isAmbientPlaying(), false, 'stopAll() must stop AudioSynth ambient');
  assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false);

  // 5. Перевіряємо керування глобальними UI-кліками (disableGlobalClicks / enableGlobalClicks)
  assert.strictEqual(soundManager.isGlobalClicksEnabled(), true);
  soundManager.disableGlobalClicks();
  assert.strictEqual(soundManager.isGlobalClicksEnabled(), false, 'disableGlobalClicks must disable global clicks');
  soundManager.enableGlobalClicks();
  assert.strictEqual(soundManager.isGlobalClicksEnabled(), true, 'enableGlobalClicks must re-enable global clicks');

  console.log('PASS: All sound-manager-fallback tests passed!');
}

runTests().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
