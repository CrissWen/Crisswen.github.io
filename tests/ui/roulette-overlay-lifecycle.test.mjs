import assert from 'node:assert';
import { register } from 'node:module';

// ===== Підміна важких залежностей оверлея (стрічка, звук) через module-хуки: тестуємо саме життєвий цикл оверлея =====
const STUBS = {
  './roulette-reel.js': `
    export function createRouletteReel(host, opts) {
      globalThis.__reelCreated = (globalThis.__reelCreated || 0) + 1;
      if (globalThis.__reelThrows) throw new Error('reel boom');
      return { start() {}, destroy() { globalThis.__reelDestroyed = (globalThis.__reelDestroyed || 0) + 1; } };
    }
    export async function resolveReelMode() { return 'full'; }`,
  '../utils/sfx.js': `
    export function configureSfx() {}
    export function playHeartbeat() {}
    export function unlockAudio() {}`,
  '../services/sound-manager.js': `
    export const SOUND_IDS = { ROULETTE_TICK: 'tick', ROULETTE_REVEAL: 'reveal' };
    export const soundManager = { play() {} };`
};
const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.endsWith('roulette-overlay.js') && STUBS[specifier]) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

// ===== Мінімальний фейковий DOM =====
class FakeNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this._classes = new Set();
    this.attributes = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.inert = false;
    this.tabIndex = 0;
    this.textContent = '';
    const self = this;
    this.classList = {
      add: (...names) => names.forEach(n => self._classes.add(n)),
      remove: (...names) => names.forEach(n => self._classes.delete(n)),
      contains: n => self._classes.has(n)
    };
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get isConnected() {
    let node = this;
    while (node.parent) node = node.parent;
    return node === document.body;
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(n) { n.parent = this; this.children.push(n); return n; }
  append(...nodes) { nodes.forEach(n => (typeof n === 'string' ? null : this.appendChild(n))); }
  replaceChildren() { this.children = []; }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
}

globalThis.document = {
  body: new FakeNode('body'),
  createElement: tag => new FakeNode(tag),
  createDocumentFragment: () => new FakeNode('fragment'),
  createTextNode: () => new FakeNode('#text'),
  addEventListener() {},
  removeEventListener() {}
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: !!globalThis.__reduced })
};
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);

const uncaught = [];
process.on('uncaughtException', err => uncaught.push(err));

const { playRouletteOverlay, hideRouletteOverlay, isRouletteOverlayShown } = await import('../../js/ui/roulette-overlay.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FADE_WAIT = 1100; // FADE_OUT_DURATION_MS (800) + запас

let page;
function resetWorld({ reduced = true } = {}) {
  hideRouletteOverlay();
  document.body.children = [];
  page = new FakeNode('main');
  document.body.appendChild(page);
  globalThis.__reduced = reduced;
  globalThis.__reelThrows = false;
  uncaught.length = 0;
}

function start(onFinish, { startIn = 20, unlockIn = 90 } = {}) {
  const t = Date.now();
  return playRouletteOverlay({
    title: 'Результат',
    timeline: { startAt: t + startIn, unlockAt: t + unlockIn },
    reel: { pool: [], result: { key: 'a' }, seed: 1, stopIndex: 10, durationMs: 50 },
    onFinish
  });
}

let failed = 0;
async function check(name, fn) {
  try {
    resetWorld();
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  } finally {
    hideRouletteOverlay();
  }
}

console.log('Running roulette-overlay-lifecycle tests...');

await check('R-C1: примусове приховування викликає onFinish один раз із cancelled: true', async () => {
  const calls = [];
  assert.strictEqual(await start(arg => calls.push(arg)), true);
  assert.strictEqual(isRouletteOverlayShown(), true);
  hideRouletteOverlay();
  assert.strictEqual(calls.length, 1, 'onFinish має спрацювати, інакше await у survival-roulette зависає');
  assert.strictEqual(calls[0]?.cancelled, true);
  await sleep(150); // таймлайн уже минув: повторного виклику бути не повинно
  assert.strictEqual(calls.length, 1);
});

await check('R-C1: примусове приховування прибирає оверлей і розблоковує сторінку', async () => {
  await start(() => {});
  assert.strictEqual(page.inert, true);
  hideRouletteOverlay();
  assert.strictEqual(page.inert, false);
  assert.strictEqual(isRouletteOverlayShown(), false);
  assert.strictEqual(document.body.children.length, 1);
});

await check('R-C1: запуск нового оверлея скасовує попередній (onFinish попереднього з cancelled)', async () => {
  const first = [];
  await start(arg => first.push(arg));
  await start(() => {});
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0]?.cancelled, true);
});

await check('штатне завершення: onFinish рівно один раз і без cancelled', async () => {
  const calls = [];
  await start(arg => calls.push(arg));
  await sleep(250);
  assert.strictEqual(calls.length, 1);
  assert.ok(!calls[0]?.cancelled, 'штатний фініш не є скасуванням');
  hideRouletteOverlay(); // уже завершено: повторного onFinish бути не повинно
  assert.strictEqual(calls.length, 1);
});

await check('R-C2 (reduced motion): виняток в onFinish не лишає оверлей і не ламає сторінку', async () => {
  await start(() => { throw new Error('refreshBoard failed'); });
  await sleep(250);
  assert.strictEqual(uncaught.length, 0, `необроблений виняток: ${uncaught[0]?.message}`);
  assert.strictEqual(page.inert, false);
  assert.strictEqual(document.body.children.length, 1, 'оверлей має бути видалений з DOM');
});

await check('R-C2 (fade-out): виняток в onFinish не блокує видалення оверлея з DOM', async () => {
  resetWorld({ reduced: false });
  await start(() => { throw new Error('refreshBoard failed'); });
  await sleep(250 + FADE_WAIT);
  assert.strictEqual(uncaught.length, 0, `необроблений виняток: ${uncaught[0]?.message}`);
  assert.strictEqual(page.inert, false);
  assert.strictEqual(document.body.children.length, 1, 'оверлей зависає в DOM, бо fadeTimer не створено');
});

await check('I-9: збій створення стрічки розблоковує сторінку одразу, а не через 30 с', async () => {
  globalThis.__reelThrows = true;
  const calls = [];
  try { await start(arg => calls.push(arg)); } catch { /* помилка стрічки допускається, головне — стан після неї */ }
  assert.strictEqual(page.inert, false, 'сторінка лишилась inert після збою createRouletteReel');
  assert.strictEqual(document.body.children.length, 1);
});

if (failed) {
  console.error(`FAIL: roulette-overlay-lifecycle (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all roulette-overlay-lifecycle tests passed!');
process.exit(0);
