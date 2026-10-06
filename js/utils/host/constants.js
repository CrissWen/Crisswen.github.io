// ===== Довідники характеристик та бункера (спільні для host-panel.js та модулів дій ведучого) =====
// Нижній шар: не імпортує нічого з проєкту, тому на нього безпечно посилаються всі інші модулі host/.

export const CHARACTERISTIC_TYPES = [
  { key: 'professions',       label: 'Професія',            category: 'profession',      isArray: true,  stagesKey: 'profession' },
  { key: 'hobbies',           label: 'Хобі',                 category: 'hobby',           isArray: true,  stagesKey: 'hobby' },
  { key: 'health',            label: "Здоров'я",             category: 'health',          isArray: true,  stagesKey: 'health' },
  { key: 'traits',            label: 'Риса характеру',       category: 'trait',           isArray: true },
  { key: 'phobias',           label: 'Фобія',                category: 'phobia',          isArray: true },
  { key: 'backpack',          label: 'Рюкзак',               category: 'backpack',        isArray: true },
  { key: 'large_inventory',   label: 'Крупний інвентар',     category: 'large_inventory', isArray: true },
  { key: 'extra_info',        label: 'Дод. відомості',       category: 'extra_info',      isArray: true },
  { key: 'special_abilities', label: 'Спец. можливість',     category: 'special_ability', isArray: true,  noExtra: true },
  { key: 'body',              label: 'Статура',              category: 'body_type',       isArray: false },
  { key: 'gender',            label: 'Стать',                category: 'gender',          isArray: false }
];

export const ARRAY_CHARACTERISTIC_TYPES = CHARACTERISTIC_TYPES.filter(c => c.isArray);
// Що можна "додати" гравцю як додаткову картку (спец. можливості не додаємо — UI показує лише 2)
export const EXTRA_CHARACTERISTIC_TYPES = CHARACTERISTIC_TYPES.filter(c => c.isArray && !c.noExtra);

// Швидкий пошук опису характеристики за ключем
export const CHAR_TYPE_MAP = Object.fromEntries(CHARACTERISTIC_TYPES.map(c => [c.key, c]));

// Поля бункера, які ведучий може перевизначити власним текстом
export const BUNKER_FIELDS = [
  { key: 'history',           label: 'Як і де був побудований' },
  { key: 'rooms_description', label: 'Опис кімнат' },
  { key: 'location',          label: 'Локація' },
  { key: 'size',              label: 'Площа' },
  { key: 'stay_time',         label: 'Час перебування' },
  { key: 'food_and_water',    label: 'Запаси їжі/води' },
  { key: 'problem',           label: 'Проблема бункера' },
  { key: 'items',             label: 'Предмети (Що є в бункері)' }
];

// Характеристики, які ведучий може "обнулити" універсальною дією "Видалити характеристику" (actions-players.js → deleteCharacteristic).
// key — поле в players_state; порядок — як у випадаючому списку панелі. Стать і спец. можливості свідомо не входять,
// так само як здоров'я, риса характеру та статура — видаляти їх (лишати гравця без цих карток) не має сенсу.
export const DELETABLE_CHARACTERISTICS = [
  { key: 'professions',     label: 'Професія' },
  { key: 'phobias',         label: 'Фобія / Страх' },
  { key: 'hobbies',         label: 'Хобі / Захоплення' },
  { key: 'extra_info',      label: 'Додаткові відомості' },
  { key: 'backpack',        label: 'Рюкзак' },
  { key: 'large_inventory', label: 'Крупний інвентар' }
];

export const HEAL_PERFECT = 'perfect';

// Значення поля health[0].disease для здорової людини (у неї немає ступеня хвороби)
export const PERFECT_HEALTH_LABEL = 'Ідеально здоровий';

// ===== "Вкрасти характеристику" (actions-steal.js) =====
// Гілка 1: жертва отримує нову випадкову картку, злодій ЗАМІЩУЄ свою вкраденою.
export const STEAL_REPLACE_KEYS = ['gender', 'body', 'traits', 'health', 'phobias'];
// Гілка 2: жертва лишається "Пусто", злодій отримує картку ДОДАТКОВО до своєї.
export const STEAL_APPEND_KEYS = ['professions', 'hobbies', 'large_inventory', 'backpack', 'extra_info'];

// Текст маркера-заглушки для жертви крадіжки (Гілка 2). Для професії — окремий напис.
export const STEAL_EMPTY_TEXT = { professions: 'Без професії' };
