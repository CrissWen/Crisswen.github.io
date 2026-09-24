const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const getSkewedRandomInt = (min, max, skew = 3) => {
  let rand = Math.pow(Math.random(), skew); 
  return Math.floor(rand * (max - min + 1)) + min;
};

const getRandomItem = (arr, fallback = "Немає даних") => {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return { value: fallback, meta: {} }; 
  }
  return arr[getRandomInt(0, arr.length - 1)];
};

const shuffle = (array) => {
  if (!array || !Array.isArray(array)) return [];
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const pickStage = (item, defaultStages) => {
  if (item.meta && item.meta.stages && item.meta.stages.length > 0) {
    return getRandomItem(item.meta.stages, "Невідома стадія");
  }
  return getRandomItem(defaultStages, "Невідома стадія");
};

const formatStayTime = (months) => {
  if (!months || isNaN(months)) return "Невідомий час";
  const y = Math.floor(months / 12);
  const m = months % 12;
  let res = [];
  
  if (y > 0) {
    if (y === 1) res.push("1 рік");
    else if (y >= 2 && y <= 4) res.push(`${y} роки`);
    else res.push(`${y} років`);
  }
  if (m > 0) {
    if (m === 1) res.push("1 місяць");
    else if (m >= 2 && m <= 4) res.push(`${m} місяці`);
    else res.push(`${m} місяців`);
  }
  return res.join(" і ") || "Менше місяця";
};

const calculateFoodMonths = (requiredMonths) => {
  const roll = Math.random();
  let foodMonths = 0;
  
  if (roll < 0.15) { 
    foodMonths = getRandomInt(1, 2);
  } else if (roll < 0.65) { 
    foodMonths = Math.floor(requiredMonths * (getRandomInt(30, 80) / 100));
  } else if (roll < 0.90) { 
    foodMonths = requiredMonths;
  } else { 
    foodMonths = Math.floor(requiredMonths * (getRandomInt(110, 150) / 100));
  }
  
  return Math.max(1, foodMonths);
};

export function generateGameState(playersList, pack, config) {
  const b = pack.bunker || {};
  const capacity = Math.max(1, Math.floor(playersList.length / 2));
  
  const cataclysm = getRandomItem(b.cataclysm, "Невідомий катаклізм");
  const stayTimeMonths = cataclysm.meta?.stay_time_months || 12; 
  const formattedStayTime = formatStayTime(stayTimeMonths);
  
  const foodMonths = calculateFoodMonths(stayTimeMonths);
  let foodAndWater = `${formatStayTime(foodMonths)}`;

  if (b.food_supply && b.food_supply.length > 0 && Math.random() < 0.25) {
  if (b.food_supply && b.food_supply.length > 0 && Math.random() < 0.25) {
    const specialFood = getRandomItem(b.food_supply).value;
    foodAndWater += ` (${specialFood})`;
  }

  
  const bunkerSize = `${getSkewedRandomInt(25, 350, 4)} м²`; 
  
  const shuffledItems = shuffle(b.items);
  const bunkerItems = shuffledItems.slice(0, getRandomInt(1, 5)).map(i => i.value);

  if (Math.random() < 0.65) {
    bunkerProblem = getRandomItem(b.problems, "Відсутня").value;
  }

  const bunkerState = {
    capacity: capacity,
    size: bunkerSize,
    stay_time: formattedStayTime,
    food_and_water: foodAndWater,
    location: getRandomItem(b.location, "Локація невідома").value,
    history: getRandomItem(b.history, "Історія невідома").value,
    rooms_description: getRandomItem(b.rooms_description, "Кімнати невідомі").value,
    problem: getRandomItem(b.problems, "Немає видимих проблем").value, 
    items: bunkerItems,
    cataclysm: {
      text: cataclysm.value,
      description: cataclysm.meta.description || "",
      timer_minutes: cataclysm.meta.timer_minutes || 0
    }
  };

  const c = pack.character || {};
  const playersState = {};

  const decks = {
    professions: shuffle(c.profession),
    hobbies: shuffle(c.hobby),
    phobias: shuffle(c.phobia),
    traits: shuffle(c.trait),
    backpacks: shuffle(c.backpack),
    large_inventory: shuffle(c.large_inventory),
    extra_info: shuffle(c.extra_info),
    abilities: shuffle(c.special_ability)
  };

  const drawCard = (deckName, fallbackArray) => {
    if (decks[deckName] && decks[deckName].length > 0) return decks[deckName].pop();
    return getRandomItem(fallbackArray, "Немає даних"); 
  };

  playersList.forEach(player => {
    const genderItem = getRandomItem(c.gender, "Стать невідома");
    let ageVal = getRandomInt(config.age_range.min, config.age_range.max);
    
    if (genderItem.meta && genderItem.meta.custom_age) {
      ageVal = genderItem.meta.custom_age;
    }
    const isChildfree = config.allow_childfree ? (Math.random() > 0.7) : false;

    
    let bodyTypeVal = "Тілобудова невідома";
    if (c.body_type && c.body_type.length > 0) {
      bodyTypeVal = getRandomItem(c.body_type).value;
    } else if (config.default_stages && config.default_stages.body_type) {
      
      bodyTypeVal = getRandomItem(config.default_stages.body_type);
    }
    
    const heightVal = getRandomInt(config.height_range.min, config.height_range.max);

    let healthDisease = "Хвороба невідома";
    let healthStage = "Невідома стадія";

    if (Math.random() < 0.20) {
      healthDisease = "Ідеально здоровий";
      healthStage = null;
    } else {
      const healthItem = getRandomItem(c.health, "Хвороба невідома");
      healthDisease = healthItem.value;
      healthStage = pickStage(healthItem, config.default_stages.health);
    }

    const profItem = drawCard('professions', c.profession);
    const hobbyItem = drawCard('hobbies', c.hobby);
    
    const ability1 = drawCard('abilities', c.special_ability);
    const ability2 = drawCard('abilities', c.special_ability);

    playersState[player.id] = {
      name: player.name,
      is_alive: true,
      
      gender: { value: genderItem.value, is_revealed: false },
      age: { value: ageVal, is_revealed: false },
      childfree: { value: isChildfree, is_revealed: false },
      
      body: { type: bodyTypeVal, height_cm: heightVal, is_revealed: false },
      
      professions: [
        { 
          title: profItem.value, 
          ability: profItem.meta.ability || "", 
          stage: pickStage(profItem, config.default_stages.profession),
          is_revealed: false 
        }
      ],
      
      health: [
        { disease: healthDisease, severity: healthStage, is_revealed: false }
      ],
      
      hobbies: [
        { title: hobbyItem.value, stage: pickStage(hobbyItem, config.default_stages.hobby), is_revealed: false }
      ],
      
      traits: [
        { value: drawCard('traits', c.trait).value, is_revealed: false }
      ],
      
      phobias: [
        { value: drawCard('phobias', c.phobia).value, is_revealed: false }
      ],
      
      backpack: [
        { item: drawCard('backpacks', c.backpack).value, is_revealed: false }
      ],
      
      large_inventory: [
        { item: drawCard('large_inventory', c.large_inventory).value, is_revealed: false }
      ],
      
      extra_info: [
        { value: drawCard('extra_info', c.extra_info).value, is_revealed: false }
      ],
      
      special_abilities: [
        { text: ability1.value, is_used: false, is_revealed: false },
        { text: ability2.value, is_used: false, is_revealed: false }
      ]
    };
  });

  return { bunkerState, playersState };
  }
}