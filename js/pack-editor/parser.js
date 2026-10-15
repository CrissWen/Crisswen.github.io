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
  const at = text.indexOf(PART_SEPARATOR);
  if (at < 0) return { name: text.trim(), explanation: '' };
  return { name: text.slice(0, at).trim(), explanation: text.slice(at + PART_SEPARATOR.length).trim() };
}

const parseBool = val => val === true || val === 'true';
const parseNullable = val => (val === null || val === 'null' || val === 'none' ? null : val);
const parseNumOrStr = val => {
  const n = Number(val);
  return Number.isFinite(n) ? n : val;
};

const PROP_SETTERS = {
  rep: (meta, val) => { meta.can_reproduce = parseBool(val); },
  opp: (meta, val) => { meta.opposite = parseNullable(val); },
  age: (meta, val) => { meta.custom_age = val; },
  no_age: (meta, val) => { if (parseBool(val)) meta.has_no_age = true; },
  age_min: (meta, val) => { (meta.range ||= {}).min = Number(val); },
  age_max: (meta, val) => { (meta.range ||= {}).max = Number(val); },
  action_type: (meta, val) => { meta.action_type = val; },
  no_height: (meta, val) => { if (parseBool(val)) meta.has_no_height = true; },
  exact_height: (meta, val) => { meta.exact_height = parseNumOrStr(val); },
  min: (meta, val) => { (meta.range ||= {}).min = Number(val); },
  max: (meta, val) => { (meta.range ||= {}).max = Number(val); },
  desc: (meta, val) => { meta.description = val; },
  timer: (meta, val) => { meta.timer_minutes = Number(val); },
  stay: (meta, val) => { meta.stay_time_months = Number(val); },
  pop: (meta, val) => { meta.population = Number(val); }
};

export function parsePropsString(propsStr) {
  const regex = /(\w+)\s*:\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,}]+)/g;
  let match;
  const props = {};
  while ((match = regex.exec(propsStr)) !== null) {
    const key = match[1];
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    props[key] = val;
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

  let extracting = true;
  while (extracting) {
    let matched = false;

    // Шукаємо стадії в кінці рядка
    const stagesMatch = value.match(/\[(.*?)\]\s*$/);
    if (stagesMatch) {
      const rawStages = stagesMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      if (['profession', 'hobby'].includes(category)) {
        meta.stages = rawStages.map(s => {
          const colonIdx = s.lastIndexOf(':');
          if (colonIdx > 0) {
            const name = s.slice(0, colonIdx).trim();
            const months = parseInt(s.slice(colonIdx + 1).trim(), 10);
            if (!isNaN(months)) return { name, up_to_months: months };
          }
          return { name: s };
        });
      } else if (category === 'gender') {
        meta.stages = rawStages.map(s => {
          const colonIdx = s.lastIndexOf(':');
          if (colonIdx > 0) {
            const name = s.slice(0, colonIdx).trim();
            const age = parseInt(s.slice(colonIdx + 1).trim(), 10);
            if (!isNaN(age)) return { name, up_to_age: age };
          }
          return { name: s, up_to_age: null };
        });
      } else {
        meta.stages = rawStages;
      }
      value = value.substring(0, stagesMatch.index).trim();
      matched = true;
    }
    
    // Шукаємо прапорці в кінці рядка: {key: val, ...}
    const propsMatch = value.match(/\{(.*?)\}\s*$/);
    if (propsMatch) {
      const parsed = parsePropsString(propsMatch[1]);
      for (const [key, val] of Object.entries(parsed)) {
        PROP_SETTERS[key]?.(meta, val);
      }
      value = value.substring(0, propsMatch.index).trim();
      matched = true;
    }
    
    if (!matched) extracting = false;
  }

  // Спеціальний випадок для професій — "Назва - Здібність"
  if (category === 'profession' && value.includes(PART_SEPARATOR)) {
    const separatorIndex = value.indexOf(PART_SEPARATOR);
    const ability = value.substring(separatorIndex + PART_SEPARATOR.length).trim();
    if (ability) meta.ability = ability;
    value = value.substring(0, separatorIndex).trim();
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

  // Додаємо прапорці
  const props = [];
  if (meta?.can_reproduce !== undefined) props.push(`rep: ${meta.can_reproduce}`);
  if (meta?.opposite !== undefined) props.push(`opp: ${meta.opposite === null ? 'null' : `"${meta.opposite}"`}`);
  if (meta?.has_no_age === true) props.push('no_age: true');
  if (meta?.custom_age !== undefined && (!meta.has_no_age || meta.custom_age !== 'Без віку')) props.push(`age: "${meta.custom_age}"`);
  if (category === 'gender') {
    if (meta?.range?.min !== undefined) props.push(`age_min: ${meta.range.min}`);
    if (meta?.range?.max !== undefined) props.push(`age_max: ${meta.range.max}`);
  }
  if (meta?.action_type !== undefined) props.push(`action_type: "${meta.action_type}"`);
  if (meta?.has_no_height === true) props.push('no_height: true');
  if (meta?.exact_height !== undefined && meta?.exact_height !== '') props.push(`exact_height: ${meta.exact_height}`);
  if (category !== 'gender') {
    if (meta?.range?.min !== undefined) props.push(`min: ${meta.range.min}`);
    if (meta?.range?.max !== undefined) props.push(`max: ${meta.range.max}`);
  }
  if (meta?.description !== undefined) props.push(`desc: "${meta.description}"`);
  if (meta?.timer_minutes !== undefined) props.push(`timer: ${meta.timer_minutes}`);
  if (meta?.stay_time_months !== undefined) props.push(`stay: ${meta.stay_time_months}`);
  if (meta?.population !== undefined) props.push(`pop: ${meta.population}`);
  
  if (props.length > 0) {
    text += ` {${props.join(', ')}}`;
  }

  // Додаємо стадії
  if (Array.isArray(meta?.stages) && meta.stages.length > 0) {
    const formatted = meta.stages.map(s => {
      if (typeof s === 'object' && s !== null) {
        const cleanName = String(s.name ?? '').replace(/:\s*null\s*$/i, '').trim();
        const limit = s.up_to_age !== undefined ? s.up_to_age : s.up_to_months;
        return (limit !== undefined && limit !== null) ? `${cleanName}: ${limit}` : cleanName;
      }
      return String(s).replace(/:\s*null\s*$/i, '').trim();
    }).filter(Boolean);
    if (formatted.length > 0) {
      text += ` [${formatted.join(', ')}]`;
    }
  }

  return text;
}
