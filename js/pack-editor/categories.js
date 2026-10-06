import { CHARACTERISTIC_TYPES } from '../utils/host/constants.js';

// ===== Категорії карток пака для редактора =====
// category — значення колонки pack_cards.category, poolType — pack_cards.pool_type ('character' | 'bunker').
// Категорії гравця беруться з довідника ведучого (host/constants.js), щоб редактор і гра не розходились.
// Категорії бункера — ті, що гра реально тягне з пулу (utils/game-generator.js: BUNKER_POOL_CATEGORY,
// utils/host/actions-bunker.js: cataclysm, game-config.base.js: items, game-generator.js: food_supply).

export const CHARACTER_CATEGORIES = CHARACTERISTIC_TYPES.map(t => ({
  poolType: 'character',
  category: t.category,
  label: t.label
}));

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

// Схеми для динамічних форм (розширений редактор та режим LLM)
export const CATEGORY_SCHEMAS = {
  gender: {
    fields: [
      { key: 'can_reproduce', type: 'checkbox', label: 'Здатен до репродукції', default: true },
      { key: 'opposite', type: 'datalist', label: 'Протилежна стать (для обміну)' },
      { key: 'custom_age', type: 'text', label: 'Перевизначений вік (напр. "Без віку")' }
    ]
  },
  profession: {
    fields: [
      { key: 'ability', type: 'text', label: 'Унікальне вміння' },
      { key: 'stages', type: 'list', label: 'Власні стадії (по одній на рядок)' }
    ]
  },
  health: {
    fields: [
      { key: 'stages', type: 'list', label: 'Власні стадії (по одній на рядок)' }
    ]
  },
  hobby: {
    fields: [
      { key: 'stages', type: 'list', label: 'Власні стадії (по одній на рядок)' }
    ]
  },
  special_ability: {
    fields: [
      { key: 'action_type', type: 'text', label: 'Системна дія (action_type)' }
    ]
  }
};

