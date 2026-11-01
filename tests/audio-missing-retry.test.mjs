import assert from 'node:assert';

// I-3: _missingFiles не має блокувати звук назавжди після першого збою мережі.
// Запис про «відсутній файл» протухає через вікно повтору, скидається подією 'online',
// а після ліміту спроб файл вважається справді відсутнім (фоллбек на синтезатор лишається).

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

const handlers = {};
const created = [];
class FakeHowl {
  constructor(opts) { this.opts = opts; this._state = 'unloaded'; created.push(this); }
  state() { return this._state; }
  play() { return 1; }
  stop() {}
  unload() {}
  volume(v) { return v === undefined ? 1 : this; }
  rate() { return this; }
  loop() { return this; }
  playing() { return false; }
  once() {}
  on() {}
}

globalThis.window = {
  matchMedia: () => ({ matches: true }),
  AudioContext: MockAudioContext,
  Howler: { mute() {}, stop() {} },
  Howl: FakeHowl,
  addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
  removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(f => f !== fn); },
};
globalThis.document = { hidden: false, getElementById: () => null, addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { soundManager, SOUND_IDS } = await import('../js/services/sound-manager.js');
const ID = SOUND_IDS.UI_CLICK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fireOnline = () => (handlers.online || []).forEach(fn => fn({ type: 'online' }));
const play = () => soundManager.play(ID, { bypassThrottle: true });
const failLoad = () => created[created.length - 1].opts.onloaderror(1, 'Network error');

function reset() {
  soundManager.setMuted(false);
  soundManager.stopAll();
  soundManager._howls.clear();
  soundManager._missingFiles.clear();
  soundManager._missingAttempts?.clear?.();
  soundManager._missingSince?.clear?.();
  soundManager._missingRetryMs = 30000;
  created.length = 0;
}

let failed = 0;
async function check(name, fn) {
  try {
    reset();
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

console.log('Running audio-missing-retry tests...');

await check('I-3: збій завантаження переводить звук на синтез-фоллбек (без нового Howl)', async () => {
  play();
  assert.strictEqual(created.length, 1);
  failLoad();
  assert.ok(soundManager._missingFiles.has(ID), 'файл має бути позначений як відсутній');
  play();
  assert.strictEqual(created.length, 1, 'поки файл у «відсутніх», новий Howl не створюється');
});

await check('I-3: подія online скидає «відсутні» і звук знову йде через Howler', async () => {
  play();
  failLoad();
  fireOnline();
  assert.ok(!soundManager._missingFiles.has(ID), 'після online запис має зникнути');
  play();
  assert.strictEqual(created.length, 2, 'після online має бути створено свіжий Howl');
});

await check('I-3: запис протухає через вікно повтору без події online', async () => {
  soundManager._missingRetryMs = 20;
  play();
  failLoad();
  await sleep(40);
  play();
  assert.strictEqual(created.length, 2, 'після вікна повтору має бути нова спроба завантаження');
});

await check('I-3: до закінчення вікна повтору повторних спроб немає', async () => {
  soundManager._missingRetryMs = 5000;
  play();
  failLoad();
  await sleep(20);
  play();
  assert.strictEqual(created.length, 1);
});

await check('I-3: після ліміту спроб файл лишається «відсутнім» назавжди', async () => {
  soundManager._missingRetryMs = 10;
  for (let attempt = 0; attempt < 3; attempt++) {
    play();
    failLoad();
    await sleep(20);
    fireOnline();
  }
  const countAfterLimit = created.length;
  play();
  assert.strictEqual(created.length, countAfterLimit, 'після ліміту нових спроб бути не повинно');
  assert.ok(soundManager._missingFiles.has(ID), 'файл має лишитися позначеним як відсутній');
});

await check('I-3: успішна спроба після online не залишає запису у «відсутніх»', async () => {
  play();
  failLoad();
  fireOnline();
  play();
  created[created.length - 1]._state = 'loaded';
  created[created.length - 1].opts.onload();
  assert.ok(!soundManager._missingFiles.has(ID));
  assert.strictEqual(soundManager._missingAttempts?.get?.(ID) ?? 0, 0, 'лічильник спроб скидається після успіху');
});

if (failed) {
  console.log(`\n${failed} audio-missing-retry test(s) FAILED`);
  process.exit(1);
}
console.log('All audio-missing-retry tests passed');
