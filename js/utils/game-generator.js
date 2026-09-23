
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getRandomItem = (arr) => arr[getRandomInt(0, arr.length - 1)];


const shuffle = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};


const pickStage = (item, defaultStages) => {
  if (item.meta && item.meta.stages && item.meta.stages.length > 0) {
    return getRandomItem(item.meta.stages);
  }
  return getRandomItem(defaultStages)
};

export function generateGameState(playersList, pack, config) {
  
  const b = pack.bunker;
  const capacity = Math.max(1, Math.floor(playersList.length / 2));
  
  const cataclysm = getRandomItem(b.cataclysm);
  
  
  const shuffledItems = shuffle(b.items);
  const bunkerItems = shuffledItems.slice(0, getRandomInt(3, 4)).map(i => i.value);

  const bunkerState = {
    capacity: capacity,
    size: getRandomItem(b.size).value,
    stay_time: getRandomItem(b.stay_time).value,
    food_and_water: getRandomItem(b.food_supply).value,
    location: getRandomItem(b.location).value,
    history: getRandomItem(b.history).value,
    rooms_description: getRandomItem(b.rooms_description).value,
    items: bunkerItems,
    cataclysm: {
      text: cataclysm.value,
      description: cataclysm.meta.description || "",
      timer_minutes: cataclysm.meta.timer_minutes || 0
    }
  };

  
  const c = pack.character;
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
    if (decks[deckName].length > 0) return decks[deckName].pop();
    return getRandomItem(fallbackArray); 
  };

  playersList.forEach(player => {
    
    const genderItem = getRandomItem(c.gender);
    let ageVal = getRandomInt(config.age_range.min, config.age_range.max);
    if (genderItem.meta && genderItem.meta.custom_age) {
      ageVal = genderItem.meta.custom_age; 
    }
    const isChildfree = config.allow_childfree ? (Math.random() > 0.7) : false; 

    
    const bodyItem = getRandomItem(c.body_type);
    const heightVal = getRandomInt(config.height_range.min, config.height_range.max);

    
    const healthItem = getRandomItem(c.health);
    const healthStage = pickStage(healthItem, config.default_stages.health);

    
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
      
      body: { type: bodyItem.value, height_cm: heightVal, is_revealed: false },
      
      professions: [
        { 
          title: profItem.value, 
          ability: profItem.meta.ability || "", 
          stage: pickStage(profItem, config.default_stages.profession),
          is_revealed: false 
        }
      ],
      
      health: [
        { disease: healthItem.value, severity: healthStage, is_revealed: false }
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