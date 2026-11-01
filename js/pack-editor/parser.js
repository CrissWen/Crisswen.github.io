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

// Категорії, де картка в БД — один рядок "Назва - Пояснення" (колонка value), а у формі це два окремі поля.
// Дефіс користувач не вводить — його ставить joinNameExplanation. У meta пояснення не потрапляє, лише у зклеєний value.
export const NAME_EXPLANATION_CATEGORIES = ['phobia'];
export const hasExplanationField = category => NAME_EXPLANATION_CATEGORIES.includes(category);

// "Ситофобія" + "страх їжі" → "Ситофобія - страх їжі". Якщо пояснення порожнє — повертаємо лише назву, без зайвого дефіса.
export function joinNameExplanation(name, explanation) {
  const n = String(name ?? '').trim();
  const e = String(explanation ?? '').trim();
  return e ? `${n}${PART_SEPARATOR}${e}` : n;
}

// Зворотне: картка з БД → два поля форми. Ділимо по ПЕРШОМУ " - " (дефіс без пробілів усередині слова не чіпаємо).
export function splitNameExplanation(value) {
  const text = String(value ?? '');
  const match = text.match(/\s+[-—–]\s+/);
  if (!match) return { name: text.trim(), explanation: '' };
  return { name: text.slice(0, match.index).trim(), explanation: text.slice(match.index + match[0].length).trim() };
}

const parseBool = val => val === true || val === 'true';
const parseNullable = val => (val === null || val === 'null' || val === 'none' ? null : val);
const parseNumOrStr = val => {
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
};
const setFiniteNum = (obj, key, val) => {
  const n = Number(val);
  if (Number.isFinite(n)) obj[key] = n;
};
const setFiniteRangeNum = (meta, bound, val) => {
  const n = Number(val);
  if (Number.isFinite(n)) (meta.range ||= {})[bound] = n;
};
const escPropStr = val => String(val ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const OBJECT_STAGE_KEYS = ['age_categories', 'profession', 'hobby', 'gender'];
export const STAGE_SUPPORTING_CATEGORIES = ['age_categories', 'profession', 'hobby', 'gender', 'health', 'body_type'];

const cleanStageName = raw => String(raw ?? '').replace(/:\s*null\s*$/i, '').trim();

// Розбір одного рядка стадії ("Стажер: 12" → { name, up_to_months: 12 } або { name, up_to_age: 18 })
export function parseStageEntry(key, line, { omitNullLimit = false } = {}) {
  if (!OBJECT_STAGE_KEYS.includes(key)) {
    return line;
  }
  const isAge = ['age_categories', 'gender'].includes(key);
  const limitKey = isAge ? 'up_to_age' : 'up_to_months';
  const cleanLine = String(line ?? '').trim();
  const colonIdx = cleanLine.lastIndexOf(':');

  if (colonIdx > 0) {
    const name = cleanStageName(cleanLine.slice(0, colonIdx));
    const valStr = cleanLine.slice(colonIdx + 1).trim();
    if (valStr.toLowerCase() !== 'null') {
      const val = parseInt(valStr, 10);
      if (!isNaN(val)) return { name, [limitKey]: val };
    }
    return (!isAge && omitNullLimit) ? { name } : { name, [limitKey]: null };
  }

  const name = cleanStageName(cleanLine);
  return (!isAge && omitNullLimit) ? { name } : { name, [limitKey]: null };
}

// Форматування об'єкта або рядка стадії назад у текстовий вигляд ("Назва: 12" або "Назва")
export function formatStageEntry(entry) {
  if (typeof entry === 'object' && entry !== null) {
    const cleanName = cleanStageName(entry.name);
    if (!cleanName) return '';
    const limit = entry.up_to_age !== undefined ? entry.up_to_age : entry.up_to_months;
    return (limit !== undefined && limit !== null) ? `${cleanName}: ${limit}` : cleanName;
  }
  return cleanStageName(entry);
}

const PROP_SETTERS = {
  rep: (meta, val) => { meta.can_reproduce = parseBool(val); },
  can_reproduce: (meta, val) => { meta.can_reproduce = parseBool(val); },
  reproduce: (meta, val) => { meta.can_reproduce = parseBool(val); },

  opp: (meta, val) => { meta.opposite = parseNullable(val); },
  opposite: (meta, val) => { meta.opposite = parseNullable(val); },

  age: (meta, val) => { meta.custom_age = val; },
  custom_age: (meta, val) => { meta.custom_age = val; },

  no_age: (meta, val) => { if (parseBool(val)) meta.has_no_age = true; },
  has_no_age: (meta, val) => { if (parseBool(val)) meta.has_no_age = true; },

  age_min: (meta, val) => { setFiniteRangeNum(meta, 'min', val); },
  min_age: (meta, val) => { setFiniteRangeNum(meta, 'min', val); },
  age_max: (meta, val) => { setFiniteRangeNum(meta, 'max', val); },
  max_age: (meta, val) => { setFiniteRangeNum(meta, 'max', val); },

  action_type: (meta, val) => { meta.action_type = val; },

  no_height: (meta, val) => { if (parseBool(val)) meta.has_no_height = true; },
  has_no_height: (meta, val) => { if (parseBool(val)) meta.has_no_height = true; },
  exact_height: (meta, val) => { meta.exact_height = parseNumOrStr(val); },
  height: (meta, val) => { meta.exact_height = parseNumOrStr(val); },
  exact: (meta, val) => { meta.exact_height = parseNumOrStr(val); },
  height_min: (meta, val) => { setFiniteRangeNum(meta, 'min', val); },
  min_height: (meta, val) => { setFiniteRangeNum(meta, 'min', val); },
  height_max: (meta, val) => { setFiniteRangeNum(meta, 'max', val); },
  max_height: (meta, val) => { setFiniteRangeNum(meta, 'max', val); },

  min: (meta, val) => { setFiniteRangeNum(meta, 'min', val); },
  max: (meta, val) => { setFiniteRangeNum(meta, 'max', val); },

  desc: (meta, val) => { meta.description = val; },
  description: (meta, val) => { meta.description = val; },
  explanation: (meta, val) => { meta.description = val; },

  timer: (meta, val) => { setFiniteNum(meta, 'timer_minutes', val); },
  timer_minutes: (meta, val) => { setFiniteNum(meta, 'timer_minutes', val); },

  stay: (meta, val) => { setFiniteNum(meta, 'stay_time_months', val); },
  stay_time: (meta, val) => { setFiniteNum(meta, 'stay_time_months', val); },
  stay_time_months: (meta, val) => { setFiniteNum(meta, 'stay_time_months', val); },

  pop: (meta, val) => { setFiniteNum(meta, 'population', val); },
  population: (meta, val) => { setFiniteNum(meta, 'population', val); },

  ability: (meta, val) => { meta.ability = val; }
};

const PROP_SERIALIZERS = [
  m => m.can_reproduce !== undefined && `rep: ${m.can_reproduce}`,
  m => m.opposite !== undefined && `opp: ${m.opposite === null ? 'null' : `"${escPropStr(m.opposite)}"`}`,
  m => m.has_no_age === true && 'no_age: true',
  m => m.custom_age !== undefined && (!m.has_no_age || m.custom_age !== 'Без віку') && `age: "${escPropStr(m.custom_age)}"`,
  (m, cat) => cat === 'gender' && m.range?.min !== undefined && `age_min: ${m.range.min}`,
  (m, cat) => cat === 'gender' && m.range?.max !== undefined && `age_max: ${m.range.max}`,
  m => m.action_type !== undefined && `action_type: "${escPropStr(m.action_type)}"`,
  m => m.has_no_height === true && 'no_height: true',
  m => m.exact_height !== undefined && m.exact_height !== '' && `exact_height: ${m.exact_height}`,
  (m, cat) => cat !== 'gender' && m.range?.min !== undefined && `min: ${m.range.min}`,
  (m, cat) => cat !== 'gender' && m.range?.max !== undefined && `max: ${m.range.max}`,
  m => m.description !== undefined && `desc: "${escPropStr(m.description)}"`,
  m => m.timer_minutes !== undefined && `timer: ${m.timer_minutes}`,
  m => m.stay_time_months !== undefined && `stay: ${m.stay_time_months}`,
  m => m.population !== undefined && `pop: ${m.population}`
];

export function parsePropsString(propsStr) {
  const regex = /(\w+)\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|«(?:[^»\\]|\\.)*»|“(?:[^”\\]|\\.)*”|[^,}]+)/g;
  let match;
  const props = {};
  while ((match = regex.exec(propsStr)) !== null) {
    const key = match[1];
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")) || (val.startsWith('«') && val.endsWith('»')) || (val.startsWith('“') && val.endsWith('”'))) {
      val = val.slice(1, -1).replace(/\\(["'«»“”\\])/g, '$1');
    }
    if (PROP_SETTERS[key]) {
      PROP_SETTERS[key](props, val);
    } else {
      props[key] = val;
    }
  }
  return props;
}

// Один рядок тексту → { value, meta }.
// Підтримує компактний синтаксис (LLM-режим):
// - Стадії у квадратних дужках: [стадія 1, стадія 2]
// - Прапорці у фігурних дужках: {rep: false, opp: "назва", age: "Без віку", action_type: "change_gender"}
export function parseCardLine(category, line) {
  let value = line;
  const meta = {};
  const canHaveStages = STAGE_SUPPORTING_CATEGORIES.includes(category);

  let extracting = true;
  while (extracting) {
    let matched = false;

    // Шукаємо стадії в кінці рядка (лише для категорій, що підтримують стадії)
    if (canHaveStages) {
      const stagesMatch = value.match(/\[([^\[\]]*?)\]\s*$/);
      if (stagesMatch) {
        const rawStages = stagesMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
        meta.stages = OBJECT_STAGE_KEYS.includes(category)
          ? rawStages.map(s => parseStageEntry(category, s, { omitNullLimit: true }))
          : rawStages;
        value = value.substring(0, stagesMatch.index).trim();
        matched = true;
      }
    }

    // Шукаємо прапорці в кінці рядка: {key: val, ...}
    const propsMatch = value.match(/\{([^{}]*?)\}\s*$/);
    if (propsMatch) {
      const parsed = parsePropsString(propsMatch[1]);
      Object.assign(meta, parsed);
      value = value.substring(0, propsMatch.index).trim();
      matched = true;
    }

    if (!matched) extracting = false;
  }

  // Спеціальний випадок для професій — "Назва - Здібність" (підтримка -, —, –)
  if (category === 'profession') {
    const sepMatch = value.match(/\s+[-—–]\s+/);
    if (sepMatch) {
      const ability = value.substring(sepMatch.index + sepMatch[0].length).trim();
      if (ability) meta.ability = ability;
      value = value.substring(0, sepMatch.index).trim();
    }
  }

  // Для категорій з поясненням (фобія): якщо передано {desc: ...} або {explanation: ...} без дефіса
  if (hasExplanationField(category) && !value.match(/\s+[-—–]\s+/)) {
    const expl = meta.description || meta.explanation || meta.desc;
    if (expl) {
      value = `${value}${PART_SEPARATOR}${expl}`;
      delete meta.description;
      delete meta.explanation;
      delete meta.desc;
    }
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

// Узгодження рядків тексту з наявними картками (збереження UUID карток при редагуванні або зміні порядку)
export function reconcileCards(text, existingCards = [], category, extraMeta = {}, deletedIds = null) {
  const availableByName = new Map();
  for (let i = 0; i < existingCards.length; i++) {
    const c = existingCards[i];
    if (!c) continue;
    const list = availableByName.get(c.value) || [];
    list.push({ card: c, index: i });
    availableByName.set(c.value, list);
  }

  const matchedOldIndices = new Set();
  const matchedOldIds = new Set();
  const parsedLines = parseLines(text).map(line => {
    const { value, meta } = parseCardLine(category, line);
    const extra = extraMeta?.[category]?.[value];
    return { value, meta: extra ? { ...extra, ...meta } : meta };
  });

  // Pass 1: Точний збіг за назвою (value)
  const result = new Array(parsedLines.length).fill(null);
  for (let i = 0; i < parsedLines.length; i++) {
    const { value, meta } = parsedLines[i];
    const candidates = availableByName.get(value);
    if (candidates && candidates.length > 0) {
      // Якщо картка стоїть на тій самій позиції i, надаємо перевагу саме їй
      const sameIdxPos = candidates.findIndex(item => item.index === i);
      const chosen = sameIdxPos >= 0 ? candidates.splice(sameIdxPos, 1)[0] : candidates.shift();
      matchedOldIndices.add(chosen.index);
      if (chosen.card.id) matchedOldIds.add(chosen.card.id);
      result[i] = {
        id: chosen.card.id || crypto.randomUUID(),
        value,
        meta
      };
    }
  }

  // Pass 2: Позиційний збіг (in-place редагування рядка на тій самій позиції i)
  for (let i = 0; i < parsedLines.length; i++) {
    if (result[i]) continue;
    const oldAtPos = existingCards[i];
    if (oldAtPos && !matchedOldIndices.has(i)) {
      matchedOldIndices.add(i);
      if (oldAtPos.id) matchedOldIds.add(oldAtPos.id);
      result[i] = {
        id: oldAtPos.id || crypto.randomUUID(),
        value: parsedLines[i].value,
        meta: parsedLines[i].meta
      };
    } else {
      result[i] = {
        id: crypto.randomUUID(),
        value: parsedLines[i].value,
        meta: parsedLines[i].meta
      };
    }
  }

  if (deletedIds) {
    for (const c of existingCards) {
      if (c?.id && !matchedOldIds.has(c.id)) {
        deletedIds.add(c.id);
      }
    }
  }

  return result;
}

// Зворотне до parseCards: рядок pack_cards → компактний синтаксис (або просто назва).
export function cardToLine(category, value, meta) {
  // Фобія в тексті (включно з режимом LLM) — тільки зклеєний value "Назва - Пояснення", без прапорців {desc: ...} та іншої meta.
  // Картки з бази можуть мати meta.description (повертається через extraMeta), і без цього рядка вона б приклеювалася до тексту.
  // Це лише відображення: при збереженні meta картки в БД повертається з extraMeta, тож дані не втрачаються.
  if (hasExplanationField(category)) return String(value ?? '');

  let text = String(value ?? '');

  if (category === 'profession' && meta?.ability) {
    text = `${text}${PART_SEPARATOR}${String(meta.ability).trim()}`;
  }

  const props = meta ? PROP_SERIALIZERS.map(fn => fn(meta, category)).filter(Boolean) : [];
  if (props.length > 0) {
    text += ` {${props.join(', ')}}`;
  }

  if (Array.isArray(meta?.stages) && meta.stages.length > 0) {
    const formatted = meta.stages.map(formatStageEntry).filter(Boolean);
    if (formatted.length > 0) {
      text += ` [${formatted.join(', ')}]`;
    }
  }

  return text;
}

