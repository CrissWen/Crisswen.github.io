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
      } else {
        meta.stages = rawStages;
      }
      value = value.substring(0, stagesMatch.index).trim();
      matched = true;
    }
    
    // Шукаємо прапорці в кінці рядка
    const propsMatch = value.match(/\{(.*?)\}\s*$/);
    if (propsMatch) {
      const propsStr = propsMatch[1];
      // Розбиваємо "rep: false, age: Без віку" на частини
      // Щоб не розбити по комі всередині тексту, ми використовуємо простий split і склеюємо назад, 
      // але для LLM-режиму зазвичай коми всередині значень не використовуються.
      // Надійніше розбивати регуляркою, що ігнорує коми в лапках, але для простоти припустимо що коми в значеннях рідкісні.
      const props = propsStr.split(',');
      let currentProp = '';
      
      const processProp = (pStr) => {
        const [k, ...vParts] = pStr.split(':');
        if (!k || !vParts.length) return;
        const key = k.trim();
        let val = vParts.join(':').trim().replace(/^["'](.*)["']$/, '$1'); // видаляємо лапки
        
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (val === 'null' || val === 'none') val = null;

        if (key === 'rep') meta.can_reproduce = val;
        else if (key === 'opp') meta.opposite = val;
        else if (key === 'age') meta.custom_age = val;
        else if (key === 'action_type') meta.action_type = val;
        else if (key === 'no_height') meta.has_no_height = val;
        else if (key === 'exact_height') meta.exact_height = val;
        else if (key === 'height_min') { meta.height_min = Number(val); meta.custom_height_mode = 'range'; }
        else if (key === 'height_max') { meta.height_max = Number(val); meta.custom_height_mode = 'range'; }
        else if (key === 'desc') meta.description = val;
        else if (key === 'timer') meta.timer_minutes = Number(val);
        else if (key === 'stay') meta.stay_time_months = Number(val);
        else if (key === 'pop') meta.population = Number(val);
      };

      for (let i = 0; i < props.length; i++) {
        // Простий евристичний парсер, який склеює значення, якщо в них була кома
        currentProp += (currentProp ? ',' : '') + props[i];
        if ((currentProp.match(/"/g) || []).length % 2 === 0) {
          processProp(currentProp);
          currentProp = '';
        }
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
  if (meta?.custom_age !== undefined) props.push(`age: "${meta.custom_age}"`);
  if (meta?.action_type !== undefined) props.push(`action_type: "${meta.action_type}"`);
  if (meta?.has_no_height !== undefined) props.push(`no_height: ${meta.has_no_height}`);
  if (meta?.exact_height !== undefined) props.push(`exact_height: ${meta.exact_height}`);
  if (meta?.height_min !== undefined) props.push(`height_min: ${meta.height_min}`);
  if (meta?.height_max !== undefined) props.push(`height_max: ${meta.height_max}`);
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
        return (s.up_to_months !== undefined && s.up_to_months !== null) ? `${cleanName}: ${s.up_to_months}` : cleanName;
      }
      return String(s).replace(/:\s*null\s*$/i, '').trim();
    }).filter(Boolean);
    if (formatted.length > 0) {
      text += ` [${formatted.join(', ')}]`;
    }
  }

  return text;
}
