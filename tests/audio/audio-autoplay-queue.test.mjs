import assert from 'node:assert';

let resumeCallCount = 0;
let currentCtxState = 'suspended';

class MockAudioParam {
  constructor(val = 1) { this.value = val; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
}

class MockGainNode {
  constructor() { this.gain = new MockAudioParam(1); }
  connect() {}
  disconnect() {}
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  get state() { return currentCtxState; }
  resume() {
    resumeCallCount++;
    currentCtxState = 'running';
    return Promise.resolve();
  }
  createOscillator() {
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
  createGain() { return new MockGainNode(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
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

const howlInstances = [];
let nextId = 1;

class MockHowl {
  constructor(opts) {
    this.opts = opts;
    this._state = 'loaded';
    this._unlockCallbacks = [];
    this.playCalls = 0;
    this._isPlaying = false;
    howlInstances.push(this);
  }
  state() { return this._state; }
  volume() { return 0.5; }
  rate() {}
  loop() {}
  playing() { return this._isPlaying; }
  stop() { this._isPlaying = false; }
  once(event, cb) {
    if (event === 'unlock') {
      this._unlockCallbacks.push(cb);
    } else if (event === 'play') {
      cb();
    }
  }
  play() {
    const id = nextId++;
    this.playCalls++;
    if (currentCtxState === 'suspended') {
      if (this.opts.onplayerror) {
        this.opts.onplayerror(id, new Error('Playback was unable to start'));
      }
      return id;
    }
    this._isPlaying = true;
    return id;
  }
}

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
  AudioContext: MockAudioContext,
  Howler: {
    ctx: new MockAudioContext(),
    mute: () => {},
    stop: () => {}
  },
  Howl: MockHowl,
};

globalThis.document = {
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { soundManager, SOUND_IDS } = await import('../../js/services/sound-manager.js');
const { AudioSynth } = await import('../../js/services/audio-synth.js');

console.log('Running audio-autoplay-queue tests...');

// 1. Check initial unlocked state is false when suspended
assert.strictEqual(typeof soundManager.isUnlocked, 'function', 'soundManager.isUnlocked must be a function');
assert.strictEqual(soundManager.isUnlocked(), false, 'Should initially be locked when AudioContext is suspended');

// 2. Check AudioSynth.play does NOT spam ctx.resume() when locked
resumeCallCount = 0;
AudioSynth.play('ui-click', { volume: 0.5 });
AudioSynth.play('dice-roll', { volume: 0.5 });
assert.strictEqual(resumeCallCount, 0, 'AudioSynth.play should NOT call ctx.resume() while locked without gesture');

// 3. Play multiple transient SFX while locked — they must NOT queue on unlock nor call Howler.ctx.resume()
soundManager.play(SOUND_IDS.UI_CLICK, { bypassThrottle: true });
soundManager.play(SOUND_IDS.DICE_ROLL, { bypassThrottle: true });
soundManager.play(SOUND_IDS.TIMER_TICK, { bypassThrottle: true });
assert.strictEqual(resumeCallCount, 0, 'soundManager.play should NOT call Howler.ctx.resume() while locked');

for (const h of howlInstances) {
  assert.strictEqual(
    h._unlockCallbacks.length,
    0,
    `Howl for ${h.opts.src?.[0]} should NOT attach unlock queue callbacks for transient SFX`
  );
}

// 4. Start ambient while locked, then unlock via soundManager.unlock()
soundManager.startAmbient();
assert.strictEqual(typeof soundManager.unlock, 'function', 'soundManager.unlock must be a function');
await soundManager.unlock();

assert.strictEqual(soundManager.isUnlocked(), true, 'soundManager.isUnlocked() must be true after unlock()');
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true, 'Ambient should resume cleanly after unlock()');

console.log('PASS: All audio-autoplay-queue tests passed!');
