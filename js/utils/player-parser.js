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

export function mapPlayerState(rawPlayer) {
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

  add('body', 'Статура', d => `${esc(d.height_cm)} см (${esc(d.type)})`);
  add('traits', 'Риса характеру', d => esc(d.value));

  add('professions', 'Професія', d => {
    const title = esc(d.title || "Невідома професія");
    const stage = esc(d.stage);
    let profText = stage ? `${title} (${stage})` : title;

    if (d.ability && d.ability !== "") {
      const safeAbilityText = esc(d.ability);
      profText += ` <span class="info-icon" data-tooltip="<b>Унікальна здібність:</b><br>${safeAbilityText}">i</span>`;
    }

    return profText;
  });
  add('health', "Здоров'я", d => (d.disease === "Ідеально здоровий" || !d.severity) ? esc(d.disease) : `${esc(d.disease)} (${esc(d.severity)})`);
  add('hobbies', 'Хобі/Навички', d => `${esc(d.title)} (${esc(d.stage)})`);
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