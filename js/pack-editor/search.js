import { parseCardLine, splitNameExplanation, hasExplanationField } from './parser.js';

// ===== Пошук по характеристиках редактора паків =====
// Чисті функції без DOM: нормалізація, збіг за словами, збір результатів. Рендер результатів — у ui/search.js.
//
// Запит розбивається на слова, і рядок підходить, якщо містить УСІ слова
// (без урахування регістру й різновидів апострофа).

export const SEARCH_MAX_RESULTS = 100;
const SEARCH_APOSTROPHES = /[\u2019\u02BC\u2018`\u00B4]/g;

const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeSearch(text) {
  return String(text ?? '').toLocaleLowerCase('uk').replace(SEARCH_APOSTROPHES, "'");
}

// Рядок запиту → масив слів для порівняння (порожній масив = пошук неактивний)
export const tokenize = query => normalizeSearch(query).split(/\s+/).filter(Boolean);

export function matchesTokens(text, tokens, { wholeWord = false } = {}) {
  if (!tokens || !tokens.length) return true;
  const normalized = normalizeSearch(text);
  if (!wholeWord) {
    return tokens.every(token => normalized.includes(token));
  }
  return tokens.every(token => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(token)}(?![\\p{L}\\p{N}_])`, 'u');
    return re.test(normalized);
  });
}

export function hasCustomCardProps(category, { meta = {}, explanation = '', item = null } = {}) {
  if (category === 'cataclysm') {
    return Boolean(item?.extra && Object.keys(item.extra).length > 0);
  }
  if (hasExplanationField(category) && String(explanation || '').trim() !== '') {
    return true;
  }
  return Object.entries(meta || {}).some(([k, v]) => {
    if (k === 'can_reproduce') return v === false;
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== '';
  });
}

// Катаклізм шукається за назвою й описом (або лише за назвою при namesOnly)
export function cataMatches(c, tokens, { namesOnly = false, wholeWord = false, customOnly = false } = {}) {
  if (customOnly && !hasCustomCardProps('cataclysm', { item: c })) return false;
  if (!tokens || !tokens.length) return Boolean(customOnly);
  const target = namesOnly ? (c.name ?? '') : `${c.name ?? ''} ${c.description ?? ''}`;
  return matchesTokens(target, tokens, { wholeWord });
}

// categories — список { category, label }, у яких шукаємо; texts — { [category]: string }; cataclysms — записи катаклізмів.
// Повертає { results, total }: results обрізано до SEARCH_MAX_RESULTS, total — скільки знайдено насправді.
// Елемент результату: { type: 'cata', category, label, index, item } або { type: 'text', category, label, line, cardIndex, text, detail }.
// line — номер сирого рядка тексту (враховує порожні), cardIndex — номер картки серед непорожніх рядків
// (так само рахує parseLines/parseCards, тому саме cardIndex відповідає рядку візуального списку карток).
export function collectSearchResults({
  categories,
  texts,
  cataclysms,
  tokens,
  viewMode = 'visual',
  namesOnly = false,
  wholeWord = false,
  customOnly = false
}) {
  const results = [];
  let total = 0;
  const hasTokens = Boolean(tokens && tokens.length > 0);
  if (!hasTokens && !customOnly) return { results, total };

  for (const { category, label } of categories) {
    if (category === 'cataclysm') {
      cataclysms.forEach((c, index) => {
        if (!cataMatches(c, tokens, { namesOnly, wholeWord, customOnly })) return;
        total++;
        if (results.length < SEARCH_MAX_RESULTS) results.push({ type: 'cata', category, label, index, item: c });
      });
      continue;
    }
    let cardIndex = 0;
    String(texts[category] || '').split('\n').forEach((line, index) => {
      const rawText = line.trim();
      if (!rawText) return; // порожній рядок карткою не є і номера картки не отримує
      const currentCard = cardIndex++;

      const { value, meta } = parseCardLine(category, rawText);
      let cleanName = value;
      let explanation = '';
      if (hasExplanationField(category)) {
        const parts = splitNameExplanation(value);
        cleanName = parts.name;
        explanation = parts.explanation;
      }
      const detail = hasExplanationField(category) ? explanation : (meta.ability || '');

      if (customOnly && !hasCustomCardProps(category, { meta, explanation })) return;

      const isRawLlm = viewMode === 'llm' && !namesOnly;
      const searchTarget = isRawLlm
        ? rawText
        : (namesOnly ? cleanName : (detail ? `${cleanName} ${detail}` : cleanName));

      if (hasTokens && !matchesTokens(searchTarget, tokens, { wholeWord })) return;

      total++;
      if (results.length < SEARCH_MAX_RESULTS) {
        results.push({
          type: 'text',
          category,
          label,
          line: index,
          cardIndex: currentCard,
          text: isRawLlm ? rawText : cleanName,
          detail: isRawLlm ? '' : detail
        });
      }
    });
  }
  return { results, total };
}
