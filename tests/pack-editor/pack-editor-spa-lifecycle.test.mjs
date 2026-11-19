import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Підміна важких/DOM-залежних модулів (Sortable, showPackConfirm, packs-store, global-toast, autosave-bridge) через module-хуки
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
  `,
  'packs-store.js': `
    export const DEFAULT_PACK_ID = '16ea0906-5874-4471-aa38-aef1513e82c6';
    export const DEFAULT_PACK_LABEL = 'Базовий пак';
    export const MAX_PERSONAL_PACKS = 3;
    export const PACK_LIMIT_MESSAGE = 'Ви вже маєте 3 особисті паки — це максимум.';
    export function getPack(...args) {
      return globalThis.__packsStoreStub?.getPack ? globalThis.__packsStoreStub.getPack(...args) : Promise.resolve(null);
    }
    export function getDefaultPackConfig(...args) {
      return globalThis.__packsStoreStub?.getDefaultPackConfig ? globalThis.__packsStoreStub.getDefaultPackConfig(...args) : Promise.resolve({});
    }
    export function checkIsAdmin(...args) {
      return globalThis.__packsStoreStub?.checkIsAdmin ? globalThis.__packsStoreStub.checkIsAdmin(...args) : Promise.resolve(false);
    }
    export function countPersonalPacks(...args) {
      return globalThis.__packsStoreStub?.countPersonalPacks ? globalThis.__packsStoreStub.countPersonalPacks(...args) : Promise.resolve(0);
    }
    export function savePack(...args) {
      return globalThis.__packsStoreStub?.savePack ? globalThis.__packsStoreStub.savePack(...args) : Promise.resolve({ id: 'saved' });
    }
  `,
  'global-toast.js': `
    export function showGlobalToast(...args) {
      if (typeof globalThis.__globalToastStub === 'function') {
        return globalThis.__globalToastStub(...args);
      }
    }
    export function hideGlobalToast() {}
  `,
  'autosave-bridge.js': `
    export async function initAutosave(...args) {
      return globalThis.__autosaveStub?.initAutosave?.(...args);
    }
    export function destroyAutosave(...args) {
      return globalThis.__autosaveStub?.destroyAutosave?.(...args);
    }
    export function onEditorChanged(...args) {
      return globalThis.__autosaveStub?.onEditorChanged?.(...args);
    }
    export function getDraftContext(...args) {
      return globalThis.__autosaveStub?.getDraftContext ? globalThis.__autosaveStub.getDraftContext(...args) : null;
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
  const classes = new Set();
  const el = {
    id,
    tagName: 'DIV',
    value: '',
    checked: false,
    hidden: false,
    disabled: false,
    isConnected: true,
    innerHTML: '',
    textContent: '',
    scrollTop: 0,
    parentElement: null,
    dataset: {},
    style: {},
    children: [],
    classList: {
      add(...names) { names.forEach(n => classes.add(n)); },
      remove(...names) { names.forEach(n => classes.delete(n)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name); else classes.delete(name);
        return Boolean(force);
      },
      contains(name) { return classes.has(name); }
    },
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    select() {},
    scrollIntoView() {},
    matches() { return false; },
    remove() {},
    appendChild(child) { el.children.push(child); },
    contains(node) { return node === el; },
    getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getListeners(type) { return listeners.get(type) || []; },
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
  return el;
}

function setupMockDom(elementsById = {}, queryMap = {}, { hash = '' } = {}) {
  const docTarget = createMockElement('document');
  const winTarget = createMockElement('window');
  const body = createMockElement('body');
  globalThis.document = {
    body,
    activeElement: null,
    getElementById: (id) => elementsById[id] || null,
    querySelector: (sel) => queryMap[sel] || null,
    querySelectorAll: () => [],
    createElement: () => createMockElement(),
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget)
  };
  globalThis.window = {
    location: { hash },
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1024,
    innerHeight: 768,
    scrollY: 0,
    scrollTo() {},
    supabase: { createClient: () => ({}) }
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return { docTarget, winTarget, body };
}

function setupEditorMockDom({ hash = '', customElements = {}, customQuery = {} } = {}) {
  const cache = new Map();
  const makeEditorEl = (id) => {
    const el = createMockElement(id);
    const fieldWrap = createMockElement(`${id}-field`);
    el.closest = (sel) => (sel === '.pe-field' ? fieldWrap : null);
    return el;
  };
  const getEl = (id) => {
    if (id in customElements) return customElements[id];
    if (!cache.has(id)) cache.set(id, makeEditorEl(id));
    return cache.get(id);
  };
  const queryDefaults = {
    '[data-cata-action="submit"]': createMockElement('cata-submit'),
    '[data-cata-action="cancel"]': createMockElement('cata-cancel'),
    '[data-cata-action="delete"]': createMockElement('cata-delete')
  };
  const docTarget = createMockElement('document');
  const winTarget = createMockElement('window');
  const body = createMockElement('body');
  globalThis.document = {
    body,
    readyState: 'complete',
    activeElement: null,
    getElementById: getEl,
    querySelector: (sel) => (sel in customQuery ? customQuery[sel] : (queryDefaults[sel] || null)),
    querySelectorAll: () => [],
    createElement: () => createMockElement(),
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget)
  };
  globalThis.window = {
    location: { hash },
    addEventListener: winTarget.addEventListener.bind(winTarget),
    removeEventListener: winTarget.removeEventListener.bind(winTarget),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1024,
    innerHeight: 768,
    scrollY: 0,
    scrollTo() {},
    supabase: { createClient: () => ({}) }
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  return { docTarget, winTarget, body, getEl };
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
const { bindStagesTabs } = await import('../../js/pack-editor/bindings/stages-tabs.js');
const { createDeleteMode } = await import('../../js/pack-editor/bindings/delete-mode.js');
const { initTips } = await import('../../js/pack-editor/ui/tooltip.js');
const { initSearch } = await import('../../js/pack-editor/controllers/search.js');
const { deleteDyn } = await import('../../js/pack-editor/controllers/dynamic.js');
const { deleteCata } = await import('../../js/pack-editor/controllers/cataclysm.js');
const { initPackEditor, cleanupPackEditor } = await import('../../js/pack-editor/editor.js');
const { DEFAULT_PACK_ID, MAX_PERSONAL_PACKS } = await import('../../js/services/packs-store.js');

function resetState() {
  state.packId = null;
  state.newPackId = null;
  state.packVersion = null;
  state.packUpdatedAt = null;
  state.defaultConfig = {};
  state.packConfig = {};
  state.extraMeta = {};
  state.baseStages = {};
  state.baseRanges = {};
  state.activeCategory = 'profession';
  state.viewMode = 'llm';
  state.stagesViewMode = 'visual';
  state.isDeleteMode = false;
  state.isConfirming = false;
  state.isSaving = false;
  state.allowLeave = false;
  state.cardsSortDir = 'none';
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
  state.initialForm = { title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: [] };
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

test('initTips: binds all document/window listeners with AbortSignal, allows re-init after abort, and hides/cancels timers on abort', async () => {
  const { docTarget, winTarget, body } = setupMockDom();
  let rafCancelled = 0;
  globalThis.cancelAnimationFrame = () => { rafCancelled++; };

  const docEvents = ['mouseover', 'mouseout', 'focusin', 'focusout', 'keydown', 'scroll', 'pointerdown'];

  const controller1 = new AbortController();
  initTips(controller1.signal);

  for (const type of docEvents) {
    const entries = docTarget.getListeners(type);
    assert.equal(entries.length, 1, `document.${type} must have 1 listener`);
    assert.equal(entries[0].opts?.signal, controller1.signal, `document.${type} must receive { signal }`);
    if (type === 'scroll') {
      assert.equal(entries[0].opts?.capture, true, 'document.scroll must receive { capture: true, signal }');
    }
  }
  const winResize1 = winTarget.getListeners('resize');
  assert.equal(winResize1.length, 1, 'window.resize must have 1 listener');
  assert.equal(winResize1[0].opts?.signal, controller1.signal, 'window.resize must receive { signal }');

  // Показуємо інтерактивну підказку та запускаємо scheduleHide(200) через mouseout
  const tipTarget = createMockElement('tip-target');
  tipTarget.dataset = { tip: 'Нестача карток', tipType: 'shortage' };
  tipTarget.closest = (sel) => (sel === '[data-tip]' ? tipTarget : null);

  await docTarget.dispatch('mouseover', { target: tipTarget });
  const tipEl = body.children[0];
  assert.ok(tipEl, 'tooltip element should be appended to document.body');
  assert.equal(tipEl.classList.contains('is-visible'), true, 'tooltip should become visible on mouseover');
  assert.equal(tipEl.classList.contains('is-interactive'), true, 'shortage tooltip should be interactive');

  await docTarget.dispatch('mouseout', { target: tipTarget, relatedTarget: null });
  rafCancelled = 0;

  controller1.abort();

  assert.equal(tipEl.classList.contains('is-visible'), false, 'abort must call hide() and remove is-visible');
  assert.equal(tipEl.classList.contains('is-interactive'), false, 'abort must call hide() and remove is-interactive');
  assert.ok(rafCancelled > 0, 'abort must trigger hide() -> cancelAnimationFrame');

  // Перевіряємо, що cancelHide() справді скасував відкладений таймер hideTimer
  let removeCallsAfterAbort = 0;
  const origRemove = tipEl.classList.remove.bind(tipEl.classList);
  tipEl.classList.remove = (...args) => {
    removeCallsAfterAbort++;
    return origRemove(...args);
  };
  await new Promise(r => setTimeout(r, 220));
  assert.equal(removeCallsAfterAbort, 0, 'pending hideTimer must be cancelled on abort');

  for (const type of docEvents) {
    assert.equal(docTarget.getListeners(type).length, 0, `document.${type} must be removed on abort`);
  }
  assert.equal(winTarget.getListeners('resize').length, 0, 'window.resize must be removed on abort');

  // Повторна ініціалізація у новій сесії SPA (перевірка, що прапор bound прибрано)
  const controller2 = new AbortController();
  initTips(controller2.signal);

  for (const type of docEvents) {
    const entries = docTarget.getListeners(type);
    assert.equal(entries.length, 1, `document.${type} must re-attach in session 2`);
    assert.equal(entries[0].opts?.signal, controller2.signal, `document.${type} must use controller2.signal`);
  }
  const winResize2 = winTarget.getListeners('resize');
  assert.equal(winResize2.length, 1, 'window.resize must re-attach in session 2');
  assert.equal(winResize2[0].opts?.signal, controller2.signal, 'window.resize must use controller2.signal');

  controller2.abort();
});

test('initSearch: passes { signal } to all addEventListener calls including dynamic window mouseup', async () => {
  resetState();
  const peSearch = createMockElement('pe-search');
  const peSearchClear = createMockElement('pe-search-clear');
  const peSearchAll = createMockElement('pe-search-all');
  const peSearchResults = createMockElement('pe-search-results');
  const peCataList = createMockElement('pe-cata-list');
  const searchInside = createMockElement('pe-search-inside');

  const { winTarget } = setupMockDom(
    {
      'pe-search': peSearch,
      'pe-search-clear': peSearchClear,
      'pe-search-all': peSearchAll,
      'pe-search-results': peSearchResults,
      'pe-cata-list': peCataList
    },
    { '.pe-search__inside': searchInside }
  );

  const controller = new AbortController();
  initSearch(controller.signal);

  const expected = [
    [peSearch, 'input', 'pe-search input'],
    [peSearch, 'keydown', 'pe-search keydown'],
    [peSearchClear, 'click', 'pe-search-clear click'],
    [searchInside, 'mousedown', '.pe-search__inside mousedown'],
    [peSearchAll, 'change', 'pe-search-all change'],
    [peSearchResults, 'click', 'pe-search-results click'],
    [peSearchResults, 'keydown', 'pe-search-results keydown'],
    [peCataList, 'keydown', 'pe-cata-list keydown']
  ];

  for (const [el, type, label] of expected) {
    const entries = el.getListeners(type);
    assert.equal(entries.length, 1, `${label} must register 1 listener`);
    assert.equal(entries[0].opts?.signal, controller.signal, `${label} must pass { signal }`);
  }

  // mousedown усередині .pe-search__inside при активному фокусі на #pe-search вішає window mouseup з { once: true, signal }
  globalThis.document.activeElement = peSearch;
  await searchInside.dispatch('mousedown', { preventDefault() {} });
  const winMouseup = winTarget.getListeners('mouseup');
  assert.equal(winMouseup.length, 1, 'window.mouseup must register when search input had focus');
  assert.equal(winMouseup[0].opts?.once, true, 'window.mouseup must pass once: true');
  assert.equal(winMouseup[0].opts?.signal, controller.signal, 'window.mouseup must pass { signal }');

  controller.abort();

  for (const [el, type, label] of expected) {
    assert.equal(el.getListeners(type).length, 0, `${label} must be removed on abort`);
  }
  assert.equal(winTarget.getListeners('mouseup').length, 0, 'window.mouseup must be removed on abort');
});

test('initPackEditor: stale getPack(A) resolving with data after switching to Pack B does not overwrite Pack B state', async () => {
  resetState();
  setupEditorMockDom({ hash: '#/pack-editor?id=pack-A' });

  const packACalled = deferred();
  const packADeferred = deferred();
  const packBDeferred = deferred();
  const toastCalls = [];

  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };
  globalThis.__packsStoreStub = {
    getDefaultPackConfig: () => Promise.resolve({ default_stages: {}, age_range: { min: 18, max: 60 }, height_range: { min: 150, max: 200 } }),
    getPack: (id) => {
      if (id === 'pack-A') {
        packACalled.resolve();
        return packADeferred.promise;
      }
      if (id === 'pack-B') {
        return packBDeferred.promise;
      }
      return Promise.resolve(null);
    }
  };

  try {
    const initAPromise = initPackEditor();
    await packACalled.promise;

    cleanupPackEditor();
    window.location.hash = '#/pack-editor?id=pack-B';
    const initBPromise = initPackEditor();

    packBDeferred.resolve({
      id: 'pack-B',
      title: 'Pack B',
      description: 'Desc B',
      version: 2,
      config: {},
      extraMeta: {},
      cards: { profession: ['Пілот'] },
      cardObjects: { profession: [{ id: 'b1', value: 'Пілот', meta: {} }] },
      cataclysms: []
    });
    await initBPromise;

    assert.equal(state.form.title, 'Pack B');
    assert.equal(state.cardData.profession?.[0]?.value, 'Пілот');

    // Старий запит Pack A нарешті повертає дані
    packADeferred.resolve({
      id: 'pack-A',
      title: 'Pack A',
      description: 'Desc A',
      version: 1,
      config: {},
      extraMeta: {},
      cards: { profession: ['Хірург'] },
      cardObjects: { profession: [{ id: 'a1', value: 'Хірург', meta: {} }] },
      cataclysms: []
    });
    await initAPromise;

    assert.equal(state.form.title, 'Pack B', 'stale getPack(A) must NOT overwrite Pack B state.form.title');
    assert.equal(state.initialForm.title, 'Pack B', 'stale getPack(A) must NOT overwrite Pack B state.initialForm');
    assert.equal(state.cardData.profession?.length, 1, 'stale getPack(A) must NOT overwrite Pack B state.cardData');
    assert.equal(state.cardData.profession?.[0]?.value, 'Пілот', 'stale getPack(A) must NOT overwrite Pack B cards');
    assert.equal(state.form.texts.profession, 'Пілот', 'stale getPack(A) must NOT overwrite Pack B form.texts');
    assert.deepEqual(toastCalls, [], 'showGlobalToast must NOT be called for stale Pack A');
    assert.equal(window.location.hash, '#/pack-editor?id=pack-B', 'goToList must NOT be called for stale Pack A');
  } finally {
    cleanupPackEditor();
    globalThis.__packsStoreStub = null;
    globalThis.__globalToastStub = null;
  }
});

test('initPackEditor: stale getPack(A) returning null or rejecting after switching to Pack B does not call goToList or showGlobalToast', async () => {
  for (const mode of ['null', 'reject']) {
    resetState();
    setupEditorMockDom({ hash: '#/pack-editor?id=pack-A' });

    const packACalled = deferred();
    const packADeferred = deferred();
    const packBDeferred = deferred();
    const toastCalls = [];

    globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };
    globalThis.__packsStoreStub = {
      getDefaultPackConfig: () => Promise.resolve({ default_stages: {} }),
      getPack: (id) => {
        if (id === 'pack-A') {
          packACalled.resolve();
          return packADeferred.promise;
        }
        return packBDeferred.promise;
      }
    };

    try {
      const initAPromise = initPackEditor();
      await packACalled.promise;

      cleanupPackEditor();
      window.location.hash = '#/pack-editor?id=pack-B';
      const initBPromise = initPackEditor();

      packBDeferred.resolve({
        id: 'pack-B',
        title: 'Pack B',
        description: '',
        version: 1,
        config: {},
        extraMeta: {},
        cards: { profession: ['Пілот'] },
        cardObjects: { profession: [{ id: 'b1', value: 'Пілот', meta: {} }] },
        cataclysms: []
      });
      await initBPromise;

      if (mode === 'null') {
        packADeferred.resolve(null);
      } else {
        packADeferred.reject(new Error('Network fail A'));
      }
      await initAPromise;

      assert.equal(state.form.title, 'Pack B', `[${mode}] Pack B title must remain intact`);
      assert.deepEqual(toastCalls, [], `[${mode}] showGlobalToast must NOT be called for stale Pack A`);
      assert.equal(window.location.hash, '#/pack-editor?id=pack-B', `[${mode}] goToList must NOT be called for stale Pack A`);
    } finally {
      cleanupPackEditor();
      globalThis.__packsStoreStub = null;
      globalThis.__globalToastStub = null;
    }
  }
});

test('initPackEditor: stale checkIsAdmin / countPersonalPacks / getDefaultPackConfig after switching sessions does not mutate state or redirect', async () => {
  // 1) checkIsAdmin() для DEFAULT_PACK_ID зависає, користувач переходить на Pack B
  resetState();
  setupEditorMockDom({ hash: `#/pack-editor?id=${DEFAULT_PACK_ID}` });
  const adminDeferred = deferred();
  const packBDeferred = deferred();
  let toastCalls = [];

  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };
  globalThis.__packsStoreStub = {
    checkIsAdmin: () => adminDeferred.promise,
    getDefaultPackConfig: () => Promise.resolve({}),
    getPack: () => packBDeferred.promise
  };

  try {
    const initDefaultPromise = initPackEditor();
    cleanupPackEditor();
    window.location.hash = '#/pack-editor?id=pack-B';
    const initBPromise = initPackEditor();
    packBDeferred.resolve({
      id: 'pack-B',
      title: 'Pack B',
      description: '',
      version: 1,
      config: {},
      extraMeta: {},
      cards: {},
      cardObjects: {},
      cataclysms: []
    });
    await initBPromise;

    adminDeferred.resolve(false);
    await initDefaultPromise;
    assert.deepEqual(toastCalls, [], 'stale checkIsAdmin must NOT show toast');
    assert.equal(window.location.hash, '#/pack-editor?id=pack-B', 'stale checkIsAdmin must NOT call goToList');
  } finally {
    cleanupPackEditor();
    globalThis.__packsStoreStub = null;
    globalThis.__globalToastStub = null;
  }

  // 2) countPersonalPacks() для нового пака зависає, користувач переходить на Pack B
  resetState();
  setupEditorMockDom({ hash: '#/pack-editor' });
  const countDeferred = deferred();
  const packBDeferred2 = deferred();
  toastCalls = [];

  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };
  globalThis.__packsStoreStub = {
    countPersonalPacks: () => countDeferred.promise,
    getDefaultPackConfig: () => Promise.resolve({}),
    getPack: () => packBDeferred2.promise
  };

  try {
    const initNewPromise = initPackEditor();
    cleanupPackEditor();
    window.location.hash = '#/pack-editor?id=pack-B';
    const initBPromise = initPackEditor();
    packBDeferred2.resolve({
      id: 'pack-B',
      title: 'Pack B',
      description: '',
      version: 1,
      config: {},
      extraMeta: {},
      cards: {},
      cardObjects: {},
      cataclysms: []
    });
    await initBPromise;

    countDeferred.resolve(MAX_PERSONAL_PACKS);
    await initNewPromise;
    assert.deepEqual(toastCalls, [], 'stale countPersonalPacks must NOT show limit toast');
    assert.equal(window.location.hash, '#/pack-editor?id=pack-B', 'stale countPersonalPacks must NOT call goToList');
  } finally {
    cleanupPackEditor();
    globalThis.__packsStoreStub = null;
    globalThis.__globalToastStub = null;
  }

  // 3) getDefaultPackConfig() для нового пака A зависає, користувач переходить на Pack B з іншим конфігом і назвою
  resetState();
  setupEditorMockDom({ hash: '#/pack-editor' });
  const cfgADeferred = deferred();
  const cfgBDeferred = deferred();
  let cfgCall = 0;
  let getPackBCalls = 0;
  toastCalls = [];

  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };
  globalThis.__packsStoreStub = {
    countPersonalPacks: () => Promise.resolve(0),
    getDefaultPackConfig: () => (++cfgCall === 1 ? cfgADeferred.promise : cfgBDeferred.promise),
    getPack: () => {
      getPackBCalls++;
      return Promise.resolve({
        id: 'pack-B',
        title: 'Pack B',
        description: '',
        version: 1,
        config: {},
        extraMeta: {},
        cards: { profession: ['Пілот'] },
        cardObjects: { profession: [{ id: 'b1', value: 'Пілот', meta: {} }] },
        cataclysms: []
      });
    }
  };

  try {
    const initNewPromise = initPackEditor();
    await Promise.resolve();
    await Promise.resolve();

    cleanupPackEditor();
    window.location.hash = '#/pack-editor?id=pack-B';
    const initBPromise = initPackEditor();
    cfgBDeferred.resolve({ age_range: { min: 25, max: 50 } });
    await initBPromise;

    assert.equal(state.defaultConfig.age_range?.min, 25);
    assert.equal(getPackBCalls, 1);

    cfgADeferred.resolve({ age_range: { min: 99, max: 120 } });
    await initNewPromise;

    assert.equal(state.defaultConfig.age_range?.min, 25, 'stale getDefaultPackConfig must NOT overwrite state.defaultConfig');
    assert.equal(state.form.title, 'Pack B', 'stale session must NOT mutate Pack B form');
    assert.equal(getPackBCalls, 1, 'stale session must NOT re-read state.packId and call getPack(B) again');
  } finally {
    cleanupPackEditor();
    globalThis.__packsStoreStub = null;
    globalThis.__globalToastStub = null;
  }
});

test('bindStagesTabs: aborting ctx.signal before showPackConfirm resolves prevents row removal and state.form.stages mutation', async () => {
  resetState();
  const peStages = createMockElement('pe-stages');
  const peRanges = createMockElement('pe-ranges');
  let removeCalls = 0;
  let updateButtonCalls = 0;

  const row = {
    ...createMockElement('stage-row-1'),
    querySelector(sel) {
      if (sel === '.pe-stage-name') return { value: 'Новачок' };
      return null;
    },
    closest(sel) {
      if (sel === '[data-stage-list]') return stageList;
      return null;
    },
    remove() {
      removeCalls++;
    }
  };
  const emptyRow = {
    ...createMockElement('stage-row-empty'),
    querySelector(sel) {
      if (sel === '.pe-stage-name') return { value: '' };
      return null;
    }
  };
  const stageList = {
    dataset: { stageList: 'profession' },
    querySelectorAll(sel) {
      if (sel === '.pe-stage-row') return [row, emptyRow];
      return [];
    }
  };
  const delBtn = {
    closest(sel) {
      if (sel === '.pe-stage-del') return delBtn;
      if (sel === '.pe-stage-row') return row;
      return null;
    }
  };

  setupMockDom(
    { 'pe-stages': peStages, 'pe-ranges': peRanges },
    { '[data-stage-list="profession"]': stageList }
  );

  state.form.stages = { profession: 'Новачок (до 1р)' };

  const confirmDeferred = deferred();
  let confirmCalls = 0;
  globalThis.__packConfirmStub = () => {
    confirmCalls++;
    return confirmDeferred.promise;
  };

  const controller = new AbortController();
  try {
    bindStagesTabs({
      signal: controller.signal,
      updateButtons() { updateButtonCalls++; }
    });

    const clickPromise = peStages.dispatch('click', { target: delBtn });
    assert.equal(confirmCalls, 1, 'showPackConfirm should be awaited');

    controller.abort();
    confirmDeferred.resolve(true);
    await clickPromise;

    assert.equal(removeCalls, 0, 'row.remove() must NOT run after AbortSignal aborts');
    assert.equal(updateButtonCalls, 0, 'ctx.updateButtons must NOT run after AbortSignal aborts');
    assert.equal(state.form.stages.profession, 'Новачок (до 1р)', 'state.form.stages must NOT be mutated after AbortSignal aborts');
  } finally {
    controller.abort();
    globalThis.__packConfirmStub = null;
  }
});

test('deleteDyn: bumping state.sessionId before showPackConfirm resolves prevents deletion and applyDynChange', async () => {
  resetState();
  const { getEl } = setupEditorMockDom({ hash: '#/pack-editor?id=pack-1' });
  const toastCalls = [];
  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };

  const confirmDeferred = deferred();
  globalThis.__packConfirmStub = () => confirmDeferred.promise;

  try {
    state.sessionId = 5;
    state.activeCategory = 'profession';
    state.viewMode = 'visual';
    state.dynEditIndex = 0;
    state.cardData.profession = [{ id: 'd1', value: 'Хірург', meta: {} }];
    state.initialCardMap.set('d1', 'snap-d1');
    state.form.texts.profession = 'Хірург';

    getEl('pe-cat-title').textContent = 'SENTINEL';
    getEl('pe-lines-count').textContent = 'SENTINEL';

    const delPromise = deleteDyn(createMockElement('dyn-del-btn'));
    assert.equal(state.isConfirming, true, 'isConfirming should be true while awaiting');

    cleanupPackEditor();
    confirmDeferred.resolve(true);
    await delPromise;

    assert.equal(state.isConfirming, false, 'isConfirming must be false');
    assert.equal(state.cardData.profession.length, 1, 'card must NOT be spliced after sessionId changes');
    assert.equal(state.deletedCardIds.size, 0, 'markCardDeleted must NOT be called after sessionId changes');
    assert.equal(state.form.texts.profession, 'Хірург', 'state.form.texts must NOT change after sessionId changes');
    assert.equal(getEl('pe-cat-title').textContent, 'SENTINEL', 'applyDynChange / ui.showCategory must NOT run after sessionId changes');
    assert.equal(getEl('pe-lines-count').textContent, 'SENTINEL', 'updateCardsMeta must NOT run after sessionId changes');
    assert.deepEqual(toastCalls, [], 'showGlobalToast must NOT run after sessionId changes');
  } finally {
    globalThis.__packConfirmStub = null;
    globalThis.__globalToastStub = null;
  }
});

test('deleteCata: bumping state.sessionId before showPackConfirm resolves prevents deletion and applyCataChange', async () => {
  resetState();
  const { getEl } = setupEditorMockDom({ hash: '#/pack-editor?id=pack-1' });
  const toastCalls = [];
  globalThis.__globalToastStub = (msg) => { toastCalls.push(msg); };

  const confirmDeferred = deferred();
  globalThis.__packConfirmStub = () => confirmDeferred.promise;

  try {
    state.sessionId = 8;
    state.activeCategory = 'cataclysm';
    state.viewMode = 'visual';
    state.cataEditIndex = 0;
    state.form.cataclysms = [{
      id: 'c1',
      name: 'Потоп',
      description: 'Вода',
      timer_minutes: 5,
      stay_time_months: 12,
      population: 20
    }];
    state.initialCardMap.set('c1', 'snap-c1');
    state.form.texts.cataclysm = 'Потоп';

    getEl('pe-lines-count').textContent = 'SENTINEL';
    getEl('pe-cata-mode').textContent = 'SENTINEL';

    const delPromise = deleteCata(createMockElement('cata-del-btn'));
    assert.equal(state.isConfirming, true, 'isConfirming should be true while awaiting');

    cleanupPackEditor();
    confirmDeferred.resolve(true);
    await delPromise;

    assert.equal(state.isConfirming, false, 'isConfirming must be false');
    assert.equal(state.form.cataclysms.length, 1, 'cataclysm must NOT be spliced after sessionId changes');
    assert.equal(state.deletedCardIds.size, 0, 'markCardDeleted must NOT be called after sessionId changes');
    assert.equal(state.form.texts.cataclysm, 'Потоп', 'state.form.texts.cataclysm must NOT change after sessionId changes');
    assert.equal(getEl('pe-lines-count').textContent, 'SENTINEL', 'applyCataChange must NOT run after sessionId changes');
    assert.equal(getEl('pe-cata-mode').textContent, 'SENTINEL', 'resetCataForm must NOT run after sessionId changes');
    assert.deepEqual(toastCalls, [], 'showGlobalToast must NOT run after sessionId changes');
  } finally {
    globalThis.__packConfirmStub = null;
    globalThis.__globalToastStub = null;
  }
});
