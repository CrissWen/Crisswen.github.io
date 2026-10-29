/**
 * Реєстр шляхів до графічних іконок проєкту (/icons).
 * Забезпечує єдине джерело правди для всіх іконок та ассетів.
 */

import { CATASTROPHE_ICONS } from './catastrophe-icons.js';

export const ICONS = Object.freeze({
  HAZARD: CATASTROPHE_ICONS.HAZARD.path,
  FAVICON: './icons/favicon.png',

  // Іконки ігрової дошки (/icons/board)
  LOCKED_LOCK: './icons/board/locked-lock.svg',
  UNLOCKED_LOCK: './icons/board/unlocked-lock.svg',
  POPULATION: './icons/board/population.svg',
  EYE: './icons/board/eye.svg',
  ALARM: './icons/board/alarm.svg',
  AREA: './icons/board/area.svg',
  PORK: './icons/board/pork.svg',
  USER: './icons/board/user.svg',

  // Іконки рулетки тесту виживання (/icons/survival)
  SURVIVAL_ALIVE: './icons/survival/heart.svg',
  SURVIVAL_DEAD: './icons/survival/skull.svg',

  // Семантичні аліаси для характеристик бункера
  FOOD: './icons/board/pork.svg',
  BUNKER_SIZE: './icons/board/area.svg',
  STAY_TIME: './icons/board/alarm.svg',
  CAPACITY: './icons/board/user.svg',
});

// Іменовані експорти для зручного прямого імпорту
export const ICON_HAZARD = ICONS.HAZARD;
export const ICON_FAVICON = ICONS.FAVICON;
export const ICON_LOCKED_LOCK = ICONS.LOCKED_LOCK;
export const ICON_UNLOCKED_LOCK = ICONS.UNLOCKED_LOCK;
export const ICON_POPULATION = ICONS.POPULATION;
export const ICON_EYE = ICONS.EYE;
export const ICON_ALARM = ICONS.ALARM;
export const ICON_AREA = ICONS.AREA;
export const ICON_PORK = ICONS.PORK;
export const ICON_USER = ICONS.USER;
export const ICON_FOOD = ICONS.FOOD;
export const ICON_BUNKER_SIZE = ICONS.BUNKER_SIZE;
export const ICON_STAY_TIME = ICONS.STAY_TIME;
export const ICON_CAPACITY = ICONS.CAPACITY;
export const ICON_SURVIVAL_ALIVE = ICONS.SURVIVAL_ALIVE;
export const ICON_SURVIVAL_DEAD = ICONS.SURVIVAL_DEAD;

// Експорт каталогу катаклізмів та катастроф
export {
  CATASTROPHE_CATEGORIES,
  CATASTROPHE_ICONS,
  CATASTROPHE_ICONS_LIST,
  getCatastropheIconsByCategory,
  getCatastropheIconsByFrame,
  isSquareFrameIcon,
  isWideFrameIcon,
  getCatastropheIconById,
  getCatastropheIconByPath,
} from './catastrophe-icons.js';


