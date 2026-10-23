import { describeScale, getMonthScale } from './experience.js';
import { esc, unescapeApos } from './security.js';

export function getAgeCategory(age, categories) {
  const num = Number(age);
  if (!Number.isFinite(num)) return "";
  if (!Array.isArray(categories) || categories.length === 0) return "";

  for (const cat of categories) {
    if (!cat || typeof cat === 'string') continue;
    const limit = cat.up_to_age !== undefined ? cat.up_to_age : (cat.up_to_months !== undefined ? Math.floor(cat.up_to_months / 12) : cat.limit);
    if (limit === null || limit === undefined) {
      return ` (${cat.name})`;
    }
    const numLimit = Number(limit);
    if (Number.isFinite(numLimit) && num <= numLimit) {
      return ` (${cat.name})`;
    }
  }

  const last = categories[categories.length - 1];
  if (last && typeof last === 'object' && last.name) {
    return ` (${last.name})`;
  }
  return "";
}

const EMPTY_TEXT = { professions: "Без професії" };

function isEmptyValue(data) {
  if (data === null) return true;
  if (Array.isArray(data)) return data.filter(x => x && !x.isEmpty).length === 0;
  return data.isEmpty === true;
}

function safeEsc(str) {
  return esc(unescapeApos(str));
}

function emptyMeta(data, key) {
  const marker = Array.isArray(data) ? data.find(x => x && x.isEmpty) : (data && data.isEmpty ? data : null);
  return {
    revealed: marker ? !!marker.is_revealed : true,
    text: safeEsc((marker && marker.value) || EMPTY_TEXT[key] || "Пусто")
  };
}

// Статура: "[Статура], [Зріст] см" або просто "[Статура]", якщо зросту немає (null / false / порожньо).
// Нечисловий зріст (напр. "Без зросту" чи текстовий exact_height) виводиться як є, без «см».
function formatBody(d) {
  const type = safeEsc(d.type);
  const h = d.height_cm;
  if (h === null || h === undefined || h === false || String(h).trim() === '') return type;
  const num = Number(h);
  if (Number.isFinite(num)) return `${type}, ${safeEsc(num)} см`;
  return `${type}, ${safeEsc(h)}`;
}

// Рядок шкали для конкретної стадії («Стажер – від 3 місяців до 1 року») ЛИШЕ якщо картка має власну кастомну шкалу стадій.
// Стандартні стадії з дефолт-пулу підказку в тултіпі не показують.
function customStageHint(card) {
  if (!card?.stage) return '';
  const scale = card.custom_scale || (Array.isArray(card.stages) ? getMonthScale(card.stages) : null);
  if (!scale || !scale.length) return '';
  return describeScale(scale).find(line => line === card.stage || line.startsWith(`${card.stage} – `)) || '';
}

// Текст з meta картки: лише реальний рядок (без «undefined»/«null» і пробілів по краях), інакше ''
function cleanText(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s === 'undefined' || s === 'null') ? '' : s;
}

// Значок «i» з підказкою з кількох блоків [{ title, text }]; порожні блоки пропускаються, без блоків — ''.
// esc двічі: один раз для атрибута, другий — щоб текст (напр. «<») не вийшов за HTML у тултіпі (renderSafeTooltip).
function infoIcon(sections) {
  const html = sections
    .filter(s => s.text)
    .map(s => `<b>${s.title}</b><br>${safeEsc(safeEsc(s.text))}`)
    .join('<br>');
  return html ? ` <span class="info-icon" data-tooltip="${html}">i</span>` : '';
}

// stageScales (необов'язково) — bunker_state.stage_scales: з ним тултіп професії показує ще й проміжок стадії гравця.
// ageCategories (необов'язково) — bunker_state.age_categories: шкала вікових категорій для відображення в тексті статі.
export function mapPlayerState(rawPlayer, stageScales = null, ageCategories = null) {
  const chars = [];

  const add = (key, label, formatFunc) => {
    const data = rawPlayer[key];
    if (data === undefined) return;

    if (isEmptyValue(data)) {
      const { revealed, text } = emptyMeta(data, key);
      chars.push({ label, value: text, open: revealed, dbKey: key, isEmpty: true });
      return;
    }

    let val, rev;

    if (Array.isArray(data)) {
      const items = data.filter(x => x && !x.isEmpty);
      val = items.map(formatFunc).join(", ");
      rev = items[0].is_revealed;
    } else {
      val = formatFunc(data);
      rev = data.is_revealed;
    }
    chars.push({ label, value: val, open: rev, dbKey: key });
  };

  if (rawPlayer.gender) {
    let ageStr = "";

    const cardCategories = rawPlayer.gender.custom_stages || rawPlayer.gender.stages || rawPlayer.gender.custom_scale;
    const effectiveCategories = (Array.isArray(cardCategories) && cardCategories.length > 0)
      ? cardCategories
      : (Array.isArray(ageCategories) ? ageCategories : null);

    if (rawPlayer.age && rawPlayer.age.value !== undefined && rawPlayer.age.value !== null && String(rawPlayer.age.value).trim() !== '') {
      const val = rawPlayer.age.value;
      const num = Number(val);
      if (Number.isFinite(num)) {
        const cat = getAgeCategory(num, effectiveCategories);
        ageStr = `, ${num} р.${cat}`;
      } else {
        ageStr = `, ${val}`;
      }
    } else if (rawPlayer.gender.has_no_age) {
      ageStr = `, Без віку`;
    }

    const childfreeData = rawPlayer.is_childfree || rawPlayer.childfree;
    const childStr = (childfreeData && childfreeData.value) ? " | Чайлдфрі" : "";

    chars.push({
      label: "Стать",
      value: `${safeEsc(rawPlayer.gender.value)}${safeEsc(ageStr)}${safeEsc(childStr)}`,
      open: rawPlayer.gender.is_revealed,
      dbKey: 'gender'
    });
  }

  add('body', 'Статура', formatBody);
  add('traits', 'Риса характеру', d => safeEsc(d.value));

  add('professions', 'Професія', d => {
    const title = safeEsc(d.title || "Невідома професія");
    const stage = safeEsc(d.stage);
    let profText = stage ? `${title} (${stage})` : title;

    const ability = cleanText(d.ability);
    const stageText = customStageHint(d);
    if (ability || stageText) {
      const sections = [];
      if (ability) sections.push({ title: 'Унікальна здібність:', text: ability });
      if (stageText) sections.push({ title: 'Стадія:', text: stageText });
      profText += infoIcon(sections);
    }

    return profText;
  });
  add('health', "Здоров'я", d => (d.disease === "Ідеально здоровий" || !d.severity) ? safeEsc(d.disease) : `${safeEsc(d.disease)} (${safeEsc(d.severity)})`);
  // Хобі: «Назва (стадія)», без стадії (ручна картка ведучого) — лише назва, без «()».
  // Значок «i» показується, якщо у meta хобі є опис, здібність або власна кастомна шкала стадій.
  add('hobbies', 'Хобі/Навички', d => {
    const title = safeEsc(d.title);
    const stage = safeEsc(d.stage);
    const hobbyText = stage ? `${title} (${stage})` : title;
    const description = cleanText(d.description);
    const ability = cleanText(d.ability);
    const stageText = customStageHint(d);
    if (!description && !ability && !stageText) return hobbyText;
    const sections = [];
    if (description) sections.push({ title: 'Опис:', text: description });
    if (ability) sections.push({ title: 'Особливість:', text: ability });
    if (stageText) sections.push({ title: 'Стадія:', text: stageText });
    return hobbyText + infoIcon(sections);
  });
  add('phobias', 'Фобія', d => safeEsc(d.value));
  add('large_inventory', 'Крупний інвентар', d => safeEsc(d.item));
  add('backpack', 'Рюкзак', d => safeEsc(d.item));
  add('extra_info', 'Дод. відомості', d => safeEsc(d.value));

  const abilities = [];
  const sa = rawPlayer.special_abilities || [];
  for (let i = 0; i < 2; i++) {
    const a = sa[i];
    if (a) {
      abilities.push({ label: `Спец можливість №${i + 1}`, value: safeEsc(a.text), open: a.is_revealed, dbKey: 'special_abilities', index: i });
    } else {
      abilities.push({ label: `Спец можливість №${i + 1}`, value: "Немає", open: false });
    }
  }

  return { name: rawPlayer.name, characteristics: chars, abilities: abilities };
}
