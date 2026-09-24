function getAgeCategory(age) {
  const num = Number(age);
  if (isNaN(num)) return "";
  if (num >= 16 && num <= 34) return " (Молодий)";
  if (num >= 35 && num <= 59) return " (Дорослий)";
  if (num >= 60) return " (Похилий)";
  return "";
}

// Текст для порожньої характеристики (за замовчуванням "Пусто")
const EMPTY_TEXT = { professions: "Без професії" };

// Порожньо, якщо: null, [] (або масив лише з маркерів isEmpty), або об'єкт з isEmpty: true
function isEmptyValue(data) {
  if (data === null) return true;
  if (Array.isArray(data)) return data.filter(x => x && !x.isEmpty).length === 0;
  return data.isEmpty === true;
}

// Дістає is_revealed та текст із маркера-заглушки порожнечі (якщо він є — напр. після крадіжки).
// Якщо маркера немає (напр. deleteInventory залишив просто []) — лишаємо стару поведінку: відкрито всім.
function emptyMeta(data, key) {
  const marker = Array.isArray(data) ? data.find(x => x && x.isEmpty) : (data && data.isEmpty ? data : null);
  return {
    revealed: marker ? !!marker.is_revealed : true,
    text: (marker && marker.value) || EMPTY_TEXT[key] || "Пусто"
  };
}

export function mapPlayerState(rawPlayer) {
  const chars = [];
  
  const add = (key, label, formatFunc) => {
    const data = rawPlayer[key];
    if (data === undefined) return; // поле ніколи не генерувалось — колонку не показуємо

    if (isEmptyValue(data)) {
      // Порожня характеристика: видима іншим лише, якщо вона була відкрита до того, як стала порожньою
      // (маркер зберігає wasRevealed з крадіжки); без маркера (просто []) — відкрито всім, як раніше
      const { revealed, text } = emptyMeta(data, key);
      chars.push({ label, value: text, open: revealed, dbKey: key, isEmpty: true });
      return;
    }

    let val, rev;
    
    if (Array.isArray(data)) {
      // Кілька елементів (декілька професій/рюкзаків) — виводимо через кому
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
      value: `${rawPlayer.gender.value}${ageStr}${childStr}`,
      open: rawPlayer.gender.is_revealed,
      dbKey: 'gender'
    });
  }

  add('body', 'Статура', d => `${d.height_cm} см (${d.type})`);
  add('traits', 'Риса характеру', d => d.value);
  add('professions', 'Професія', d => d.stage ? `${d.title} (${d.stage})` : d.title);
  add('health', "Здоров'я", d => (d.disease === "Ідеально здоровий" || !d.severity) ? d.disease : `${d.disease} (${d.severity})`);
  add('hobbies', 'Хобі/Навички', d => `${d.title} (${d.stage})`);
  add('phobias', 'Фобія', d => d.value);
  add('backpack', 'Рюкзак', d => d.item);
  add('large_inventory', 'Крупний інвентар', d => d.item);
  add('extra_info', 'Дод. відомості', d => d.value);

  const abilities = [];
  const sa = rawPlayer.special_abilities || [];
  for (let i = 0; i < 2; i++) {
    const a = sa[i];
    if (a) {
      abilities.push({ label: `Спец можливість №${i+1}`, value: a.text, open: a.is_revealed, dbKey: 'special_abilities', index: i });
    } else {
      abilities.push({ label: `Спец можливість №${i+1}`, value: "Немає", open: false });
    }
  }

  return { name: rawPlayer.name, characteristics: chars, abilities: abilities };
}