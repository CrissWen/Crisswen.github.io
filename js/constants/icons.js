/**
 * Реєстр шляхів до графічних іконок проєкту (/icons).
 * Забезпечує єдине джерело правди для всіх іконок та ассетів.
 */

import { CATASTROPHE_ICONS } from './catastrophe-icons.js';

export const ICONS = Object.freeze({
  HAZARD: CATASTROPHE_ICONS.HAZARD.path,
  LOCKED_LOCK: './icons/Locked-lock.svg',
  UNLOCKED_LOCK: './icons/Unlocked-lock.svg',
  POPULATION: './icons/Population.svg',
  EYE: './icons/eye.svg',
  FAVICON: './icons/favicon.png',
});

// Іменовані експорти для зручного прямого імпорту
export const ICON_HAZARD = ICONS.HAZARD;
export const ICON_LOCKED_LOCK = ICONS.LOCKED_LOCK;
export const ICON_UNLOCKED_LOCK = ICONS.UNLOCKED_LOCK;
export const ICON_POPULATION = ICONS.POPULATION;
export const ICON_EYE = ICONS.EYE;
export const ICON_FAVICON = ICONS.FAVICON;

// Експорт каталогу катаклізмів та катастроф
export {
  CATASTROPHE_CATEGORIES,
  CATASTROPHE_ICONS,
  CATASTROPHE_ICONS_LIST,
  getCatastropheIconsByCategory,
  getCatastropheIconsByFrame,
  isSquareFrameIcon,
  getCatastropheIconById,
  getCatastropheIconByPath,
} from './catastrophe-icons.js';


