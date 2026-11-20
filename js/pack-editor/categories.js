import { CHARACTERISTIC_TYPES } from '../utils/host/constants.js';

// ===== Категорії карток пака для редактора =====
// category — значення колонки pack_cards.category, poolType — pack_cards.pool_type ('character' | 'bunker').
// Категорії гравця беруться з довідника ведучого (host/constants.js), щоб редактор і гра не розходились.
// Категорії бункера — ті, що гра реально тягне з пулу (utils/game-generator.js: BUNKER_POOL_CATEGORY,
// utils/host/actions-bunker.js: cataclysm, game-config.base.js: items, game-generator.js: food_supply).

const MENU_ORDER = [
  'gender',
  'body_type',
  'trait',
  'profession',
  'health',
  'hobby',
  'phobia',
  'large_inventory',
  'backpack',
  'extra_info',
  'special_ability'
];

export const CHARACTER_CATEGORIES = CHARACTERISTIC_TYPES.map(t => ({
  poolType: 'character',
  category: t.category,
  label: t.label
})).sort((a, b) => {
  const iA = MENU_ORDER.indexOf(a.category);
  const iB = MENU_ORDER.indexOf(b.category);
  return (iA === -1 ? 99 : iA) - (iB === -1 ? 99 : iB);
});

export const BUNKER_CATEGORIES = [
  { poolType: 'bunker', category: 'cataclysm',         label: 'Катаклізм' },
  { poolType: 'bunker', category: 'history',           label: 'Як і де був побудований' },
  { poolType: 'bunker', category: 'rooms_description', label: 'Опис кімнат' },
  { poolType: 'bunker', category: 'location',          label: 'Локація' },
  { poolType: 'bunker', category: 'problems',          label: 'Проблема бункера' },
  { poolType: 'bunker', category: 'items',             label: 'Предмети бункера' },
  { poolType: 'bunker', category: 'food_supply',       label: 'Примітка до запасів їжі/води' }
];

export const ALL_PACK_CATEGORIES = [...CHARACTER_CATEGORIES, ...BUNKER_CATEGORIES];

// Швидкий пошук pool_type за назвою категорії (потрібен при збереженні: category → pool_type)
export const POOL_TYPE_BY_CATEGORY = Object.fromEntries(
  ALL_PACK_CATEGORIES.map(c => [c.category, c.poolType])
);

import { getPromptForCategory } from './prompts/index.js';

export { getPromptForCategory };

// Фабрики схем категорій: усувають дублювання та задають точний короткий підпис головного поля (#pe-dyn-name)
const STAGES_FIELD = { key: 'stages', type: 'list', label: 'Власні стадії (по одній на рядок)' };

const nameSchema = (fields = [], placeholder = 'Введіть назву') => ({
  primary: { type: 'text', label: 'Назва', placeholder },
  fields
});

const stagedNameSchema = (extraFields = [], placeholder = 'Введіть назву') =>
  nameSchema([...extraFields, STAGES_FIELD], placeholder);

const itemSchema = (placeholder = 'Введіть предмет або перелік') => ({
  primary: { type: 'textarea', label: 'Предмет', placeholder },
  fields: []
});

const descSchema = (placeholder = 'Введіть опис', label = 'Опис') => ({
  primary: { type: 'textarea', label, placeholder },
  fields: []
});

// Схеми для динамічних форм (розширений редактор та режим LLM)
export const CATEGORY_SCHEMAS = {
  gender: nameSchema([
    { key: 'can_reproduce', type: 'checkbox', label: 'Здатен до репродукції', default: true },
    { key: 'opposite', type: 'datalist', label: 'Протилежна стать (для обміну)' },
    { key: 'custom_age_mode', type: 'select', label: 'Індивідуальний режим віку', options: [
      { value: '', label: 'За замовчуванням' },
      { value: 'range_and_stages', label: 'Власний діапазон та стадії' },
      { value: 'no_age', label: 'Без віку' }
    ] },
    { key: 'custom_age', type: 'text', label: 'Текст замість віку (напр. "Без віку")' },
    { key: 'age_min', type: 'number', label: 'Мін. вік (роки)', min: 1, max: 120, placeholder: '18', row: 'age' },
    { key: 'age_max', type: 'number', label: 'Макс. вік (роки)', min: 1, max: 120, placeholder: '60', row: 'age' },
    { key: 'stages', type: 'list', label: 'Власні вікові стадії' }
  ]),
  profession: stagedNameSchema([
    { key: 'ability', type: 'text', label: 'Вміння', required: true }
  ]),
  health: stagedNameSchema(),
  hobby: stagedNameSchema(),
  // ТИМЧАСОВО приховано action_type з форми «Нова картка»: функціонал зарезервовано для майбутніх оновлень логіки.
  special_ability: descSchema('Опишіть особливу можливість'),
  body_type: nameSchema([
    { key: 'has_no_height', type: 'checkbox', label: 'Без зросту' },
    { key: 'custom_height_mode', type: 'select', label: 'Індивідуальний режим зросту', options: [
      { value: '', label: 'За замовчуванням (з глобального конфігу)' },
      { value: 'range', label: 'Власний діапазон' },
      { value: 'exact', label: 'Точне значення' }
    ] },
    { key: 'height_min', type: 'number', label: 'Мін. зріст (см)', min: 50, max: 300, placeholder: '150', row: 'height' },
    { key: 'height_max', type: 'number', label: 'Макс. зріст (см)', min: 50, max: 300, placeholder: '210', row: 'height' },
    { key: 'exact_height', type: 'number', label: 'Точний зріст (см)', min: 50, max: 300, placeholder: '170' }
  ]),
  // Фобія: у формі два поля ("Назва" + "Пояснення", обов'язкове), у БД — один рядок "Назва - Пояснення" (зклеює submitDyn через joinNameExplanation)
  phobia: nameSchema([
    { key: 'explanation', type: 'text', label: 'Пояснення', required: true }
  ]),
  trait:             nameSchema(),
  large_inventory:   itemSchema('Опишіть великий інвентар'),
  backpack:          itemSchema('Опишіть вміст рюкзака'),
  extra_info:        descSchema('Введіть факт або відомість', 'Факт'),
  history:           descSchema('Опишіть, як і де був побудований бункер'),
  rooms_description: descSchema('Опишіть кімнати та приміщення бункера'),
  location:          descSchema('Вкажіть місце розташування бункера', 'Місце'),
  problems:          descSchema('Опишіть проблему або несправність бункера'),
  items:             itemSchema('Вкажіть предмети в бункері'),
  food_supply:       descSchema('Вкажіть стан або обсяг запасів', 'Примітка')
};

