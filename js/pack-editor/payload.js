import { ALL_PACK_CATEGORIES } from './categories.js';
import {
  parseCards, parseLines, oneLine,
  OBJECT_STAGE_KEYS, parseStageEntry, formatStageEntry
} from './parser.js';
import {
  TITLE_MAX, DESC_MAX, CARD_VALUE_MAX, CARD_META_TEXT_MAX,
  STAGE_NAME_MAX, MAX_PACK_CARDS, CATACLYSM_LIMITS, RANGE_LIMITS
} from './constants.js';

export {
  OBJECT_STAGE_KEYS, parseStageEntry, formatStageEntry,
  TITLE_MAX, DESC_MAX, CARD_VALUE_MAX, CARD_META_TEXT_MAX,
  STAGE_NAME_MAX, MAX_PACK_CARDS, CATACLYSM_LIMITS, RANGE_LIMITS
};

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
    id: row?.id || null,
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

  const row = {
    pool_type: CATACLYSM_CATEGORY?.poolType ?? 'bunker',
    category: 'cataclysm',
    value: String(item.name ?? '').trim(),
    meta
  };
  if (item.id) row.id = item.id;
  return row;
}

// ===== Решта категорій =====
const EDITABLE_META_KEYS = {
  profession: ['ability'],
  body_type: ['has_no_height', 'range', 'exact_height'],
  gender: ['can_reproduce', 'opposite', 'has_no_age', 'custom_age', 'range', 'stages']
};

// Те, що у meta картки не відображається в текстовому рядку редактора (cardToLine цього не записує): наприклад
// stages хвороби. getPack зберігає їх окремо, а buildCardRows повертає їх назад при збереженні —
// інакше "Оновити пак" стирав би їх. Повертає null, якщо додаткових полів немає. Катаклізми сюди не потрапляють (див. вище).
export function extraMetaOf(category, meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const extra = { ...meta };
  for (const key of EDITABLE_META_KEYS[category] || []) {
    delete extra[key];
  }
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
      const cleanVal = String(value ?? '').trim();
      if (!cleanVal) continue;
      rows.push({ pool_type: poolType, category, value: cleanVal, meta });
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
// age_categories — кореневе поле packs.config, але в UI редагується поряд зі стадіями
export const STAGE_KEYS = ['age_categories', 'profession', 'hobby', 'health', 'body_type'];

// Діапазони віку/зросту: підстава для НОВОГО пака, якщо в самому дефолтному паку раптом щось відсутнє (див. rangesFromConfig)
export const RANGE_DEFAULTS = { ageMin: 16, ageMax: 85, heightMin: 150, heightMax: 210, heightMode: 'base' };

const RESERVED_TITLES = ['default', 'дефолт']; // дзеркало перевірки в RPC save_personal_pack

// 3.2: назва не порожня і не дорівнює default / дефолт (без урахування регістру).
// Виняток: базовий пак (редагує лише адмін) зветься саме 'default' — його зарезервовану назву не перевіряємо.
// Повертає текст помилки або '' (все гаразд).
export function validateTitle(title, { isDefaultPack = false } = {}) {
  const clean = String(title ?? '').trim();
  if (!clean) return 'Вкажіть назву пака';
  if (clean.length > TITLE_MAX) return `Назва пака не може перевищувати ${TITLE_MAX} символів`;
  if (isDefaultPack) return '';
  if (RESERVED_TITLES.includes(clean.toLowerCase())) return `Назва "${clean}" зарезервована системою`;
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

export function validateStageEntries(key, entries) {
  if (!OBJECT_STAGE_KEYS.includes(key)) return '';
  if (!Array.isArray(entries) || entries.length === 0) return '';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const name = typeof entry === 'object' ? (entry?.name || '') : String(entry || '');
    if (!name.trim()) {
      return `Стадія #${i + 1} не має назви`;
    }
  }

  if (entries.length <= 1) return '';

  let prevMax = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const entry = entries[i];
    const name = typeof entry === 'object' ? (entry?.name || '') : String(entry || '');
    const upTo = typeof entry === 'object' ? (entry?.up_to_age ?? entry?.up_to_months) : null;
    if (upTo === null || upTo === undefined || upTo <= prevMax) {
      return `У стадії "${name || (i + 1)}" не вказано коректний кінцевий період (має бути більшим за початковий)`;
    }
    prevMax = upTo;
  }
  return '';
}

export function validateStageText(key, text) {
  if (!OBJECT_STAGE_KEYS.includes(key)) return '';
  const lines = parseLines(text);
  if (!lines.length) return '';
  const entries = lines.map(line => parseStageEntry(key, line));
  return validateStageEntries(key, entries);
}

// Стадії з конфігу пака → текст для textarea: { [key]: string }
export function stagesTextFromConfig(config) {
  const text = {};
  for (const key of STAGE_KEYS) {
    const list = key === 'age_categories' ? config?.age_categories : config?.default_stages?.[key];
    text[key] = Array.isArray(list)
      ? list.map(formatStageEntry).filter(Boolean).join('\n')
      : '';
  }
  return text;
}

// Діапазони віку/зросту з конфігу → рядки для number-інпутів. fallback — об'єкт тих самих 4 ключів (числа або рядки —
// байдуже, String() на виході в будь-якому випадку): для базового пака — RANGE_DEFAULTS, для конкретного — діапазони базового.
export function rangesFromConfig(config, fallback) {
  const age = config?.age_range || {};
  const height = config?.height_range || {};

  return {
    ageMin:    String(age.min ?? fallback.ageMin),
    ageMax:    String(age.max ?? fallback.ageMax),
    heightMin: String(height.min ?? fallback.heightMin),
    heightMax: String(height.max ?? fallback.heightMax)
  };
}

// 3.4: фінальний config для збереження. Основа — конфіг дефолтного пака, поверх нього конфіг самого пака,
// а default_stages перекриваються стадіями з форми. Порожнє поле стадій = лишається те, що було (стадії дефолтного пака).
// stages — { [key]: string } (текст textarea), ranges — { ageMin, ageMax, heightMin, heightMax } (рядки).
export function buildPackConfig({ defaultConfig = {}, packConfig = {}, stages = {}, ranges }) {
  const stageLists = {};
  for (const key of STAGE_KEYS) {
    const lines = parseLines(stages[key]);
    if (lines.length) {
      stageLists[key] = lines.map(line => parseStageEntry(key, line));
    }
  }

  const ageCategories = stageLists.age_categories || packConfig.age_categories || defaultConfig.age_categories || null;
  delete stageLists.age_categories;
  
  const finalConfig = {
    ...defaultConfig,
    ...packConfig,
    ...(ageCategories ? { age_categories: ageCategories } : {}),
    age_range: {
      min: parseInt(ranges.ageMin, 10),
      max: parseInt(ranges.ageMax, 10)
    },
    height_range: {
      min: parseInt(ranges.heightMin, 10),
      max: parseInt(ranges.heightMax, 10)
    },
    default_stages: {
      ...(defaultConfig.default_stages || {}),
      ...(packConfig.default_stages || {}),
      ...stageLists
    }
  };

  // Видаляємо помилково додані поля, якщо вони туди потрапили
  delete finalConfig.default_stages?.age_categories;
  delete finalConfig.height_settings;
  delete finalConfig.default_body_types;

  return finalConfig;
}

// Канонічна серіалізація об'єкта/значення з відсортованими ключами для детермінованого порівняння (Minor 4, Minor 5)
function canonicalizeValue(v) {
  if (Array.isArray(v)) return v.map(canonicalizeValue);
  if (v && typeof v === 'object') {
    const sorted = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) sorted[k] = canonicalizeValue(v[k]);
    }
    return sorted;
  }
  return v;
}

export function canonicalCardSnapshot(card) {
  return JSON.stringify({
    pool_type: card?.pool_type || 'character',
    category: card?.category || '',
    value: String(card?.value ?? ''),
    meta: canonicalizeValue(card?.meta || {})
  });
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
    String(c.name ?? '').trim(),
    String(c.description ?? '').trim(),
    c.timer_minutes || 0,
    c.stay_time_months || 0,
    c.population || 0,
    canonicalizeValue(c.extra || {})
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

  // Обов'язкові поля: Час знаходження та Популяція. field — масив, бо підсвічуємо всі порожні разом.
  const missing = [];
  if (String(raw.stay ?? '').trim() === '') missing.push({ field: 'stay', label: 'Час знаходження' });
  if (String(raw.pop ?? '').trim() === '') missing.push({ field: 'pop', label: 'Популяція' });
  if (missing.length > 0) {
    return {
      error: missing.length === 1
        ? `Поле «${missing[0].label}» обов'язкове`
        : `Заповніть обов'язкові поля: ${missing.map(m => m.label).join(', ')}`,
      field: missing.map(m => m.field)
    };
  }

  const nameKey = raw.name.toLowerCase();
  const duplicate = cataclysms.some((c, i) => i !== editIndex && String(c.name).trim().toLowerCase() === nameKey);
  if (duplicate) return { error: 'Катаклізм із такою назвою вже є в цьому паку', field: 'name' };

  const timer = raw.timer === '' ? 0 : Number(raw.timer);
  if (!Number.isInteger(timer) || timer < 0 || timer > timerMax) {
    return { error: `Таймер: ціле число від 0 до ${timerMax} хв (0 — без таймера)`, field: 'timer' };
  }

  const stay = Number(raw.stay);
  if (!Number.isInteger(stay) || stay < 1 || stay > stayMax) {
    return { error: `Час знаходження: ціле число від 1 до ${stayMax} міс.`, field: 'stay' };
  }

  const population = Number(raw.pop);
  if (!Number.isSafeInteger(population) || population < 1) {
    return { error: 'Популяція: ціле число від 1', field: 'pop' };
  }

  return { item: { name: raw.name, description: raw.desc, timer_minutes: timer, stay_time_months: stay, population, extra: {} } };
}

// Імена полів збігаються з параметрами SQL-функції save_personal_pack
export function buildSavePayload({ packId, authorId, title, description, config, cardRows, deleteCardIds = [] }) {
  return {
    p_pack_id: packId,
    p_author_id: authorId,
    p_title: title,
    p_description: description,
    p_config: config,
    p_cards: cardRows,
    p_delete_card_ids: deleteCardIds
  };
}
