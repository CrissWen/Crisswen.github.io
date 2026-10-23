// ===== Пошук по характеристиках редактора паків =====
// Чисті функції без DOM: нормалізація, збіг за словами, збір результатів. Рендер результатів — у ui/editor-ui.js.
//
// Запит розбивається на слова, і рядок підходить, якщо містить УСІ слова
// (без урахування регістру й різновидів апострофа).

export const SEARCH_MAX_RESULTS = 100;
const SEARCH_APOSTROPHES = /[\u2019\u02BC\u2018`\u00B4]/g;

export function normalizeSearch(text) {
  return String(text ?? '').toLocaleLowerCase('uk').replace(SEARCH_APOSTROPHES, "'");
}

// Рядок запиту → масив слів для порівняння (порожній масив = пошук неактивний)
export const tokenize = query => normalizeSearch(query).split(/\s+/).filter(Boolean);

export function matchesTokens(text, tokens) {
  const normalized = normalizeSearch(text);
  return tokens.every(token => normalized.includes(token));
}

// Катаклізм шукається за назвою й описом
export const cataMatches = (c, tokens) => matchesTokens(`${c.name ?? ''} ${c.description ?? ''}`, tokens);

// categories — список { category, label }, у яких шукаємо; texts — { [category]: string }; cataclysms — записи катаклізмів.
// Повертає { results, total }: results обрізано до SEARCH_MAX_RESULTS, total — скільки знайдено насправді.
// Елемент результату: { type: 'cata', category, label, index, item } або { type: 'text', category, label, line, cardIndex, text }.
// line — номер сирого рядка тексту (враховує порожні), cardIndex — номер картки серед непорожніх рядків
// (так само рахує parseLines/parseCards, тому саме cardIndex відповідає рядку візуального списку карток).
export function collectSearchResults({ categories, texts, cataclysms, tokens }) {
  const results = [];
  let total = 0;

  for (const { category, label } of categories) {
    if (category === 'cataclysm') {
      cataclysms.forEach((c, index) => {
        if (!cataMatches(c, tokens)) return;
        total++;
        if (results.length < SEARCH_MAX_RESULTS) results.push({ type: 'cata', category, label, index, item: c });
      });
      continue;
    }
    let cardIndex = 0;
    String(texts[category] || '').split('\n').forEach((line, index) => {
      const text = line.trim();
      if (!text) return; // порожній рядок карткою не є і номера картки не отримує
      const currentCard = cardIndex++;
      if (!matchesTokens(text, tokens)) return;
      total++;
      if (results.length < SEARCH_MAX_RESULTS) results.push({ type: 'text', category, label, line: index, cardIndex: currentCard, text });
    });
  }
  return { results, total };
}
