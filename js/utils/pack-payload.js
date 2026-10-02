import { ALL_PACK_CATEGORIES } from './pack-categories.js';

// ===== Парсинг масового вводу та збирання payload для RPC save_personal_pack =====
// Чисті функції без DOM і мережі.

// Дзеркало c_max_cards у RPC (supabase/migrations/01_personal_packs_stage1.sql)
export const MAX_PACK_CARDS = 2000;

// Розділювач — лише розрив рядка (\n); зайві пробіли по краях і порожні рядки відкидаються.
// \r від Windows-перенесень (\r\n) прибирає trim().
export function parseLines(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(line => line !== '');
}

// Роздільник частин картки професії: тире саме з пробілами навколо (дефіс усередині слова — "IT-спеціаліст" — не чіпаємо)
const PART_SEPARATOR = ' - ';

// ===== Катаклізми =====
// Катаклізм — не рядок тексту, а окремий запис із власними полями (форма під списком у редакторі).
// Запис у редакторі: { name, description, timer_minutes, stay_time_months, population, extra }
//   timer_minutes     — ціле ≥ 0; 0 означає "без таймера" (гра не показує відлік)
//   stay_time_months  — ціле > 0 або null (null → гра бере стандартні 12 місяців)
//   population        — ціле > 0 або null (null → на дошці "Невідомо")
//   extra             — решта полів meta цієї картки з бази, яких форма не показує: повертаються в картку без змін
// У pack_cards це рядок { pool_type, category: 'cataclysm', value: name, meta: { description, timer_minutes, stay_time_months, population } };
// ті самі ключі читають game-generator.js і host/actions-bunker.js. Порожні поля в meta не пишуться.
export const CATACLYSM_LIMITS = { nameMax: 200, descMax: 1000, timerMax: 180, stayMax: 1200 };

const CATACLYSM_CATEGORY = ALL_PACK_CATEGORIES.find(c => c.category === 'cataclysm');

// Додатне ціле з числа або рядка з пробілами ("50 000"); 0, якщо значення відсутнє чи нерозбірливе
function toPositiveInt(value) {
  const raw = typeof value === 'string' ? value.replace(/[\s\u00a0]/g, '') : value;
  const n = Math.trunc(Number(raw));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

// Рядок pack_cards → запис катаклізму для форми
export function cataclysmFromRow(row) {
  const meta = row?.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  const { description, timer_minutes, stay_time_months, population, ...extra } = meta;

  const populationValue = toPositiveInt(population);
  // Нерозбірливу популяцію (наприклад, текст) не губимо: вона лишається в extra й повернеться як є, доки автор не введе нову
  if (population !== undefined && population !== null && !populationValue) extra.population = population;

  return {
    name: String(row?.value ?? ''),
    description: typeof description === 'string' ? description : '',
    timer_minutes: toPositiveInt(timer_minutes),
    stay_time_months: toPositiveInt(stay_time_months) || null,
    population: populationValue || null,
    extra
  };
}

// Запис катаклізму → рядок pack_cards
export function cataclysmToRow(item) {
  const meta = { ...(item.extra || {}) };
  const description = String(item.description ?? '').trim();
  if (description) meta.description = description;
  if (item.timer_minutes > 0) meta.timer_minutes = item.timer_minutes;
  if (item.stay_time_months > 0) meta.stay_time_months = item.stay_time_months;
  if (item.population > 0) meta.population = item.population;

  return {
    pool_type: CATACLYSM_CATEGORY?.poolType ?? 'bunker',
    category: 'cataclysm',
    value: String(item.name ?? '').trim(),
    meta
  };
}

// ===== Решта категорій =====
// Те, що у meta картки не відображається в текстовому рядку редактора (cardToLine цього не записує): наприклад
// custom_age статі, stages хвороби. getPack зберігає їх окремо, а buildCardRows повертає їх назад при збереженні —
// інакше "Оновити пак" стирав би їх. Повертає null, якщо додаткових полів немає. Катаклізми сюди не потрапляють (див. вище).
export function extraMetaOf(category, meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const extra = { ...meta };
  if (category === 'profession') delete extra.ability;
  return Object.keys(extra).length ? extra : null;
}

// Зворотне до buildCardRows: рядок pack_cards → той самий рядок, який вводив автор у редакторі.
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

// texts: { [category]: string } → масив рядків pack_cards: { pool_type, category, value, meta: {} }
// Спеціальний випадок — category === 'profession': рядок формату "Професія - Можливість" (тире саме з пробілами навколо,
// щоб дефіс усередині слова — наприклад, IT-спеціаліст — не спрацьовував парсер) розбивається на
// value і meta.ability; їх читають game-generator.js і host/characteristics.js (profItem.meta.ability / card.meta?.ability),
// а player-parser.js показує як іконку-підказку на картці гравця.
// Категорія 'cataclysm' у текстах ігнорується: її рядки збираються з окремих записів cataclysms (cataclysmToRow).
// Для решти категорій meta залишається порожньою: стадії задаються глобально для пака (packs.config.default_stages), а не для кожної картки.
// extraMeta — { [category]: { [value]: meta } } з getPack: поля meta, яких редактор не показує, повертаються до картки за ключем category + value
// (те, що автор ввів у рядку, має пріоритет; якщо картку перейменували, її додаткова meta не підтягується).
export function buildCardRows(texts, extraMeta = {}, cataclysms = []) {
  const rows = [];
  for (const { category, poolType } of ALL_PACK_CATEGORIES) {
    if (category === 'cataclysm') continue;

    for (const line of parseLines(texts?.[category])) {
      let value = line;
      let meta = {};

      if (category === 'profession' && line.includes(PART_SEPARATOR)) {
        const separatorIndex = line.indexOf(PART_SEPARATOR);
        value = line.substring(0, separatorIndex).trim();
        const ability = line.substring(separatorIndex + PART_SEPARATOR.length).trim();
        if (ability) meta.ability = ability;
      }

      const extra = extraMeta?.[category]?.[value];
      if (extra) meta = { ...extra, ...meta };

      rows.push({ pool_type: poolType, category, value, meta });
    }
  }

  for (const item of cataclysms || []) {
    if (String(item?.name ?? '').trim()) rows.push(cataclysmToRow(item));
  }
  return rows;
}

// Імена полів збігаються з параметрами SQL-функції save_personal_pack
export function buildSavePayload({ packId, authorId, title, description, config, cardRows }) {
  return {
    p_pack_id: packId,
    p_author_id: authorId,
    p_title: title,
    p_description: description,
    p_config: config,
    p_cards: cardRows
  };
}
