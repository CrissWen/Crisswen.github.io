function getAgeCategory(age) {
  const num = Number(age);
  if (isNaN(num)) return "";
  if (num >= 16 && num <= 34) return " (Молодий)";
  if (num >= 35 && num <= 59) return " (Дорослий)";
  if (num >= 60) return " (Похилий)";
  return "";
}

export function mapPlayerState(rawPlayer) {
  const chars = [];
  
  const add = (key, label, formatFunc) => {
    if (!rawPlayer[key]) return;
    const data = rawPlayer[key];
    let val, rev;
    
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      val = data.map(formatFunc).join(", "); 
      rev = data[0].is_revealed; 
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
  add('professions', 'Професія', d => `${d.title} (${d.stage})`);
  add('health', "Здоров'я", d => d.disease === "Ідеально здоровий" ? d.disease : `${d.disease} (${d.severity})`);
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