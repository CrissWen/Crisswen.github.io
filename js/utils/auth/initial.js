// ===== Ініціал імені для аватарок =====
// charAt(0)/[0] беруть лише першу UTF-16 одиницю і розрізають емодзі навпіл (сурогатні пари, прапори, ZWJ-послідовності).
// Тут беремо цілий перший символ-графему; де Intl.Segmenter недоступний — перший кодовий пункт.

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Перший символ рядка як ціле значення. Порожній рядок для null/undefined/''.
 * Пробіли не обрізаються — викликач сам робить trim(), якщо потрібно.
 */
export function firstChar(value) {
  const str = String(value ?? '');
  if (!str) return '';
  if (graphemeSegmenter) {
    const first = graphemeSegmenter.segment(str)[Symbol.iterator]().next();
    return first.done ? '' : first.value.segment;
  }
  return Array.from(str)[0] ?? '';
}
