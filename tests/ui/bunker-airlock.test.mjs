import assert from 'node:assert';

let unlockedCalled = 0;
const playedSounds = [];

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this._className = '';
    this.id = '';
    this.innerHTML = '';
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.focused = false;
    this._classes = new Set();
    this.classList = {
      add: (...cls) => {
        cls.forEach(c => this._classes.add(c));
        this._className = Array.from(this._classes).join(' ');
      },
      remove: (...cls) => {
        cls.forEach(c => this._classes.delete(c));
        this._className = Array.from(this._classes).join(' ');
      },
      contains: (c) => this._classes.has(c),
      toggle: (c, v) => {
        if (v === undefined) {
          if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        } else if (v) this._classes.add(c);
        else this._classes.delete(c);
        this._className = Array.from(this._classes).join(' ');
      }
    };
  }
  get className() { return this._className; }
  set className(val) {
    this._className = String(val || '');
    this._classes = new Set(this._className.split(/\s+/).filter(Boolean));
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    }
  }
  focus() { this.focused = true; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners.has(type)) return;
    this.listeners.set(type, this.listeners.get(type).filter(f => f !== fn));
  }
  dispatchEvent(evt) {
    const list = this.listeners.get(evt.type) || [];
    for (const fn of [...list]) fn(evt);
  }
  querySelector(sel) {
    if (!this._queried) this._queried = new Map();
    if (this._queried.has(sel)) return this._queried.get(sel);
    const el = new FakeElement(sel.includes('btn') ? 'button' : 'div');
    this._queried.set(sel, el);
    return el;
  }
}

const body = new FakeElement('body');
const winListeners = new Map();

globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener(type, fn) {
    if (!winListeners.has(type)) winListeners.set(type, []);
    winListeners.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    if (!winListeners.has(type)) return;
    winListeners.set(type, winListeners.get(type).filter(f => f !== fn));
  },
  dispatchKey(key) {
    const list = winListeners.get('keydown') || [];
    for (const fn of [...list]) {
      fn({ key, preventDefault() {}, stopPropagation() {} });
    }
  }
};

globalThis.document = {
  body,
  hidden: false,
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => body.children.find(c => c.id === id) || null,
  addEventListener: () => {},
  removeEventListener: () => {},
};

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { soundManager, SOUND_IDS } = await import('../../js/services/sound-manager.js');
soundManager.unlock = async () => { unlockedCalled++; };
soundManager.play = (id) => { playedSounds.push(id); };

const {
  mountBunkerAirlock,
  unmountBunkerAirlock,
  isBunkerAirlockMounted,
  notifyAirlockGameStarted
} = await import('../../js/ui/bunker-airlock.js');

console.log('Running bunker-airlock unit tests...');

// 1. Mode 'join' (Lobby)
let cbJoin = 0;
const unmountJoin = mountBunkerAirlock({
  roomCode: 'A7X9',
  mode: 'join',
  userName: 'Timur',
  onUnlocked: () => { cbJoin++; }
});

assert.strictEqual(body.children.length, 1, 'Overlay should be mounted in body');
const joinEl = body.children[0];
assert.strictEqual(joinEl.getAttribute('data-no-click-sound'), 'true', 'Overlay must have data-no-click-sound="true" to avoid duplicate global UI_CLICK');
assert.ok(joinEl.className.includes('bunker-airlock--join'), 'Should have join modifier class');
assert.ok(joinEl.innerHTML.includes('A7X9'), 'Should display room code');
assert.ok(joinEl.innerHTML.includes('Timur'), 'Should display survivor name');
assert.ok(joinEl.innerHTML.includes('ВІДЧИНИТИ ГЕРМОШЛЮЗ'), 'Should display join CTA button');
assert.ok(joinEl.innerHTML.includes('bunker-airlock__wheel'), 'Should render vault wheel SVG');

// Trigger click on overlay
joinEl.dispatchEvent({ type: 'click', target: joinEl });
await new Promise(r => setTimeout(r, 270));
assert.strictEqual(unlockedCalled, 1, 'Should call soundManager.unlock()');
assert.ok(playedSounds.includes(SOUND_IDS.LOCK_TOGGLE), 'Join mode should play LOCK_TOGGLE sound');
assert.strictEqual(cbJoin, 1, 'onUnlocked callback should be called');
assert.strictEqual(body.children.length, 0, 'Overlay should be removed after exit animation');
unmountJoin();

// 2. Mode 'reconnect' (In-Game active player)
playedSounds.length = 0;
let cbReconnect = 0;
mountBunkerAirlock({
  roomCode: 'B2K4',
  mode: 'reconnect',
  userName: 'Timur',
  onUnlocked: () => { cbReconnect++; }
});

assert.strictEqual(body.children.length, 1);
const recEl = body.children[0];
assert.ok(recEl.className.includes('bunker-airlock--reconnect'), 'Should have reconnect modifier class');
assert.ok(recEl.innerHTML.includes('СИГНАЛ'), 'Should display signal lost header');
assert.ok(recEl.innerHTML.includes('ПОВЕРНУТИСЯ ДО ГРИ'), 'Should display reconnect CTA');

// Trigger Enter key
window.dispatchKey('Enter');
await new Promise(r => setTimeout(r, 150));
assert.ok(playedSounds.includes(SOUND_IDS.UI_CLICK), 'Reconnect mode should play UI_CLICK sound');
assert.strictEqual(cbReconnect, 1, 'onUnlocked should fire');
assert.strictEqual(body.children.length, 0, 'Reconnect overlay should disappear within 150ms (ultra-fast)');

// 3. Mode 'spectator' (Spectator mode)
playedSounds.length = 0;
let cbSpec = 0;
const unmountSpec = mountBunkerAirlock({
  roomCode: 'C9M1',
  mode: 'spectator',
  userName: 'Guest',
  onUnlocked: () => { cbSpec++; }
});

assert.strictEqual(body.children.length, 1);
const specEl = body.children[0];
assert.ok(specEl.className.includes('bunker-airlock--spectator'), 'Should have spectator modifier class');
assert.ok(specEl.innerHTML.includes('ТЕРМІНАЛ СПОСТЕРІГАЧА'), 'Should display spectator header');
assert.ok(specEl.innerHTML.includes('НАЖИВО'), 'Should display LIVE badge');
assert.ok(specEl.innerHTML.includes('ДИВИТИСЯ ГРУ'), 'Should display spectator CTA');

// Manual unmount before click should cleanly remove from DOM
unmountSpec();
assert.strictEqual(body.children.length, 0, 'Manual unmount should immediately remove element');
assert.strictEqual(isBunkerAirlockMounted(), false, 'isBunkerAirlockMounted should return false when unmounted');

// 4. Dynamic game-started update in 'join' mode
playedSounds.length = 0;
let cbStarted = 0;
mountBunkerAirlock({
  roomCode: 'D4W1',
  mode: 'join',
  userName: 'TestUser',
  onUnlocked: () => { cbStarted++; }
});

assert.strictEqual(isBunkerAirlockMounted(), true, 'isBunkerAirlockMounted should return true when mounted');
const joinGameEl = body.children[0];
assert.strictEqual(joinGameEl.classList.contains('bunker-airlock--game-started'), false);

// Host starts game: notify airlock
notifyAirlockGameStarted();
assert.strictEqual(joinGameEl.classList.contains('bunker-airlock--game-started'), true, 'Should add bunker-airlock--game-started class');
const statusTextEl = joinGameEl.querySelector('[data-airlock-status-text]');
assert.strictEqual(statusTextEl.textContent, 'УВАГА // ГРА РОЗПОЧАЛАСЯ!', 'Status text should reflect game started');
const btnTextEl = joinGameEl.querySelector('[data-airlock-btn-text]');
assert.strictEqual(btnTextEl.textContent, 'УВІЙТИ ДО ГРИ (МАТЧ ТРИВАЄ)', 'Button text should reflect game started');
const dotEl = joinGameEl.querySelector('[data-airlock-status-dot]');
assert.ok(dotEl.className.includes('bunker-airlock__dot--danger'), 'Dot should become danger dot');

// Click on updated airlock
joinGameEl.dispatchEvent({ type: 'click', target: joinGameEl });
await new Promise(r => setTimeout(r, 160));
assert.strictEqual(cbStarted, 1, 'onUnlocked should be called after click');
assert.strictEqual(body.children.length, 0, 'Overlay should be removed after accelerated exit animation');
assert.strictEqual(isBunkerAirlockMounted(), false, 'isBunkerAirlockMounted should return false after exit');

// Safe no-op when not mounted
assert.doesNotThrow(() => {
  notifyAirlockGameStarted();
}, 'notifyAirlockGameStarted should be safe no-op when unmounted');

console.log('PASS: All bunker-airlock tests passed!');

