import { PACK_EDITOR_TOUR_STEPS, TOUR_STORAGE_KEY } from '../tour-steps.js';
import { esc } from '../../utils/common/escape-html.js';

const ARROW_INSET = 16;
const OPPOSITE_SIDE = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };
const ARROW_SIDE_FOR_CARD = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };

const clamp = (val, min, max) => Math.min(Math.max(val, min), Math.max(min, max));

export function shouldStartTour(storage, { force = false } = {}) {
  if (force) return true;
  try {
    return storage?.getItem?.(TOUR_STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markTourCompleted(storage) {
  try {
    storage?.setItem?.(TOUR_STORAGE_KEY, '1');
  } catch {
    // Ігноруємо помилки квоти / приватного режиму
  }
}

/**
 * Обчислює позицію прокрутки так, щоб вертикальний центр виділеного елемента
 * збігався з вертикальним центром видимої області (з урахуванням верхнього хедера topInset).
 */
export function computeCenterScrollY({ targetRect, viewportHeight, scrollY, maxScrollY, topInset = 0 }) {
  const usableCenter = topInset + (viewportHeight - topInset) / 2;
  const targetCenterAbs = scrollY + targetRect.top + targetRect.height / 2;
  const desired = targetCenterAbs - usableCenter;
  return clamp(Math.round(desired), 0, Math.max(0, maxScrollY));
}

function fitsOnSide(side, spotlight, cardSize, viewport, gap, edge, topInset = 0) {
  const minTop = topInset + edge;
  if (side === 'bottom') return spotlight.top + spotlight.height + gap + cardSize.height + edge <= viewport.height;
  if (side === 'top') return spotlight.top - gap - cardSize.height - minTop >= 0;
  if (side === 'right') return spotlight.left + spotlight.width + gap + cardSize.width + edge <= viewport.width;
  if (side === 'left') return spotlight.left - gap - cardSize.width - edge >= 0;
  return false;
}

function pickCardSide(preferred, spotlight, cardSize, viewport, gap, edge, topInset = 0) {
  const order = [preferred, OPPOSITE_SIDE[preferred], 'bottom', 'top', 'right', 'left'];
  const seen = new Set();
  for (const side of order) {
    if (!side || seen.has(side)) continue;
    seen.add(side);
    if (fitsOnSide(side, spotlight, cardSize, viewport, gap, edge, topInset)) return side;
  }
  return preferred;
}

/**
 * Розраховує координати вирізу-прожектора (реальний розмір блоку), позицію картки підказки
 * в межах видимої області (з урахуванням topInset хедера) та позицію стрілочки на центр блоку.
 */
export function computeTourLayout({
  targetRect,
  cardSize,
  viewport,
  placement = 'bottom',
  pad = 6,
  gap = 14,
  edge = 12,
  topInset = 0
}) {
  const spotlight = {
    top: Math.round(targetRect.top - pad),
    left: Math.round(targetRect.left - pad),
    width: Math.round(targetRect.width + pad * 2),
    height: Math.round(targetRect.height + pad * 2)
  };

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  const minTop = topInset + edge;

  const side = pickCardSide(placement, spotlight, cardSize, viewport, gap, edge, topInset);
  let rawLeft = targetCenterX - cardSize.width / 2;
  let rawTop = targetCenterY - cardSize.height / 2;

  if (side === 'bottom') rawTop = spotlight.top + spotlight.height + gap;
  else if (side === 'top') rawTop = spotlight.top - cardSize.height - gap;
  else if (side === 'right') rawLeft = spotlight.left + spotlight.width + gap;
  else if (side === 'left') rawLeft = spotlight.left - cardSize.width - gap;

  const left = Math.round(clamp(rawLeft, edge, viewport.width - cardSize.width - edge));
  const top = Math.round(clamp(rawTop, minTop, viewport.height - cardSize.height - edge));

  const arrowSide = ARROW_SIDE_FOR_CARD[side];
  const arrowOffset = (arrowSide === 'top' || arrowSide === 'bottom')
    ? Math.round(clamp(targetCenterX - left, ARROW_INSET, Math.max(ARROW_INSET, cardSize.width - ARROW_INSET)))
    : Math.round(clamp(targetCenterY - top, ARROW_INSET, Math.max(ARROW_INSET, cardSize.height - ARROW_INSET)));

  return {
    spotlight,
    card: { top, left, side },
    arrow: { side: arrowSide, offset: arrowOffset }
  };
}


function getViewportMetrics() {
  const docEl = document.documentElement;
  const width = docEl?.clientWidth || window.innerWidth || 1280;
  const height = docEl?.clientHeight || window.innerHeight || 800;
  const header = document.querySelector('#global-header');
  const headerRect = header?.getBoundingClientRect?.();
  const topInset = (headerRect && headerRect.height > 0 && headerRect.bottom > 0)
    ? Math.round(headerRect.bottom)
    : 0;
  return { width, height, topInset };
}

function createDemoController() {
  const llmCheckbox = document.querySelector('#pe-llm-mode');
  const llmSlot = document.querySelector('#pe-llm-slot');
  const cardsTa = document.querySelector('#pe-cards');
  const listWrap = document.querySelector('#pe-cata-list-wrap');
  const cataList = document.querySelector('#pe-cata-list');
  const formCol = document.querySelector('.pe-char-form-col');
  const linesCount = document.querySelector('#pe-lines-count');
  const sortWrap = document.querySelector('#pe-sort-wrap');
  const bulkBtn = document.querySelector('#pe-bulk-delete-btn');

  const snapshot = {
    llmChecked: Boolean(llmCheckbox?.checked),
    llmSlotActive: Boolean(llmSlot?.classList?.contains('is-active')),
    cardsValue: cardsTa?.value ?? '',
    cardsHidden: Boolean(cardsTa?.hidden),
    listWrapHidden: Boolean(listWrap?.hidden),
    cataListHidden: Boolean(cataList?.hidden),
    cataListHtml: cataList?.innerHTML ?? '',
    formColHidden: Boolean(formCol?.hidden),
    linesCountText: linesCount?.textContent ?? '',
    sortWrapHidden: Boolean(sortWrap?.hidden),
    bulkBtnHidden: Boolean(bulkBtn?.hidden)
  };

  // Додаємо тимчасову демо-картку лише якщо список зараз порожній (щоб не чіпати реальні картки користувача)
  const hasRealRows = Boolean(cataList?.querySelector?.('.added-item-row'))
    || Boolean(cataList?.innerHTML?.includes('added-item-row'));
  if (cataList && !hasRealRows && !(cardsTa?.value || '').trim()) {
    cataList.innerHTML = `
      <button type="button" class="added-item-row pe-tour-demo-row" tabindex="-1">
        <span class="added-item-row__name">Чоловік <span style="opacity:0.7">(Демо-приклад)</span></span>
        <span class="added-item-row__hint">редагувати</span>
      </button>
    `;
    if (cardsTa) cardsTa.value = 'Чоловік';
    if (linesCount) linesCount.textContent = 'Рядків: 1';
  }

  function setPreviewMode(isLlm) {
    if (llmCheckbox) llmCheckbox.checked = isLlm;
    llmSlot?.classList?.toggle('is-active', isLlm);
    if (cardsTa) cardsTa.hidden = !isLlm;
    if (listWrap) listWrap.hidden = isLlm;
    if (cataList) cataList.hidden = isLlm;
    if (formCol) formCol.hidden = isLlm;
    if (sortWrap) sortWrap.hidden = isLlm;
    if (bulkBtn) bulkBtn.hidden = isLlm;
  }

  function restore() {
    if (llmCheckbox) llmCheckbox.checked = snapshot.llmChecked;
    llmSlot?.classList?.toggle('is-active', snapshot.llmSlotActive);
    if (cardsTa) {
      cardsTa.value = snapshot.cardsValue;
      cardsTa.hidden = snapshot.cardsHidden;
    }
    if (listWrap) listWrap.hidden = snapshot.listWrapHidden;
    if (cataList) {
      cataList.innerHTML = snapshot.cataListHtml;
      cataList.hidden = snapshot.cataListHidden;
    }
    if (formCol) formCol.hidden = snapshot.formColHidden;
    if (linesCount) linesCount.textContent = snapshot.linesCountText;
    if (sortWrap) sortWrap.hidden = snapshot.sortWrapHidden;
    if (bulkBtn) bulkBtn.hidden = snapshot.bulkBtnHidden;
  }

  return { setPreviewMode, restore };
}

function resolveActiveSteps(steps) {
  return (steps || []).filter(step => {
    const el = document.querySelector(step.target);
    if (el) return true;
    if (step.demoAction === 'visual-form' && document.querySelector('.pe-char-form-col')) return true;
    return false;
  });
}

/**
 * Запускає інтерактивний онбординг-тур (прожектор + блокувач екрана + картка зі стрілкою).
 */
export function startPackEditorTour({
  signal,
  force = false,
  steps = PACK_EDITOR_TOUR_STEPS,
  storage = globalThis.localStorage,
  onMobileViewChange = null
} = {}) {
  if (signal?.aborted) return null;
  if (!shouldStartTour(storage, { force })) return null;

  // Закриваємо попередній активний тур, якщо він ще відкритий
  document.querySelector('.pe-tour-overlay')?.remove();
  document.querySelector('.pe-tour-spotlight')?.remove();
  document.querySelector('.pe-tour-card')?.remove();

  const tourAbort = new AbortController();
  const demo = createDemoController();
  let activeSteps = resolveActiveSteps(steps);
  if (!activeSteps.length) {
    demo.restore();
    return null;
  }

  let index = 0;
  let settleTimer = 0;
  let fadeTimer = 0;
  let closeTimer = 0;
  let scrollWaitAbort = null;
  let stepToken = 0;
  let hasShownStep = false;
  let demoApplied = false;
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'pe-tour-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const spotlight = document.createElement('div');
  spotlight.className = 'pe-tour-spotlight';
  spotlight.setAttribute('aria-hidden', 'true');

  const card = document.createElement('div');
  card.className = 'pe-tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'pe-tour-title');

  document.body.appendChild(overlay);
  document.body.appendChild(spotlight);
  document.body.appendChild(card);

  function clearScrollWait() {
    clearTimeout(settleTimer);
    clearTimeout(fadeTimer);
    settleTimer = 0;
    fadeTimer = 0;
    scrollWaitAbort?.abort();
    scrollWaitAbort = null;
  }

  function destroyDom() {
    clearTimeout(closeTimer);
    closeTimer = 0;
    tourAbort.abort();
    overlay.remove();
    spotlight.remove();
    card.remove();
  }

  function close(markDone = true, immediate = false, { scrollToTop = false } = {}) {
    if (closed) return;
    closed = true;
    stepToken++;
    clearScrollWait();
    demo.restore();
    if (markDone) markTourCompleted(storage);
    if (scrollToTop) window.scrollTo?.({ top: 0, behavior: 'smooth' });
    if (immediate) {
      destroyDom();
      return;
    }
    overlay.style.pointerEvents = 'none';
    spotlight.classList.remove('is-visible');
    card.classList.remove('is-visible');
    closeTimer = setTimeout(destroyDom, 220);
  }

  function updatePosition() {
    if (closed) return;
    const step = activeSteps[index];
    if (!step) return;
    const targetEl = document.querySelector(step.target);
    if (!targetEl) return;

    const targetRect = targetEl.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const cardSize = {
      width: cardRect.width || 320,
      height: cardRect.height || 180
    };
    const { width, height, topInset } = getViewportMetrics();

    const layout = computeTourLayout({
      targetRect,
      cardSize,
      viewport: { width, height },
      placement: step.placement || 'bottom',
      topInset
    });

    spotlight.style.top = `${layout.spotlight.top}px`;
    spotlight.style.left = `${layout.spotlight.left}px`;
    spotlight.style.width = `${layout.spotlight.width}px`;
    spotlight.style.height = `${layout.spotlight.height}px`;

    card.style.top = `${layout.card.top}px`;
    card.style.left = `${layout.card.left}px`;
    card.dataset.side = layout.card.side;

    const arrow = card.querySelector('.pe-tour-arrow');
    if (arrow) {
      arrow.dataset.arrowSide = layout.arrow.side;
      if (layout.arrow.side === 'top' || layout.arrow.side === 'bottom') {
        arrow.style.left = `${layout.arrow.offset}px`;
        arrow.style.top = '';
      } else {
        arrow.style.top = `${layout.arrow.offset}px`;
        arrow.style.left = '';
      }
    }
  }

  function revealStep(token) {
    if (closed || token !== stepToken) return;
    clearScrollWait();
    hasShownStep = true;
    updatePosition();
    spotlight.classList.add('is-visible');
    card.classList.add('is-visible');
    card.querySelector('[data-tour-action="next"]')?.focus?.({ preventScroll: true });
  }

  function waitForScrollAndReveal(targetScrollY, token) {
    clearScrollWait();
    const startY = window.scrollY || 0;
    if (Math.abs(targetScrollY - startY) < 2) {
      revealStep(token);
      return;
    }

    window.scrollTo?.({ top: targetScrollY, behavior: 'smooth' });

    // Якщо середовище прокрутило синхронно (наприклад, без плавного скролу або в тестах)
    if (Math.abs(targetScrollY - (window.scrollY || 0)) < 2) {
      revealStep(token);
      return;
    }

    scrollWaitAbort = new AbortController();
    const waitSignal = scrollWaitAbort.signal;

    const finish = () => revealStep(token);
    window.addEventListener('scrollend', finish, { once: true, signal: waitSignal });

    let debounceTimer = 0;
    const onScrollTick = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (Math.abs(targetScrollY - (window.scrollY || 0)) < 3) finish();
      }, 120);
    };
    window.addEventListener('scroll', onScrollTick, { passive: true, signal: waitSignal });
    waitSignal.addEventListener('abort', () => clearTimeout(debounceTimer), { once: true });

    settleTimer = setTimeout(finish, 850);
  }

  function applyStep(token) {
    if (closed || token !== stepToken) return;
    const step = activeSteps[index];
    if (!step) {
      close(true);
      return;
    }

    if (step.mobileView && typeof onMobileViewChange === 'function') {
      onMobileViewChange(step.mobileView);
    }

    if (step.demoAction === 'enable-llm' || step.demoAction === 'preview-list-llm' || step.demoAction === 'visual-form') {
      demo.setPreviewMode(false);
    }

    const targetEl = document.querySelector(step.target);
    if (!targetEl) {
      close(true);
      return;
    }

    const isFirst = index === 0;
    const isLast = index === activeSteps.length - 1;

    card.innerHTML = `
      <span class="pe-tour-arrow" aria-hidden="true"></span>
      <div class="pe-tour-card__head">
        <span class="pe-tour-card__step">${index + 1} / ${activeSteps.length}</span>
        <h3 id="pe-tour-title" class="pe-tour-card__title">${esc(step.title)}</h3>
      </div>
      <p class="pe-tour-card__body">${esc(step.text)}</p>
      <div class="pe-tour-card__actions">
        <button type="button" class="pk-btn pk-btn--ghost pe-tour-btn-skip" data-tour-action="skip">Пропустити гайд</button>
        <div class="pe-tour-card__nav">
          <button type="button" class="pk-btn pk-btn--ghost" data-tour-action="prev"${isFirst ? ' disabled' : ''}>Назад</button>
          <button type="button" class="pk-btn pk-btn--primary" data-tour-action="next">${isLast ? 'Готово' : 'Далі'}</button>
        </div>
      </div>
    `;

    const rect = targetEl.getBoundingClientRect();
    const docHeight = document.documentElement?.scrollHeight || 0;
    const { height: viewportHeight, topInset } = getViewportMetrics();
    const maxScrollY = Math.max(0, docHeight - viewportHeight);
    const targetScrollY = computeCenterScrollY({
      targetRect: rect,
      viewportHeight,
      scrollY: window.scrollY || 0,
      maxScrollY,
      topInset
    });

    waitForScrollAndReveal(targetScrollY, token);
  }

  function renderStep() {
    if (closed) return;
    stepToken++;
    demoApplied = false;
    const token = stepToken;
    clearScrollWait();

    if (hasShownStep) {
      spotlight.classList.remove('is-visible');
      card.classList.remove('is-visible');
      fadeTimer = setTimeout(() => applyStep(token), 180);
    } else {
      applyStep(token);
    }
  }

  function next() {
    if (closed) return;
    const step = activeSteps[index];
    if (!demoApplied && (step?.demoAction === 'enable-llm' || step?.demoAction === 'preview-list-llm')) {
      demoApplied = true;
      demo.setPreviewMode(true);
      updatePosition();
      return;
    }
    if (index >= activeSteps.length - 1) {
      close(true, false, { scrollToTop: true });
      return;
    }
    index += 1;
    renderStep();
  }

  function prev() {
    if (closed) return;
    if (demoApplied) {
      demoApplied = false;
      demo.setPreviewMode(false);
      updatePosition();
      return;
    }
    if (index <= 0) return;
    index -= 1;
    renderStep();
  }

  card.addEventListener('click', e => {
    const btn = e.target?.closest?.('[data-tour-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.tourAction;
    if (action === 'next') next();
    else if (action === 'prev') prev();
    else if (action === 'skip') close(true);
  }, { signal: tourAbort.signal });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    }
  }, { signal: tourAbort.signal });

  window.addEventListener('scroll', updatePosition, { passive: true, signal: tourAbort.signal });
  window.addEventListener('resize', updatePosition, { signal: tourAbort.signal });

  signal?.addEventListener('abort', () => close(false, true), { once: true });

  renderStep();

  return {
    close,
    next,
    prev,
    getStepIndex: () => index
  };
}
