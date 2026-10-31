import assert from 'node:assert';

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
    this.state = 'running';
    this.destination = {};
  }
  resume() { return Promise.resolve(); }
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
  createBuffer(ch, len, sr) { return { getChannelData: () => new Float32Array(len) }; }
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
  Howl: null,
  supabase: {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
    }),
  },
};

const domElements = new Map();
globalThis.document = {
  hidden: false,
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: (id) => domElements.get(id) || null,
  querySelectorAll: () => [],
};

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

globalThis.sessionStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { soundManager, SOUND_IDS } = await import('../js/services/sound-manager.js');
const { cleanupProfile, stopAmbientPreview } = await import('../js/pages/profile.js');

console.log('Running ambient button and preview tests...');

// 1. Initial state: ambient is not playing
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false, 'Ambient should initially not be playing');

// 2. Mock ambient button element
const mockBtn = {
  classList: {
    classes: new Set(),
    toggle(cls, val) {
      if (val) this.classes.add(cls);
      else this.classes.delete(cls);
    },
    contains(cls) { return this.classes.has(cls); }
  },
  title: '',
  setAttribute(attr, val) { this[attr] = val; }
};
domElements.set('profile-audio-ambient-btn', mockBtn);

// 3. Play ambient -> isPlaying should immediately be true
soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true, 'Ambient should be reported as playing right after play()');

// 4. Stop ambient -> isPlaying should be false
soundManager.stop(SOUND_IDS.BUNKER_AMBIENT);
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false, 'Ambient should be false after stop()');

// 5. stopAmbientPreview should reset button state and stop sound
mockBtn.classList.toggle('is-playing', true);
soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), true);

stopAmbientPreview();
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false, 'Ambient should be stopped after stopAmbientPreview()');
assert.strictEqual(mockBtn.classList.contains('is-playing'), false, 'Button should lose is-playing class');

// 6. cleanupProfile test
mockBtn.classList.toggle('is-playing', true);
soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
cleanupProfile();
assert.strictEqual(soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT), false, 'Ambient should be stopped on profile cleanup');
assert.strictEqual(mockBtn.classList.contains('is-playing'), false, 'Button should not have is-playing after cleanup');

console.log('PASS: All ambient preview tests passed!');
