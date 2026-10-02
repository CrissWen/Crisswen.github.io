// ===== Парсинг тексту редактора паків =====
// Чисті функції без DOM і мережі: приймають текст і категорію, повертають дані карток.
// Нічого не знають про HTML, Supabase чи стан сторінки.

// Розділювач — лише розрив рядка (\n); зайві пробіли по краях і порожні рядки відкидаються.
// \r від Windows-перенесень (\r\n) прибирає trim().
export function parseLines(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(line => line !== '');
}

// Рядок без перенесень: назва з бази з \n зламала б співвідношення "рядок списку ↔ запис"
export const oneLine = text => String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();

// Роздільник частин картки професії: тире саме з пробілами навколо (дефіс усередині слова — "IT-спеціаліст" — не чіпаємо)
export const PART_SEPARATOR = ' - ';

// Один рядок тексту → { value, meta }.
// Спеціальний випадок — category === 'profession': рядок формату "Професія - Можливість" розбивається на
// value і meta.ability; їх читають game-generator.js і host/characteristics.js (profItem.meta.ability / card.meta?.ability),
// а player-parser.js показує як іконку-підказку на картці гравця.
// Для решти категорій meta порожня: стадії задаються глобально для пака (packs.config.default_stages), а не для кожної картки.
export function parseCardLine(category, line) {
  let value = line;
  const meta = {};

  if (category === 'profession' && line.includes(PART_SEPARATOR)) {
    const separatorIndex = line.indexOf(PART_SEPARATOR);
    value = line.substring(0, separatorIndex).trim();
    const ability = line.substring(separatorIndex + PART_SEPARATOR.length).trim();
    if (ability) meta.ability = ability;
  }

  return { value, meta };
}

// Текст однієї категорії (по картці на рядок) → [{ value, meta }].
// extraMeta — { [category]: { [value]: meta } } з getPack: поля meta, яких редактор не показує (custom_age статі, stages хвороби...),
// повертаються до картки за ключем category + value. Те, що автор ввів у рядку, має пріоритет;
// якщо картку перейменували, її додаткова meta не підтягується.
export function parseCards(text, category, extraMeta = {}) {
  return parseLines(text).map(line => {
    const { value, meta } = parseCardLine(category, line);
    const extra = extraMeta?.[category]?.[value];
    return { value, meta: extra ? { ...extra, ...meta } : meta };
  });
}

// Зворотне до parseCards: рядок pack_cards → той самий рядок, який вводив автор у редакторі.
// Потрібне, щоб при відкритті пака на редагування можливість професії не губилася
// (раніше з бази читалися лише category і value — повторне збереження стирало б meta).
export function cardToLine(category, value, meta) {
  const text = String(value ?? '');

  if (category === 'profession') {
    const ability = String(meta?.ability ?? '').trim();
    return ability ? `${text}${PART_SEPARATOR}${ability}` : text;
  }

  return text;
}
