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

export function pickFromStrings(arr, fallback) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return fallback;
  return arr[randInt(0, arr.length - 1)];
}

export function pickCard(arr, fallback = 'Немає даних') {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return { value: fallback, meta: {} };
  return arr[randInt(0, arr.length - 1)];
}

export function pickStage(card, defaultStages) {
  if (card.meta && card.meta.stages && card.meta.stages.length) {
    return pickFromStrings(card.meta.stages, 'Невідома стадія');
  }
  return pickFromStrings(defaultStages, 'Невідома стадія');
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
