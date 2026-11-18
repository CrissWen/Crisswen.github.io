import { STAGE_KEYS } from '../payload.js';

// ===== Спільні константи та DOM-хелпер UI редактора паків =====
// Окремий модуль без залежностей на helpers/dynamic/template: прибирає цикли імпортів (helpers ↔ dynamic, helpers ↔ template).

export const CATACLYSM_LIST_PLACEHOLDER = 'Тут з\'являться додані катаклізми. Заповніть поля нижче й натисніть "Додати". Щоб змінити або видалити катаклізм — натисніть на його назву тут.';

const STAGE_LABELS = { age_categories: 'Вікові категорії', profession: 'Стаж професії', hobby: 'Рівень хобі', health: 'Ступінь хвороби', body_type: 'Типи статури' };
const STAGE_SHORT_LABELS = { age_categories: 'Вік', profession: 'Професія', hobby: 'Хобі', health: 'Хвороба', body_type: 'Статура' };
export const STAGE_FIELDS = STAGE_KEYS.map(key => ({ key, label: STAGE_LABELS[key], shortLabel: STAGE_SHORT_LABELS[key] || STAGE_LABELS[key] }));

export const RANGE_FIELDS = [
  { key: 'ageMin',    label: 'Мін. вік',    min: 1,  max: 120 },
  { key: 'ageMax',    label: 'Макс. вік',   min: 1,  max: 120 },
  { key: 'heightMin', label: 'Мін. зріст',  min: 50, max: 300 },
  { key: 'heightMax', label: 'Макс. зріст', min: 50, max: 300 }
];

export const CATA_FIELDS = { name: 'pe-cata-name', desc: 'pe-cata-desc', timer: 'pe-cata-timer', stay: 'pe-cata-stay', pop: 'pe-cata-pop' };
export const CATA_NUMERIC = ['timer', 'stay', 'pop'];

export const $ = id => document.getElementById(id);
