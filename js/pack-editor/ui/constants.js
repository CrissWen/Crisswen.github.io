import { STAGE_KEYS } from '../payload.js';

// ===== Константи UI редактора паків: підписи, поля форм, плейсхолдери =====
// Лише дані без DOM і без імпортів із helpers/dynamic/template — щоб не створювати цикли.

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

export const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';
export const PROFESSION_PLACEHOLDER = 'Введіть професії стовпчиком (через Enter). Щоб додати професійну можливість, напишіть її через тире з пробілами. Наприклад: Лікар-хірург - Може вилікувати одну хворобу';
