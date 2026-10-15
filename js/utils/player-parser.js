import { describeScale } from './experience.js';

function getAgeCategory(age) {
  const num = Number(age);
  if (isNaN(num)) return "";
  if (num >= 16 && num <= 34) return " (Молодий)";
  if (num >= 35 && num <= 59) return " (Дорослий)";
  if (num >= 60) return " (Похилий)";
  return "";
}

const EMPTY_TEXT = { professions: "Без професії" };

function isEmptyValue(data) {
  if (data === null) return true;
  if (Array.isArray(data)) return data.filter(x => x && !x.isEmpty).length === 0;
  return data.isEmpty === true;
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function emptyMeta(data, key) {
  const marker = Array.isArray(data) ? data.find(x => x && x.isEmpty) : (data && data.isEmpty ? data : null);
  return {
    revealed: marker ? !!marker.is_revealed : true,
    text: esc((marker && marker.value) || EMPTY_TEXT[key] || "Пусто")
  };
}

// Статура: "[Статура], [Зріст] см" або просто "[Статура]", якщо зросту немає (null / false / порожньо).
// Нечисловий зріст (напр. "Без зросту" чи текстовий exact_height) виводиться як є, без «см».
function formatBody(d) {
  const type = esc(d.type);
  const h = d.height_cm;
  if (h === null || h === undefined || h === false || String(h).trim() === '') return type;
  const num = Number(h);
  if (Number.isFinite(num)) return `${type}, ${esc(num)} см`;
  return `${type}, ${esc(h)}`;
}

// Рядок шкали для конкретної стадії («Стажер – від 3 місяців до 1 року») зі шкали пака bunker_state.stage_scales.
// Немає шкали (стара кімната, рядкові стадії) або стадії в ній немає → ''.
function stageHint(stageScales, type, stage) {
  if (!stage || !stageScales || !stageScales[type]) return '';
  return describeScale(stageScales[type]).find(line => line.startsWith(`${stage} – `)) || '';
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
    .map(s => `<b>${s.title}</b><br>${esc(esc(s.text))}`)
    .join('<br>');
  return html ? ` <span class="info-icon" data-tooltip="${html}">i</span>` : '';
}

// stageScales (необов'язково) — bunker_state.stage_scales: з ним тултіп професії показує ще й проміжок стадії гравця.
export function mapPlayerState(rawPlayer, stageScales = null) {
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

    if (rawPlayer.age && rawPlayer.age.value !== undefined) {
      const val = rawPlayer.age.value;
      const cat = getAgeCategory(val);
      ageStr = isNaN(Number(val)) ? `, ${val}` : `, ${val} р.${cat}`;
    }

    const childfreeData = rawPlayer.is_childfree || rawPlayer.childfree;
    const childStr = (childfreeData && childfreeData.value) ? " | Чайлдфрі" : "";

    chars.push({
      label: "Стать",
      value: `${esc(rawPlayer.gender.value)}${esc(ageStr)}${esc(childStr)}`,
      open: rawPlayer.gender.is_revealed,
      dbKey: 'gender'
    });
  }

  add('body', 'Статура', formatBody);
  add('traits', 'Риса характеру', d => esc(d.value));

  add('professions', 'Професія', d => {
    const title = esc(d.title || "Невідома професія");
    const stage = esc(d.stage);
    let profText = stage ? `${title} (${stage})` : title;

    // Вміння беремо лише якщо воно є реальним текстом: без meta.ability — лише назва (і стадія), без «undefined» і зайвих знаків.
    const ability = cleanText(d.ability);
    if (ability) {
      profText += infoIcon([
        { title: 'Унікальна здібність:', text: ability },
        { title: 'Стадія:', text: stageHint(stageScales, 'profession', d.stage) }
      ]);
    }

    return profText;
  });
  add('health', "Здоров'я", d => (d.disease === "Ідеально здоровий" || !d.severity) ? esc(d.disease) : `${esc(d.disease)} (${esc(d.severity)})`);
  // Хобі: «Назва (стадія)», без стадії (ручна картка ведучого) — лише назва, без «()».
  // Значок «i» з'являється, лише якщо у meta хобі є опис або здібність; рядок шкали стадії додається під ними.
  add('hobbies', 'Хобі/Навички', d => {
    const title = esc(d.title);
    const stage = esc(d.stage);
    const hobbyText = stage ? `${title} (${stage})` : title;
    const description = cleanText(d.description);
    const ability = cleanText(d.ability);
    if (!description && !ability) return hobbyText;
    return hobbyText + infoIcon([
      { title: 'Опис:', text: description },
      { title: 'Особливість:', text: ability },
      { title: 'Стадія:', text: stageHint(stageScales, 'hobby', d.stage) }
    ]);
  });
  add('phobias', 'Фобія', d => esc(d.value));
  add('large_inventory', 'Крупний інвентар', d => esc(d.item));
  add('backpack', 'Рюкзак', d => esc(d.item));
  add('extra_info', 'Дод. відомості', d => esc(d.value));

  const abilities = [];
  const sa = rawPlayer.special_abilities || [];
  for (let i = 0; i < 2; i++) {
    const a = sa[i];
    if (a) {
      abilities.push({ label: `Спец можливість №${i + 1}`, value: esc(a.text), open: a.is_revealed, dbKey: 'special_abilities', index: i });
    } else {
      abilities.push({ label: `Спец можливість №${i + 1}`, value: "Немає", open: false });
    }
  }

  return { name: rawPlayer.name, characteristics: chars, abilities: abilities };
}