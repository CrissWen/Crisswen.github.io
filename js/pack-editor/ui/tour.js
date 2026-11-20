import { TOUR_STORAGE_KEY } from '../tour-steps.js';

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
 * збігався з вертикальним центром viewport користувача (в межах [0, maxScrollY]).
 */
export function computeCenterScrollY({ targetRect, viewportHeight, scrollY, maxScrollY }) {
  const targetCenterAbs = scrollY + targetRect.top + targetRect.height / 2;
  const desired = targetCenterAbs - viewportHeight / 2;
  return clamp(Math.round(desired), 0, Math.max(0, maxScrollY));
}

function fitsOnSide(side, spotlight, cardSize, viewport, gap, edge) {
  if (side === 'bottom') return spotlight.top + spotlight.height + gap + cardSize.height + edge <= viewport.height;
  if (side === 'top') return spotlight.top - gap - cardSize.height - edge >= 0;
  if (side === 'right') return spotlight.left + spotlight.width + gap + cardSize.width + edge <= viewport.width;
  if (side === 'left') return spotlight.left - gap - cardSize.width - edge >= 0;
  return false;
}

function pickCardSide(preferred, spotlight, cardSize, viewport, gap, edge) {
  const order = [preferred, OPPOSITE_SIDE[preferred], 'bottom', 'top', 'right', 'left'];
  const seen = new Set();
  for (const side of order) {
    if (!side || seen.has(side)) continue;
    seen.add(side);
    if (fitsOnSide(side, spotlight, cardSize, viewport, gap, edge)) return side;
  }
  return preferred;
}

/**
 * Розраховує координати вирізу-прожектора, позицію картки підказки (з автопереворотом)
 * та позицію стрілочки, яка завжди вказує на центр виділеного елемента.
 */
export function computeTourLayout({
  targetRect,
  cardSize,
  viewport,
  placement = 'bottom',
  pad = 6,
  gap = 14,
  edge = 12
}) {
  const spotlight = {
    top: Math.max(4, Math.round(targetRect.top - pad)),
    left: Math.max(4, Math.round(targetRect.left - pad)),
    width: Math.round(targetRect.width + pad * 2),
    height: Math.round(targetRect.height + pad * 2)
  };
  spotlight.width = Math.min(spotlight.width, Math.max(24, viewport.width - spotlight.left - 4));
  spotlight.height = Math.min(spotlight.height, Math.max(24, viewport.height - spotlight.top - 4));

  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  const side = pickCardSide(placement, spotlight, cardSize, viewport, gap, edge);
  let rawLeft = targetCenterX - cardSize.width / 2;
  let rawTop = targetCenterY - cardSize.height / 2;

  if (side === 'bottom') rawTop = spotlight.top + spotlight.height + gap;
  else if (side === 'top') rawTop = spotlight.top - cardSize.height - gap;
  else if (side === 'right') rawLeft = spotlight.left + spotlight.width + gap;
  else if (side === 'left') rawLeft = spotlight.left - cardSize.width - gap;

  const left = Math.round(clamp(rawLeft, edge, viewport.width - cardSize.width - edge));
  const top = Math.round(clamp(rawTop, edge, viewport.height - cardSize.height - edge));

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
