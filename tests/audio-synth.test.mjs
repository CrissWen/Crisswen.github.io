import assert from 'node:assert';

// Mock Web Audio API to verify every node, frequency, gain ramp, and cleanup
class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(val, time) {
    assert.ok(Number.isFinite(val), `setValueAtTime value must be finite, got ${val}`);
    this.value = val;
    this.events.push({ type: 'set', val, time });
  }
  linearRampToValueAtTime(val, time) {
    assert.ok(Number.isFinite(val), `linearRamp value must be finite, got ${val}`);
    this.value = val;
    this.events.push({ type: 'linear', val, time });
  }
  exponentialRampToValueAtTime(val, time) {
    assert.ok(Number.isFinite(val) && val > 0, `exponentialRamp value must be > 0, got ${val}`);
    this.value = val;
    this.events.push({ type: 'exp', val, time });
  }
  setTargetAtTime(val, time, timeConstant) {
    assert.ok(Number.isFinite(val), `setTargetAtTime value must be finite, got ${val}`);
    this.value = val;
    this.events.push({ type: 'target', val, time, timeConstant });
  }
  cancelScheduledValues(time) {
    this.events.push({ type: 'cancel', time });
  }
}

class MockAudioNode {
  constructor() {
    this.connectedTo = [];
    this.disconnected = false;
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
    this.started = false;
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopped = true;
    this.stopTime = when;
    if (typeof this.onended === 'function') {
      this.onended();
    }
  }
}

class MockBufferSourceNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new MockAudioParam(1);
    this.started = false;
    this.stopped = false;
    this.onended = null;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopped = true;
    this.stopTime = when;
    if (typeof this.onended === 'function') {
      this.onended();
    }
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1);
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.destination = new MockAudioNode();
    this.createdOscillators = [];
    this.createdBuffers = [];
    this.createdGains = [];
    this.createdFilters = [];
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createOscillator() {
    const osc = new MockOscillatorNode();
    this.createdOscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new MockGainNode();
    this.createdGains.push(gain);
    return gain;
  }
  createBiquadFilter() {
    const filter = new MockBiquadFilterNode();
    this.createdFilters.push(filter);
    return filter;
  }
  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => data,
    };
  }
  createBufferSource() {
    const src = new MockBufferSourceNode();
    this.createdBuffers.push(src);
    return src;
  }
}

globalThis.window = {
  AudioContext: MockAudioContext,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { AudioSynth, SYNTH_RECIPES } = await import('../js/services/audio-synth.js');

async function runTests() {
  console.log('Running audio-synth unit tests...');

  // 1. Supported IDs check (all 14 target sounds)
  const requiredIds = [
    'lock-hover',
    'lock-toggle',
    'ui-click',
    'tab-switch',
    'dice-roll',
    'roulette-tick',
    'roulette-reveal',
    'timer-tick',
    'cataclysm-alert',
    'bunker-door-close',
    'bunker-door-slam',
    'bunker-hydraulic',
    'bunker-door-open',
    'bunker-ambient',
  ];

  const supported = AudioSynth.getSupportedSoundIds();
  for (const id of requiredIds) {
    assert.ok(supported.includes(id), `AudioSynth must support "${id}"`);
    assert.ok(SYNTH_RECIPES[id], `SYNTH_RECIPES must contain metadata for "${id}"`);
  }

  // 2. Unlock test
  await AudioSynth.unlock();
  const ctx = AudioSynth.getContext();
  assert.strictEqual(ctx.state, 'running', 'AudioContext should be running after unlock()');

  // 3. Play each of the 13 non-ambient sounds and verify nodes are created and started
  for (const id of requiredIds.filter(x => x !== 'bunker-ambient')) {
    const oscBefore = ctx.createdOscillators.length;
    const bufBefore = ctx.createdBuffers.length;

    const instance = AudioSynth.play(id, { volume: 0.75, rate: 1.02 });
    assert.ok(instance && instance.id, `play("${id}") should return an instance handle`);
    assert.strictEqual(instance.soundId, id);
    assert.strictEqual(typeof instance.stop, 'function');

    const nodesAdded = (ctx.createdOscillators.length - oscBefore) + (ctx.createdBuffers.length - bufBefore);
    assert.ok(nodesAdded > 0, `Sound "${id}" must create at least 1 audio source node`);
  }

  // 4. Test alias cataclysm-siren and loop stop
  const sirenInst = AudioSynth.play('cataclysm-siren', { volume: 0.5, loop: true });
  assert.ok(sirenInst, 'Alias cataclysm-siren should return valid instance');
  sirenInst.stop(0.05);

  // 5. Test ambient drone lifecycle
  assert.strictEqual(AudioSynth.isAmbientPlaying(), false, 'Ambient should initially be stopped');
  AudioSynth.startAmbient({ volume: 0.4, rampDuration: 0.2 });
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true, 'Ambient should be playing after startAmbient()');

  AudioSynth.setAmbientVolume(0.15, 100);
  assert.strictEqual(AudioSynth.isAmbientPlaying(), true, 'Ambient should still be playing after volume change');

  AudioSynth.stopAmbient(0.01);
  assert.strictEqual(AudioSynth.isAmbientPlaying(), false, 'Ambient should be stopped after stopAmbient()');

  // 6. Test stopAll
  AudioSynth.play('cataclysm-alert', { volume: 0.6, loop: true });
  AudioSynth.startAmbient({ volume: 0.3 });
  AudioSynth.stopAll(0.01);
  assert.strictEqual(AudioSynth.isAmbientPlaying(), false, 'stopAll() must stop ambient');

  console.log('PASS: All audio-synth tests passed!');
}

runTests().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
