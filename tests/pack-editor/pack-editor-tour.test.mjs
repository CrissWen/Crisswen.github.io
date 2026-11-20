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
  computeTourLayout
} from '../../js/pack-editor/ui/tour.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => { map.set(key, String(val)); },
    removeItem: key => { map.delete(key); }
  };
}

test('PACK_EDITOR_TOUR_STEPS містить 7 валідних кроків з унікальними id', () => {
  assert.equal(TOUR_STORAGE_KEY, 'tb_pe_tour_v1');
  assert.equal(PACK_EDITOR_TOUR_STEPS.length, 7);

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
});
