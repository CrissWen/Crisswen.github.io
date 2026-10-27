/**
 * Реєстр шляхів до графічних іконок проєкту (/icons).
 * Забезпечує єдине джерело правди для всіх іконок та ассетів.
 */

export const ICONS = Object.freeze({
  HAZARD: './icons/Hazard.svg',
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

