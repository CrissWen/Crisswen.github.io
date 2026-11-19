import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Підміна важких/DOM-залежних модулів (Sortable, showPackConfirm) через module-хуки
const STUBS = {
  'sortable.esm.js': `
    export default class Sortable {
      static mount() {}
      destroy() {}
    }
  `,
  'pack-confirm.js': `
    export function showPackConfirm(...args) {
      if (typeof globalThis.__packConfirmStub === 'function') {
        return globalThis.__packConfirmStub(...args);
      }
      return Promise.resolve(false);
    }
  `
};

const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    for (const [suffix, source] of Object.entries(STUBS)) {
      if (specifier.endsWith(suffix)) {
        return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true };
      }
    }
    return next(specifier, context);
  }
`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

function createMockElement(id = '') {
  const listeners = new Map();
  return {
    id,
    value: '',
    hidden: false,
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn, opts) {
      const signal = opts?.signal;
      if (signal?.aborted) return;
      if (!listeners.has(type)) listeners.set(type, []);
      const entry = { fn, opts };
      listeners.get(type).push(entry);
      if (signal) {
        signal.addEventListener('abort', () => {
          const arr = listeners.get(type);
          if (!arr) return;
          const idx = arr.indexOf(entry);
          if (idx !== -1) arr.splice(idx, 1);
        }, { once: true });
      }
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.findIndex(e => e.fn === fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    async dispatch(type, evt = {}) {
      const arr = [...(listeners.get(type) || [])];
      const results = [];
      for (const { fn } of arr) {
        results.push(fn(evt));
      }
      await Promise.all(results);
    }
  };
}

function setupMockDom(elementsById = {}) {
  const docTarget = createMockElement('document');
  const body = createMockElement('body');
  globalThis.document = {
    body,
    getElementById: (id) => elementsById[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => createMockElement(),
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget)
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    scrollY: 0,
    scrollTo() {},
    supabase: { createClient: () => ({}) }
  };
  return { docTarget };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

setupMockDom();

const { state } = await import('../../js/pack-editor/state.js');
const { bindLlmPanel } = await import('../../js/pack-editor/bindings/llm-panel.js');
const { bindChips } = await import('../../js/pack-editor/bindings/chips.js');
const { createDeleteMode } = await import('../../js/pack-editor/bindings/delete-mode.js');

function resetState() {
  state.activeCategory = 'profession';
  state.viewMode = 'llm';
  state.isDeleteMode = false;
  state.isConfirming = false;
  state.selectedDeleteIndices = new Set();
  state.lastClickedDeleteIndex = null;
  state.newCataIndex = -1;
  state.newDynIndex = -1;
  state.cataEditIndex = -1;
  state.dynEditIndex = -1;
  state.searchQuery = '';
  state.searchAll = false;
  state.cardData = {};
  state.initialCardMap = new Map();
  state.deletedCardIds = new Set();
  state.form = { title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: [] };
}

test('bindLlmPanel: cancels pending debounce timer when AbortSignal aborts', async () => {
  resetState();
  const peCards = createMockElement('pe-cards');
  setupMockDom({ 'pe-cards': peCards });

  const controller = new AbortController();
  let metaCalls = 0;
  let summaryCalls = 0;
  let buttonCalls = 0;

  const ctx = {
    signal: controller.signal,
    deleteMode: { exit() {} },
    renderList() {},
    updateCardsMeta() { metaCalls++; },
    renderSummary() { summaryCalls++; },
    updateButtons() { buttonCalls++; }
  };

  bindLlmPanel(ctx);

  await peCards.dispatch('input', { target: { value: 'Лікар' } });
  assert.equal(metaCalls, 1, 'updateCardsMeta is called synchronously on input');

  // Скидаємо лічильник, щоб перевірити саме відкладений виклик після debounce (200ms)
  metaCalls = 0;
  controller.abort();

  await new Promise(r => setTimeout(r, 230));

  assert.equal(metaCalls, 0, 'debounced updateCardsMeta must NOT run after AbortSignal aborts');
  assert.equal(summaryCalls, 0, 'debounced renderSummary must NOT run after AbortSignal aborts');
  assert.equal(buttonCalls, 0, 'debounced updateButtons must NOT run after AbortSignal aborts');
});

test('bindChips: aborting ctx.signal before showPackConfirm resolves prevents selectCategory and deleteMode.exit', async () => {
  resetState();
  state.isDeleteMode = true;
  state.selectedDeleteIndices = new Set([0]);

  const peChips = createMockElement('pe-chips');
  setupMockDom({ 'pe-chips': peChips });

  const chipEl = {
    dataset: { chip: 'health' },
    closest(selector) {
      if (selector === '[data-chip]') return chipEl;
      return null;
    }
  };

  const confirmDeferred = deferred();
  let confirmCalls = 0;
  globalThis.__packConfirmStub = () => {
    confirmCalls++;
    return confirmDeferred.promise;
  };

  const controller = new AbortController();
  let selectCalls = 0;
  let exitCalls = 0;

  const ctx = {
    signal: controller.signal,
    deleteMode: { exit() { exitCalls++; } },
    selectCategory() { selectCalls++; },
    muteShortageForCurrentPack() {}
  };

  bindChips(ctx);

  const clickPromise = peChips.dispatch('click', {
    target: chipEl,
    stopPropagation() {},
    preventDefault() {}
  });

  assert.equal(confirmCalls, 1, 'showPackConfirm should be awaited');
  assert.equal(state.isConfirming, true, 'isConfirming should be true while awaiting');

  controller.abort();
  confirmDeferred.resolve(true);
  await clickPromise;

  assert.equal(state.isConfirming, false, 'isConfirming must reset in finally');
  assert.equal(exitCalls, 0, 'deleteMode.exit must NOT run after AbortSignal aborts');
  assert.equal(selectCalls, 0, 'ctx.selectCategory must NOT run after AbortSignal aborts');
});

test('createDeleteMode: aborting ctx.signal before showPackConfirm resolves prevents mutating state.form and state.cardData', async () => {
  resetState();
  setupMockDom({});

  // Імітуємо editor.js:218 — createDeleteMode(ctx) створюється при завантаженні модуля, до initPackEditor()
  let metaCalls = 0;
  let summaryCalls = 0;
  let buttonCalls = 0;
  let renderListCalls = 0;

  const ctx = {
    signal: null,
    renderList() { renderListCalls++; },
    updateCardsMeta() { metaCalls++; },
    renderSummary() { summaryCalls++; },
    updateButtons() { buttonCalls++; }
  };
  const deleteMode = createDeleteMode(ctx);

  // Сесія 1: призначаємо AbortSignal
  const controller1 = new AbortController();
  ctx.signal = controller1.signal;

  state.activeCategory = 'profession';
  state.isDeleteMode = true;
  state.selectedDeleteIndices = new Set([0]);
  state.cardData.profession = [{ id: 'p1', value: 'Лікар', meta: {} }];
  state.form.texts.profession = 'Лікар';
  state.form.cataclysms = [{ id: 'c1', name: 'Потоп', description: '', timer_minutes: 5, stay_time_months: 12, population: 20 }];

  const confirmDeferred = deferred();
  globalThis.__packConfirmStub = () => confirmDeferred.promise;

  const bulkPromise = deleteMode.executeBulk({});
  assert.equal(state.isConfirming, true);

  // Перехід на іншу сторінку та повторне відкриття редактора (сесія 2 з новим signal)
  controller1.abort();
  ctx.signal = new AbortController().signal;

  confirmDeferred.resolve(true);
  await bulkPromise;

  assert.equal(state.isConfirming, false, 'isConfirming must reset in finally');
  assert.equal(state.cardData.profession.length, 1, 'state.cardData must NOT be mutated after session 1 abort');
  assert.equal(state.form.texts.profession, 'Лікар', 'state.form.texts must NOT be mutated after session 1 abort');
  assert.equal(state.form.cataclysms.length, 1, 'state.form.cataclysms must NOT be mutated');
  assert.equal(metaCalls, 0, 'updateCardsMeta must NOT run after abort');
  assert.equal(summaryCalls, 0, 'renderSummary must NOT run after abort');
  assert.equal(buttonCalls, 0, 'updateButtons must NOT run after abort');
  assert.equal(renderListCalls, 0, 'renderList (exit) must NOT run after abort');
});
