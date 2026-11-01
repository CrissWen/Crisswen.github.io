// ===== Утиліта безпечного глибокого клонування об'єктів та масивів =====

/**
 * Глибоке копіювання значень з використанням native structuredClone
 * та запасним варіантом через JSON.parse/JSON.stringify.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

