import assert from 'node:assert';

// I-1: one-shot інстанси синтезатора мають самі прибиратися з _activeInstances,
// коли всі їхні джерела закінчили звучати (sourceNode.onended).

class MockParam {
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}

const createdSources = [];
const createdGains = [];

function makeSource() {
  const s = {
    type: 'sine',
    buffer: null,
    frequency: new MockParam(440),
    onended: null,
    started: false,
    stopped: false,
    connect(n) { return n; },
    disconnect() {},
    start() { this.started = true; },
    stop() { this.stopped = true; },
  };
  createdSources.push(s);
  return s;
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = {};
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createOscillator() { return makeSource(); }
  createBufferSource() { return makeSource(); }
  createBiquadFilter() {
    return { type: 'lowpass', frequency: new MockParam(350), Q: new MockParam(1), connect(n) { return n; }, disconnect() {} };
  }
  createGain() {
    const g = { gain: new MockParam(1), disconnected: false, connect(n) { return n; }, disconnect() { this.disconnected = true; } };
    createdGains.push(g);
    return g;
  }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}

globalThis.window = {
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { AudioSynth } = await import('../js/services/audio-synth.js');

let failed = 0;
function check(name, fn) {
  try {
    AudioSynth.stopAll(0);
    createdSources.length = 0;
    createdGains.length = 0;
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('Running audio-instance-cleanup tests...');

check('I-1: є лічильник активних інстансів і він починається з нуля', () => {
  assert.strictEqual(typeof AudioSynth.getActiveCount, 'function', 'AudioSynth.getActiveCount() відсутній');
  assert.strictEqual(AudioSynth.getActiveCount(), 0);
});

check('I-1: one-shot інстанс видаляється, коли всі джерела завершились', () => {
  AudioSynth.play('ui-click');
  assert.ok(createdSources.length >= 2, 'ui-click має створити осцилятор і шумове джерело');
  assert.strictEqual(AudioSynth.getActiveCount(), 1, 'після play() інстанс має бути активним');
  createdSources.forEach(s => {
    assert.strictEqual(typeof s.onended, 'function', 'джерело без обробника onended');
  });
  createdSources.forEach(s => s.onended());
  assert.strictEqual(AudioSynth.getActiveCount(), 0, 'інстанс лишився в _activeInstances після завершення звуку');
});

check('I-1: інстанс живий, поки не завершилось останнє джерело', () => {
  AudioSynth.play('ui-click');
  const [first, ...rest] = createdSources;
  assert.ok(rest.length >= 1);
  first.onended?.();
  assert.strictEqual(AudioSynth.getActiveCount(), 1, 'інстанс прибрано, хоча решта джерел ще звучать');
  rest.forEach(s => s.onended?.());
  assert.strictEqual(AudioSynth.getActiveCount(), 0);
});

check('I-1: після завершення masterGain відключається від виходу', () => {
  AudioSynth.play('ui-click');
  const master = createdGains[0];
  createdSources.forEach(s => s.onended?.());
  assert.strictEqual(master.disconnected, true, 'masterGain не відключено — граф вузлів тече');
});

check('I-1: багато one-shot звуків не накопичуються', () => {
  for (let i = 0; i < 25; i++) AudioSynth.play('tab-switch');
  assert.strictEqual(AudioSynth.getActiveCount(), 25);
  createdSources.forEach(s => s.onended?.());
  assert.strictEqual(AudioSynth.getActiveCount(), 0);
});

check('I-1: loop-інстанс сирени не прибирається автоматично між циклами', () => {
  const h = AudioSynth.play('cataclysm-alert', { loop: true });
  createdSources.forEach(s => s.onended?.());
  assert.strictEqual(AudioSynth.getActiveCount(), 1, 'loop-інстанс зупинився сам — сирена обірветься');
  h.stop(0);
  assert.strictEqual(AudioSynth.getActiveCount(), 0);
});

check('I-1: ручний stop() після автоприбирання не ламається і не дублює видалення', () => {
  const h = AudioSynth.play('ui-click');
  createdSources.forEach(s => s.onended?.());
  assert.doesNotThrow(() => h.stop(0));
  assert.strictEqual(AudioSynth.getActiveCount(), 0);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('All audio-instance-cleanup tests passed');
