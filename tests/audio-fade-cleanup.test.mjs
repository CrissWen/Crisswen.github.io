import assert from 'node:assert';

// I-2: stop(soundId) і stopAll() мають гасити кастомні інтервали фейду (_customFadeIntervals),
// інакше інтервал далі мутує гучність уже зупиненого звуку і викликає onComplete.

class MockParam {
  constructor(v = 1) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}
const node = () => ({ gain: new MockParam(1), frequency: new MockParam(440), Q: new MockParam(1), type: 'sine', buffer: null,
  connect(n) { return n; }, disconnect() {}, start() {}, stop() {}, addEventListener() {} });
class MockAudioContext {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = {}; }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createOscillator() { return node(); }
  createBufferSource() { return node(); }
  createBiquadFilter() { return node(); }
  createGain() { return node(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
}

globalThis.window = {
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  Howler: { mute() {}, stop() {} },
  Howl: null,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = { hidden: false, getElementById: () => null, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { soundManager } = await import('../js/services/sound-manager.js');

class FakeHowl {
  constructor() { this.volumeCalls = []; this.stopped = 0; this._vol = 1; }
  volume(v) { if (v === undefined) return this._vol; this._vol = v; this.volumeCalls.push(v); return this; }
  stop() { this.stopped++; }
  playing() { return false; }
  state() { return 'loaded'; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function fadeCount() { return soundManager._customFadeIntervals ? soundManager._customFadeIntervals.size : 0; }

let failed = 0;
async function check(name, fn) {
  try {
    soundManager.setMuted(false);
    soundManager.stopAll();
    soundManager._howls.clear();
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  } finally {
    // не лишати живих інтервалів, щоб процес завершувався
    soundManager._customFadeIntervals?.forEach(id => clearInterval(id));
    soundManager._customFadeIntervals?.clear();
  }
}

console.log('Running audio-fade-cleanup tests...');
soundManager.init();

await check('I-2: stop(soundId) гасить інтервал фейду цього звуку', async () => {
  const howl = new FakeHowl();
  soundManager._howls.set('ui-click', howl);
  soundManager._fadeAudio('ui-click', 0, 1, 400);
  assert.strictEqual(fadeCount(), 1, 'фейд має стартувати');
  soundManager.stop('ui-click');
  assert.strictEqual(fadeCount(), 0, 'інтервал фейду лишився після stop()');
});

await check('I-2: після stop() зупинений звук більше не отримує volume()', async () => {
  const howl = new FakeHowl();
  soundManager._howls.set('ui-click', howl);
  soundManager._fadeAudio('ui-click', 0, 1, 400);
  soundManager.stop('ui-click');
  const before = howl.volumeCalls.length;
  await sleep(120);
  assert.strictEqual(howl.volumeCalls.length, before, 'інтервал мутував гучність після stop()');
});

await check('I-2: після stop() onComplete фейду не викликається', async () => {
  const howl = new FakeHowl();
  soundManager._howls.set('ui-click', howl);
  let completed = 0;
  soundManager._fadeAudio('ui-click', 1, 0, 60, () => { completed++; });
  soundManager.stop('ui-click');
  await sleep(160);
  assert.strictEqual(completed, 0, 'onComplete спрацював після stop()');
});

await check('I-2: stop(a) не чіпає фейд іншого звуку b', async () => {
  soundManager._howls.set('a', new FakeHowl());
  soundManager._howls.set('b', new FakeHowl());
  soundManager._fadeAudio('a', 0, 1, 400);
  soundManager._fadeAudio('b', 0, 1, 400);
  soundManager.stop('a');
  assert.strictEqual(soundManager._customFadeIntervals.has('a'), false);
  assert.strictEqual(soundManager._customFadeIntervals.has('b'), true, 'stop(a) помилково зупинив фейд b');
});

await check('I-2: stopAll() гасить усі інтервали фейду', async () => {
  const a = new FakeHowl(), b = new FakeHowl();
  soundManager._howls.set('a', a);
  soundManager._howls.set('b', b);
  soundManager._fadeAudio('a', 0, 1, 400);
  soundManager._fadeAudio('b', 1, 0, 400);
  assert.strictEqual(fadeCount(), 2);
  soundManager.stopAll();
  assert.strictEqual(fadeCount(), 0, 'після stopAll() лишились інтервали');
  const ca = a.volumeCalls.length, cb = b.volumeCalls.length;
  await sleep(120);
  assert.strictEqual(a.volumeCalls.length, ca, 'звук a мутується після stopAll()');
  assert.strictEqual(b.volumeCalls.length, cb, 'звук b мутується після stopAll()');
});

await check('I-2: stop()/stopAll() без активних фейдів не кидають помилок', async () => {
  assert.doesNotThrow(() => soundManager.stop('ui-click'));
  assert.doesNotThrow(() => soundManager.stopAll());
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('All audio-fade-cleanup tests passed');
