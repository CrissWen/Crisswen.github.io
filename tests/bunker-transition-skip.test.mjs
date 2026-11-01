import assert from 'node:assert';
import { register } from 'node:module';

// I-11: skipToEnd у bunker-transition.js не повинен чекати onSealed перед видаленням оверлея.
// Якщо onSealed завис (мережа, довга ініціалізація дошки) — двері не мають блокувати екран.

// ===== Підміна звукового менеджера (тестуємо лише життєвий цикл оверлея) =====
const STUBS = {
  '../services/sound-manager.js': `
    export const SOUND_IDS = new Proxy({}, { get: (_, key) => String(key) });
    export const soundManager = { play() {}, stop() {}, fade() {} };`
};
const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.endsWith('bunker-transition.js') && STUBS[specifier]) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

// ===== Мінімальний фейковий DOM =====
class FakeElement {
  constructor() {
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.dataset = {};
    this.className = '';
    this.innerHTML = '';
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const body = new FakeElement();
globalThis.document = { body, createElement: () => new FakeElement() };

const listeners = {};
globalThis.window = {
  location: { hash: '' },
  matchMedia: () => ({ matches: false }),
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); }
};

const { playBunkerDoorTransition, isBunkerDoorTransitionActive } = await import('../js/fx/bunker-transition.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ----- Тест 1: Esc до герметизації, onSealed завис -> оверлей одразу зникає -----
{
  let sealedStarted = false;
  let completed = false;
  const run = playBunkerDoorTransition({
    onSealed: () => {
      sealedStarted = true;
      return new Promise(() => {}); // ніколи не завершується
    },
    onComplete: () => { completed = true; }
  });

  assert.strictEqual(body.children.length, 1, 'оверлей має бути в DOM після старту');
  assert.ok(isBunkerDoorTransitionActive(), 'перехід активний');

  // Esc синхронно: головний сценарій ще не дійшов до фази герметизації
  const [onKeyDown] = listeners.keydown;
  onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });

  await tick();
  await tick();

  assert.ok(sealedStarted, 'onSealed має бути викликаний (стан гри мусить змонтуватись)');
  assert.strictEqual(body.children.length, 0, 'I-11: оверлей має зникнути, не чекаючи завислого onSealed');
  assert.strictEqual(isBunkerDoorTransitionActive(), false, 'активний перехід скинуто');
  assert.strictEqual((listeners.keydown || []).length, 0, 'слухач keydown знято');
  assert.strictEqual(completed, false, 'onComplete не викликається, поки onSealed не завершився');
  void run;
}

// ----- Тест 2: Esc, onSealed завершується нормально -> onComplete викликається після нього -----
{
  const order = [];
  let finishSealed;
  const sealedGate = new Promise((resolve) => { finishSealed = resolve; });
  playBunkerDoorTransition({
    onSealed: async () => { await sealedGate; order.push('sealed'); },
    onComplete: () => { order.push('complete'); }
  });

  const [onKeyDown] = listeners.keydown;
  onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await tick();

  assert.strictEqual(body.children.length, 0, 'оверлей прибраний ще до завершення onSealed');
  finishSealed();
  await tick();
  await tick();
  assert.deepStrictEqual(order, ['sealed', 'complete'], 'порядок колбеків збережено: onSealed -> onComplete');
}

// ----- Тест 3: onSealed кидає виняток -> оверлей прибраний, onComplete все одно викликаний -----
{
  let completed = false;
  const origError = console.error;
  console.error = () => {};
  playBunkerDoorTransition({
    onSealed: () => { throw new Error('boom'); },
    onComplete: () => { completed = true; }
  });
  const [onKeyDown] = listeners.keydown;
  onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await tick();
  await tick();
  console.error = origError;
  assert.strictEqual(body.children.length, 0, 'оверлей прибраний після помилки в onSealed');
  assert.ok(completed, 'onComplete викликаний навіть після помилки в onSealed');
}

console.log('bunker-transition-skip: ok');
