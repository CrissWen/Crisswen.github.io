// ===== Випадковість для дій ведучого =====
// Чисті функції без залежностей: використовуються і генерацією карток, і діями (обмін, зсув, кубик).

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getSkewedRandomInt(min, max, skew = 3) {
  let rand = Math.pow(Math.random(), skew); 
  return Math.floor(rand * (max - min + 1)) + min;
}

export function rollChance(probability) {
  return Math.random() < probability;
}

// ===== Зріст за meta картки статури (body_type) =====
// Підтримує обидва формати ключів: плоскі від Pack Editor (height_min / height_max) і вкладений range: { min, max } з JSON.
// Пріоритет: has_no_height → exact_height → кастомний діапазон → глобальний діапазон паку (globalRange = config.height_range).
// Повертає: null (зросту немає), число або рядок (exact_height, що не є числом), або випадкове ціле в діапазоні.
export const DEFAULT_HEIGHT_CM = 170;

const toNum = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? NaN : Number(v);
const firstNum = (...vals) => toNum(vals.find(v => Number.isFinite(toNum(v))));

export function generateHeight(meta, globalRange = null) {
  const m = meta || {};
  if (m.has_no_height === true) return null;

  const exact = m.exact_height;
  if (exact !== undefined && exact !== null && String(exact).trim() !== '') {
    const n = toNum(exact);
    return Number.isFinite(n) ? n : String(exact).trim();
  }

  const min = firstNum(m.height_min, m.range?.min);
  const max = firstNum(m.height_max, m.range?.max);
  const gMin = toNum(globalRange?.min);
  const gMax = toNum(globalRange?.max);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);

  if (hasMin || hasMax) {
    // Якщо задано лише одну межу, друга береться з глобального діапазону (а без нього — збігається з заданою)
    let lo = hasMin ? min : (Number.isFinite(gMin) ? gMin : max);
    let hi = hasMax ? max : (Number.isFinite(gMax) ? gMax : min);
    if (lo > hi) [lo, hi] = [hi, lo];
    return randInt(Math.round(lo), Math.round(hi));
  }

  if (Number.isFinite(gMin) && Number.isFinite(gMax)) return randInt(Math.min(gMin, gMax), Math.max(gMin, gMax));
  return DEFAULT_HEIGHT_CM;
}

export function pickFromStrings(arr, fallback) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return fallback;
  return arr[randInt(0, arr.length - 1)];
}

export function pickCard(arr, fallback = 'Немає даних') {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return { value: fallback, meta: {} };
  return arr[randInt(0, arr.length - 1)];
}

// Назви стадій зі списку: підтримує і рядки, і об'єкти { name, up_to_months } (інакше в стадію потрапив би цілий об'єкт)
const stageNames = list => Array.isArray(list)
  ? list.map(s => (typeof s === 'string' ? s : s?.name)).filter(name => typeof name === 'string' && name.trim() !== '')
  : [];

export function pickStage(card, defaultStages) {
  const own = stageNames(card?.meta?.stages);
  if (own.length) return pickFromStrings(own, 'Невідома стадія');
  return pickFromStrings(stageNames(defaultStages), 'Невідома стадія');
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
