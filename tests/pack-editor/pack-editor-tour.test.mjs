import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUR_STORAGE_KEY,
  PACK_EDITOR_TOUR_STEPS
} from '../../js/pack-editor/tour-steps.js';
import {
  shouldStartTour,
  markTourCompleted,
  computeCenterScrollY,
  computeTourLayout,
  startPackEditorTour
} from '../../js/pack-editor/ui/tour.js';
import { packEditorTemplate } from '../../js/pack-editor/ui/template.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(key, String(val)); },
    removeItem: key => { map.delete(key); }
  };
}

test('PACK_EDITOR_TOUR_STEPS містить 8 валідних кроків по цілих блоках з унікальними id', () => {
  assert.equal(TOUR_STORAGE_KEY, 'tb_pe_tour_v1');
  assert.equal(PACK_EDITOR_TOUR_STEPS.length, 8);

  const ids = new Set();
  const allowedPlacements = new Set(['top', 'bottom', 'left', 'right']);
  for (const step of PACK_EDITOR_TOUR_STEPS) {
    assert.ok(step.id && typeof step.id === 'string');
    assert.ok(!ids.has(step.id), `duplicate step id: ${step.id}`);
    ids.add(step.id);
    assert.ok(step.target && typeof step.target === 'string');
    assert.ok(step.title && typeof step.title === 'string');
    assert.ok(step.text && typeof step.text === 'string');
    assert.ok(allowedPlacements.has(step.placement), `invalid placement: ${step.placement}`);
  }
});

test('shouldStartTour та markTourCompleted коректно керують першим входом і force-запуском', () => {
  const storage = createMemoryStorage();
  assert.equal(shouldStartTour(storage), true);

  markTourCompleted(storage);
  assert.equal(storage.getItem(TOUR_STORAGE_KEY), '1');
  assert.equal(shouldStartTour(storage), false);
  assert.equal(shouldStartTour(storage, { force: true }), true);
});

test('computeCenterScrollY центрує елемент у viewport і обмежує [0, maxScrollY]', () => {
  // target center = 800 + 100/2 = 850 (relative to viewport), scrollY = 200 -> abs center = 1050
  // viewportHeight = 800 -> targetScrollY = 1050 - 400 = 650
  const centered = computeCenterScrollY({
    targetRect: { top: 800, height: 100 },
    viewportHeight: 800,
    scrollY: 200,
    maxScrollY: 2000
  });
  assert.equal(centered, 650);

  // Near top -> clamp to 0
  const clampedTop = computeCenterScrollY({
    targetRect: { top: 40, height: 60 },
    viewportHeight: 800,
    scrollY: 0,
    maxScrollY: 2000
  });
  assert.equal(clampedTop, 0);

  // Near bottom -> clamp to maxScrollY
  const clampedBottom = computeCenterScrollY({
    targetRect: { top: 700, height: 100 },
    viewportHeight: 800,
    scrollY: 1800,
    maxScrollY: 2000
  });
  assert.equal(clampedBottom, 2000);

  // With topInset (global header 64px): usable center = 64 + (800 - 64)/2 = 432
  // target center = 850 + 200 = 1050 -> scrollY = 1050 - 432 = 618
  const withHeader = computeCenterScrollY({
    targetRect: { top: 800, height: 100 },
    viewportHeight: 800,
    scrollY: 200,
    maxScrollY: 2000,
    topInset: 64
  });
  assert.equal(withHeader, 618);
});

test('computeTourLayout розраховує прожектор, перевертає картку при нестачі місця і наводить стрілку на центр елемента', () => {
  const layoutBottom = computeTourLayout({
    targetRect: { top: 120, left: 100, width: 300, height: 60, right: 400, bottom: 180 },
    cardSize: { width: 320, height: 180 },
    viewport: { width: 1280, height: 800 },
    placement: 'bottom'
  });
  assert.deepEqual(layoutBottom.spotlight, { top: 114, left: 94, width: 312, height: 72 });
  assert.equal(layoutBottom.card.side, 'bottom');
  assert.equal(layoutBottom.arrow.side, 'top');
  assert.ok(layoutBottom.card.top > layoutBottom.spotlight.top + layoutBottom.spotlight.height);

  // Near bottom edge: preferred 'bottom' does not fit -> must flip to 'top'
  const flippedToTop = computeTourLayout({
    targetRect: { top: 680, left: 200, width: 260, height: 60, right: 460, bottom: 740 },
    cardSize: { width: 320, height: 180 },
    viewport: { width: 1280, height: 800 },
    placement: 'bottom'
  });
  assert.equal(flippedToTop.card.side, 'top');
  assert.equal(flippedToTop.arrow.side, 'bottom');
  assert.ok(flippedToTop.card.top + 180 < flippedToTop.spotlight.top);

  // Near right edge: preferred 'right' does not fit -> flip to 'left'
  const flippedToLeft = computeTourLayout({
    targetRect: { top: 250, left: 1050, width: 200, height: 120, right: 1250, bottom: 370 },
    cardSize: { width: 320, height: 180 },
    viewport: { width: 1280, height: 800 },
    placement: 'right'
  });
  assert.equal(flippedToLeft.card.side, 'left');
  assert.equal(flippedToLeft.arrow.side, 'right');

  // Tall block exceeding viewport height: spotlight keeps full true size without clamping, while card stays in viewport below topInset
  const tallBlock = computeTourLayout({
    targetRect: { top: -150, left: 80, width: 500, height: 1100, right: 580, bottom: 950 },
    cardSize: { width: 320, height: 180 },
    viewport: { width: 1280, height: 800 },
    placement: 'top',
    topInset: 64
  });
  assert.deepEqual(tallBlock.spotlight, { top: -156, left: 74, width: 512, height: 1112 });
  assert.ok(tallBlock.card.top >= 64 + 12 && tallBlock.card.top + 180 <= 800 - 12);
});


function createMockDom(targets = {}) {
  const listeners = new Map();
  const makeClassList = el => {
    const set = new Set();
    return {
      add: (...cls) => cls.forEach(c => set.add(c)),
      remove: (...cls) => cls.forEach(c => set.delete(c)),
      contains: c => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) set.has(c) ? set.delete(c) : set.add(c);
        else if (force) set.add(c);
        else set.delete(c);
      },
      toArray: () => [...set]
    };
  };

  function createEl(tag) {
    const elListeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      dataset: {},
      attributes: {},
      children: [],
      parentNode: null,
      disabled: false,
      hidden: false,
      textContent: '',
      _innerHTML: '',
      classList: null,
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
        this.parentNode = null;
      },
      addEventListener(type, fn, opts) {
        if (!elListeners.has(type)) elListeners.set(type, []);
        elListeners.get(type).push(fn);
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            elListeners.set(type, (elListeners.get(type) || []).filter(f => f !== fn));
          }, { once: true });
        }
      },
      dispatchEvent(evt) {
        for (const fn of [...(elListeners.get(evt.type) || [])]) fn(evt);
      },
      focus() { mockDocument.activeElement = this; },
      getBoundingClientRect() {
        return { top: 0, left: 0, width: 320, height: 180, right: 320, bottom: 180 };
      },
      querySelector(sel) {
        if (sel.startsWith('[data-tour-action="')) {
          const action = sel.slice('[data-tour-action="'.length, -2);
          return this._actionButtons?.[action] || null;
        }
        if (sel === '#pe-tour-title') return this._titleEl || null;
        if (sel === '.pe-tour-card__body') return this._bodyEl || null;
        if (sel === '.pe-tour-card__step') return this._stepEl || null;
        if (sel === '.pe-tour-arrow') return this._arrowEl || null;
        return null;
      },
      set innerHTML(html) {
        this._innerHTML = html;
      },
      get innerHTML() {
        return this._innerHTML;
      }
    };
    el.classList = makeClassList(el);
    return el;
  }

  const body = createEl('body');
  const scrollCalls = [];

  const mockDocument = {
    body,
    activeElement: null,
    documentElement: { scrollHeight: 3000, clientHeight: 800 },
    createElement: createEl,
    querySelector(sel) {
      if (targets[sel]) return targets[sel];
      if (sel === '.pe-tour-overlay') return body.children.find(c => c.className.includes('pe-tour-overlay')) || null;
      if (sel === '.pe-tour-spotlight') return body.children.find(c => c.className.includes('pe-tour-spotlight')) || null;
      if (sel === '.pe-tour-card') return body.children.find(c => c.className.includes('pe-tour-card')) || null;
      return null;
    },
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => {
          listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
        }, { once: true });
      }
    },
    dispatchEvent(evt) {
      for (const fn of [...(listeners.get(evt.type) || [])]) fn(evt);
    }
  };

  const mockWindow = {
    innerWidth: 1280,
    innerHeight: 800,
    scrollY: 0,
    scrollTo(opts) {
      scrollCalls.push(opts);
      if (typeof opts?.top === 'number') this.scrollY = opts.top;
    },
    addEventListener(type, fn, opts) {
      mockDocument.addEventListener(`win:${type}`, fn, opts);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  };

  return { mockDocument, mockWindow, scrollCalls, body };
}

test('packEditorTemplate рендерить кнопку повторного запуску гайду #pe-tour-start-btn у шапці', () => {
  const html = packEditorTemplate({ isEdit: false, isDefaultEdit: false });
  assert.ok(html.includes('id="pe-tour-start-btn"'));
});

test('startPackEditorTour монтує блокувач, прожектор, діалог зі стрілкою, центрує елемент і підтримує Пропустити/Назад/Далі', async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const storage = createMemoryStorage();
  const target1 = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 900, left: 100, width: 300, height: 80, right: 400, bottom: 980 })
  };
  const target2 = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 200, left: 120, width: 280, height: 60, right: 400, bottom: 260 })
  };
  const { mockDocument, mockWindow, scrollCalls } = createMockDom({
    '#step-one': target1,
    '#step-two': target2
  });

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = mockDocument;
  globalThis.window = mockWindow;

  try {
    const controller = new AbortController();
    const steps = [
      { id: 'one', target: '#step-one', title: 'Крок 1', text: 'Опис 1', placement: 'bottom' },
      { id: 'missing', target: '#not-in-dom', title: 'Пропуск', text: 'Немає в DOM', placement: 'bottom' },
      { id: 'two', target: '#step-two', title: 'Крок 2', text: 'Опис 2', placement: 'top' }
    ];

    const tour = startPackEditorTour({ signal: controller.signal, steps, storage });
    assert.ok(tour);

    const overlay = mockDocument.querySelector('.pe-tour-overlay');
    const spotlight = mockDocument.querySelector('.pe-tour-spotlight');
    const card = mockDocument.querySelector('.pe-tour-card');
    assert.ok(overlay);
    assert.ok(spotlight);
    assert.ok(card);
    assert.equal(card.getAttribute('role'), 'dialog');
    assert.equal(card.getAttribute('aria-labelledby'), 'pe-tour-title');
    assert.ok(card.innerHTML.includes('Пропустити гайд'));
    assert.ok(scrollCalls.length >= 1);
    // target1 center = 940, viewport center = 400 -> scroll top = 540
    assert.equal(scrollCalls[0].top, 540);
    assert.equal(spotlight.classList.contains('is-visible'), true);
    assert.equal(card.classList.contains('is-visible'), true);

    // Step 0 -> Step 1 (skips missing #not-in-dom, fades out ~180ms before applying)
    tour.next();
    assert.equal(tour.getStepIndex(), 1);
    await wait(210);
    assert.ok(card.innerHTML.includes('Готово'));

    // Back -> Step 0
    tour.prev();
    assert.equal(tour.getStepIndex(), 0);
    await wait(210);

    // Finish -> marks completed and fades out (~220ms) before removing DOM
    tour.next();
    await wait(210);
    tour.next();
    assert.equal(storage.getItem(TOUR_STORAGE_KEY), '1');
    await wait(250);
    assert.equal(mockDocument.querySelector('.pe-tour-overlay'), null);
    assert.equal(mockDocument.querySelector('.pe-tour-spotlight'), null);
    assert.equal(mockDocument.querySelector('.pe-tour-card'), null);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});

test('abort signal прибирає DOM туру і НЕ позначає незавершений гайд як пройдений', () => {
  const storage = createMemoryStorage();
  const target1 = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 150, left: 100, width: 250, height: 60, right: 350, bottom: 210 })
  };
  const { mockDocument, mockWindow } = createMockDom({ '#step-one': target1 });

  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  globalThis.document = mockDocument;
  globalThis.window = mockWindow;

  try {
    const controller = new AbortController();
    startPackEditorTour({
      signal: controller.signal,
      steps: [{ id: 'one', target: '#step-one', title: 'Крок 1', text: 'Опис 1', placement: 'bottom' }],
      storage
    });
    assert.ok(mockDocument.querySelector('.pe-tour-card'));

    controller.abort();
    assert.equal(mockDocument.querySelector('.pe-tour-overlay'), null);
    assert.equal(mockDocument.querySelector('.pe-tour-spotlight'), null);
    assert.equal(mockDocument.querySelector('.pe-tour-card'), null);
    assert.equal(storage.getItem(TOUR_STORAGE_KEY), null);
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
  }
});
