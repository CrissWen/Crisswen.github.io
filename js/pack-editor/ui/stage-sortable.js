import { OBJECT_STAGE_KEYS, STAGE_KEYS } from '../payload.js';
import Sortable from '../../vendor/sortable.esm.js';
import { updateStageListVisuals } from './stage-list.js';

// ===== Перетягування стадій (Sortable): автоскрол, колесо миші, прибирання слухачів =====

let sortableInstances = {};
let stageReorderCallback = null;
let activeDragContainer = null;
let activeDragSens = 140;
let lastPointerEvent = null;
let autoScrollRafId = null;
let lastScrollTimestamp = 0;

function startAutoScroll() {
  if (autoScrollRafId) return;
  lastScrollTimestamp = performance.now();

  const step = (now) => {
    if (!activeDragContainer) {
      autoScrollRafId = null;
      return;
    }

    const dt = Math.min((now - lastScrollTimestamp) / 1000, 0.05);
    lastScrollTimestamp = now;

    if (lastPointerEvent && dt > 0) {
      const rect = activeDragContainer.getBoundingClientRect();
      const clientY = lastPointerEvent.clientY;
      const clientX = lastPointerEvent.clientX;

      if (clientX >= rect.left - 50 && clientX <= rect.right + 50 &&
          clientY >= rect.top - 70 && clientY <= rect.bottom + 70) {
        let dir = 0;
        let ratio = 0;

        if (clientY < rect.top + activeDragSens) {
          const dist = Math.max(0, clientY - rect.top);
          ratio = Math.max(0, Math.min(1, 1 - dist / activeDragSens));
          dir = -1;
        } else if (clientY > rect.bottom - activeDragSens) {
          const dist = Math.max(0, rect.bottom - clientY);
          ratio = Math.max(0, Math.min(1, 1 - dist / activeDragSens));
          dir = 1;
        }

        if (dir !== 0 && ratio > 0) {
          // Плавне наростання: від 100px/с до 550px/с біля самого краю
          const speed = 100 + Math.pow(ratio, 2) * 450;
          activeDragContainer.scrollTop += dir * speed * dt;

          if (Sortable.active && typeof Sortable.active._onTouchMove === 'function') {
            try {
              Sortable.active._onTouchMove(lastPointerEvent);
            } catch (_) {}
          }
        }
      }
    }

    autoScrollRafId = requestAnimationFrame(step);
  };

  autoScrollRafId = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }
}

function onDragPointerMove(e) {
  lastPointerEvent = e;
}

function handleWheelDuringDrag(e) {
  if (!activeDragContainer) return;
  const rect = activeDragContainer.getBoundingClientRect();
  if (e.clientX >= rect.left - 50 && e.clientX <= rect.right + 50 &&
      e.clientY >= rect.top - 50 && e.clientY <= rect.bottom + 50) {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    activeDragContainer.scrollTop += dy;

    const moveEvt = lastPointerEvent || e;
    if (Sortable.active && typeof Sortable.active._onTouchMove === 'function') {
      try {
        Sortable.active._onTouchMove(moveEvt);
      } catch (_) {}
    }
  }
}

function cleanupDragListeners() {
  document.body.classList.remove('is-stage-dragging');
  stopAutoScroll();
  window.removeEventListener('pointermove', onDragPointerMove, { capture: true });
  window.removeEventListener('mousemove', onDragPointerMove, { capture: true });
  window.removeEventListener('wheel', handleWheelDuringDrag, { capture: true });
  activeDragContainer = null;
  lastPointerEvent = null;
}

function createStageSortable(container, key, { dragSens, onReorder }) {
  const isObjectStage = OBJECT_STAGE_KEYS.includes(key);
  let savedSlotTimes = [];

  return new Sortable(container, {
    animation: 150,
    handle: '.pe-stage-handle',
    filter: '.pe-stage-row--new',
    preventOnFilter: false,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackClass: 'sortable-fallback',
    fallbackTolerance: 2,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    scroll: false,
    swapThreshold: isObjectStage ? 0.55 : 0.7,
    invertSwap: isObjectStage,
    direction: 'vertical',
    onMove(evt) {
      if (evt.related && evt.related.classList.contains('pe-stage-row--new')) {
        return -1;
      }
      return true;
    },
    onStart() {
      document.body.classList.add('is-stage-dragging');
      activeDragContainer = container;
      activeDragSens = dragSens;
      lastPointerEvent = null;
      window.addEventListener('pointermove', onDragPointerMove, { capture: true, passive: true });
      window.addEventListener('mousemove', onDragPointerMove, { capture: true, passive: true });
      window.addEventListener('wheel', handleWheelDuringDrag, { passive: false, capture: true });
      startAutoScroll();

      if (isObjectStage) {
        const validRows = [...container.querySelectorAll('.pe-stage-row:not(.pe-stage-row--new)')];
        savedSlotTimes = validRows.map(row => ({
          y: row.querySelector('[data-type="y"]')?.value ?? '0',
          m: row.querySelector('[data-type="m"]')?.value ?? '0'
        }));
      }
    },
    onEnd() {
      cleanupDragListeners();

      const newRow = container.querySelector('.pe-stage-row--new');
      if (newRow && container.lastElementChild !== newRow) {
        container.appendChild(newRow);
      }

      if (isObjectStage && savedSlotTimes.length) {
        const validRows = [...container.querySelectorAll('.pe-stage-row:not(.pe-stage-row--new)')];
        validRows.forEach((row, idx) => {
          if (savedSlotTimes[idx]) {
            const yInput = row.querySelector('[data-type="y"]');
            const mInput = row.querySelector('[data-type="m"]');
            if (yInput) yInput.value = savedSlotTimes[idx].y;
            if (mInput) mInput.value = savedSlotTimes[idx].m;
          }
        });
      }

      updateStageListVisuals(key, container);
      if (typeof onReorder === 'function') {
        onReorder(key);
      }
    }
  });
}

export function setStageReorderCallback(cb) {
  stageReorderCallback = cb;
}

export function destroyStageSortables() {
  cleanupDragListeners();
  Object.values(sortableInstances).forEach(s => {
    try { s.destroy(); } catch (_) {}
  });
  sortableInstances = {};
  destroyDynStageSortable();
}

export function initStageSortables(onStageReordered) {
  if (typeof onStageReordered === 'function') {
    stageReorderCallback = onStageReordered;
  }

  STAGE_KEYS.forEach(key => {
    const container = document.querySelector(`[data-stage-list="${key}"]`);
    if (!container) return;

    if (sortableInstances[key]) {
      try { sortableInstances[key].destroy(); } catch (_) {}
      delete sortableInstances[key];
    }

    const isObjectStage = OBJECT_STAGE_KEYS.includes(key);
    sortableInstances[key] = createStageSortable(container, key, {
      dragSens: isObjectStage ? 220 : 140,
      onReorder: k => stageReorderCallback?.(k)
    });
  });
}

let dynSortableInstance = null;

export function destroyDynStageSortable() {
  if (dynSortableInstance) {
    try { dynSortableInstance.destroy(); } catch (_) {}
    dynSortableInstance = null;
  }
}

export function initDynStageSortable(key, onReordered = null) {
  const container = document.querySelector(`[data-dyn-stage-list="${key}"]`);
  if (!container) return;

  destroyDynStageSortable();
  dynSortableInstance = createStageSortable(container, key, {
    dragSens: 140,
    onReorder: onReordered
  });
}
