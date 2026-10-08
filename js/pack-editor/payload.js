import { ALL_PACK_CATEGORIES } from './categories.js';
import { parseCards, parseLines, oneLine } from './parser.js';

// ===== Збирання payload для RPC save_personal_pack / save_default_pack =====
// Чисті функції без DOM і мережі. Розбір тексту редактора на картки — у pack-parser.js.

// Дзеркало c_max_cards у RPC (supabase/migrations/01_personal_packs_stage1.sql)
export const MAX_PACK_CARDS = 2000;

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

// texts: { [category]: string } → масив рядків pack_cards: { pool_type, category, value, meta }
// Текст кожної категорії розбирає parseCards (pack-parser.js: формат "Професія - Можливість", повернення extraMeta).
// Категорія 'cataclysm' у текстах ігнорується: її рядки збираються з окремих записів cataclysms (cataclysmToRow).
export function buildCardRows(texts, extraMeta = {}, cataclysms = []) {
  const rows = [];
  for (const { category, poolType } of ALL_PACK_CATEGORIES) {
    if (category === 'cataclysm') continue;

    for (const { value, meta } of parseCards(texts?.[category], category, extraMeta)) {
      rows.push({ pool_type: poolType, category, value, meta });
    }
  }

  for (const item of cataclysms || []) {
    if (String(item?.name ?? '').trim()) rows.push(cataclysmToRow(item));
  }
  return rows;
}

// ===== Форма редактора: валідація, config, порівняння змін =====
// Чисті функції (без DOM і стану сторінки): контролер pack-editor.js передає їм дані форми й отримує готовий результат.

// Ключі збігаються з packs.config.default_stages, які читає ігровий рушій (підписи для UI — у editor-ui.js)
export const STAGE_KEYS = ['profession', 'hobby', 'health'];

// Діапазони віку/зросту: підстава для НОВОГО пака, якщо в самому дефолтному паку раптом щось відсутнє (див. rangesFromConfig)
export const RANGE_DEFAULTS = { ageMin: 16, ageMax: 85, heightMin: 150, heightMax: 210, heightMode: 'base', defaultBodyTypes: 'Хрупкое\nХудое\nАтлетическое\nКрепкое\nПолное\nОжирение-слабое\nОжирение-сильное' };

const RESERVED_TITLES = ['default', 'дефолт']; // дзеркало перевірки в RPC save_personal_pack

// 3.2: назва не порожня і не дорівнює default / дефолт (без урахування регістру).
// Виняток: базовий пак (редагує лише адмін) зветься саме 'default' — його зарезервовану назву не перевіряємо.
// Повертає текст помилки або '' (все гаразд).
export function validateTitle(title, { isDefaultPack = false } = {}) {
  if (!title) return 'Вкажіть назву пака';
  if (isDefaultPack) return '';
  if (RESERVED_TITLES.includes(title.toLowerCase())) return `Назва "${title}" зарезервована системою`;
  return '';
}

// Числа й min <= max — інакше randInt(min, max) в ігровому рушії (game-generator.js / host/characteristics.js) поверне сміття.
export function validateRanges(r) {
  const ageMin = parseInt(r.ageMin, 10), ageMax = parseInt(r.ageMax, 10);
  const heightMin = parseInt(r.heightMin, 10), heightMax = parseInt(r.heightMax, 10);
  if ([ageMin, ageMax, heightMin, heightMax].some(Number.isNaN)) return 'Заповніть діапазони віку й зросту коректними числами';
  if (ageMin > ageMax) return 'Мін. вік не може перевищувати макс. вік';
  if (heightMin > heightMax) return 'Мін. зріст не може перевищувати макс. зріст';
  return '';
}

// Стадії з конфігу пака (масиви рядків) → текст для textarea: { [key]: string }
export function stagesTextFromConfig(config) {
  const text = {};
  for (const key of STAGE_KEYS) {
    const list = config?.default_stages?.[key];
    text[key] = Array.isArray(list) ? list.filter(s => typeof s === 'string').join('\n') : '';
  }
  return text;
}

// Діапазони віку/зросту з конфігу → рядки для number-інпутів. fallback — об'єкт тих самих 4 ключів (числа або рядки —
// байдуже, String() на виході в будь-якому випадку): для базового пака — RANGE_DEFAULTS, для конкретного — діапазони базового.
export function rangesFromConfig(config, fallback) {
  const age = config?.age_range || {};
  const heightSet = config?.height_settings || {};
  const legacyHeight = config?.height_range || {};
  const heightMin = heightSet.min ?? legacyHeight.min ?? fallback.heightMin;
  const heightMax = heightSet.max ?? legacyHeight.max ?? fallback.heightMax;
  
  const bodyTypes = config?.default_body_types;

  return {
    ageMin:    String(age.min ?? fallback.ageMin),
    ageMax:    String(age.max ?? fallback.ageMax),
    heightMode: String(heightSet.mode ?? fallback.heightMode ?? 'base'),
    heightMin: String(heightMin),
    heightMax: String(heightMax),
    defaultBodyTypes: Array.isArray(bodyTypes) ? bodyTypes.join('\n') : (fallback.defaultBodyTypes || '')
  };
}

// 3.4: фінальний config для збереження. Основа — конфіг дефолтного пака, поверх нього конфіг самого пака,
// а default_stages перекриваються стадіями з форми. Порожнє поле стадій = лишається те, що було (стадії дефолтного пака).
// stages — { [key]: string } (текст textarea), ranges — { ageMin, ageMax, heightMin, heightMax, heightMode, defaultBodyTypes } (рядки).
export function buildPackConfig({ defaultConfig = {}, packConfig = {}, stages = {}, ranges }) {
  const stageLists = {};
  for (const key of STAGE_KEYS) {
    const lines = parseLines(stages[key]);
    if (lines.length) stageLists[key] = lines;
  }
  const bodyTypesLines = parseLines(ranges.defaultBodyTypes || '');
  return {
    ...defaultConfig,
    ...packConfig,
    age_range: {
      min: parseInt(ranges.ageMin, 10),
      max: parseInt(ranges.ageMax, 10)
    },
    height_settings: {
      mode: ranges.heightMode || 'base',
      min: parseInt(ranges.heightMin, 10),
      max: parseInt(ranges.heightMax, 10)
    },
    default_body_types: bodyTypesLines.length > 0 ? bodyTypesLines : (defaultConfig.default_body_types || []),
    default_stages: {
      ...(defaultConfig.default_stages || {}),
      ...(packConfig.default_stages || {}),
      ...stageLists
    }
  };
}

// Нормалізований вигляд форми для порівняння: зайві пробіли та порожні рядки змінами не вважаються
export function normalizeForm(f) {
  const texts = {};
  for (const { category } of ALL_PACK_CATEGORIES) {
    const lines = parseLines(f.texts[category]);
    if (lines.length) texts[category] = lines.join('\n');
  }
  const stages = {};
  for (const key of STAGE_KEYS) stages[key] = parseLines(f.stages[key]).join('\n');
  const cataclysms = (f.cataclysms || []).map(c => [
    String(c.name ?? '').trim(), String(c.description ?? '').trim(), c.timer_minutes || 0, c.stay_time_months || 0, c.population || 0
  ]);
  return JSON.stringify({ title: f.title.trim(), description: f.description.trim(), texts, stages, ranges: f.ranges, cataclysms });
}

// ----- Форма катаклізму (поля читає editor-ui.js: readCataRaw) -----
// Текст списку катаклізмів (назви по одній на рядок): з нього читаються лічильники, підсумок і трекінг змін
export const cataclysmNamesText = cataclysms => (cataclysms || []).map(c => oneLine(c.name)).join('\n');

// Значення полів форми для запису (рядками)
export function cataFieldStrings(item) {
  return {
    name: String(item.name ?? '').trim(),
    desc: String(item.description ?? '').trim(),
    timer: String(item.timer_minutes || 0),
    stay: item.stay_time_months ? String(item.stay_time_months) : '',
    pop: item.population ? String(item.population) : ''
  };
}

// Чи є у формі дані, які ще не потрапили в список: новий катаклізм (isEditing=false) або незбережені правки існуючого (item).
// raw — { name, desc, timer, stay, pop } рядками. Порожній таймер і "0" — одне й те саме (без таймера).
export function hasCataDraft(raw, item, isEditing) {
  if (!isEditing) return Boolean(raw.name || raw.desc || (raw.timer && raw.timer !== '0') || raw.stay || raw.pop);
  if (!item) return false;
  return JSON.stringify({ ...raw, timer: raw.timer || '0' }) !== JSON.stringify(cataFieldStrings(item));
}

// Перевіряє поля форми: повертає { item } або { error, field }.
// cataclysms — поточний список (для пошуку дубліката назви), editIndex — індекс запису, що редагується (-1 — додаємо новий).
export function validateCataclysmInput(raw, { cataclysms = [], editIndex = -1 } = {}) {
  const { timerMax, stayMax } = CATACLYSM_LIMITS;

  if (!raw.name) return { error: 'Вкажіть назву катаклізму', field: 'name' };

  const nameKey = raw.name.toLowerCase();
  const duplicate = cataclysms.some((c, i) => i !== editIndex && String(c.name).trim().toLowerCase() === nameKey);
  if (duplicate) return { error: 'Катаклізм із такою назвою вже є в цьому паку', field: 'name' };

  const timer = raw.timer === '' ? 0 : Number(raw.timer);
  if (!Number.isInteger(timer) || timer < 0 || timer > timerMax) {
    return { error: `Таймер: ціле число від 0 до ${timerMax} хв (0 — без таймера)`, field: 'timer' };
  }

  let stay = null;
  if (raw.stay !== '') {
    stay = Number(raw.stay);
    if (!Number.isInteger(stay) || stay < 1 || stay > stayMax) {
      return { error: `Час перебування: від 1 до ${stayMax} міс. (або залиште поле порожнім)`, field: 'stay' };
    }
  }

  let population = null;
  if (raw.pop !== '') {
    const n = Number(raw.pop);
    if (!Number.isSafeInteger(n)) return { error: 'Популяція: лише цифри', field: 'pop' };
    population = n > 0 ? n : null; // 0 = "невідомо", як і порожнє поле
  }

  return { item: { name: raw.name, description: raw.desc, timer_minutes: timer, stay_time_months: stay, population, extra: {} } };
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
