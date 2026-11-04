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

  // Іконки аудіосистеми (/icons/audio)
  VOLUME_ON: './icons/audio/volume-on.svg',
  VOLUME_OFF: './icons/audio/volume-off.svg',
  AUDIO_SFX: './icons/audio/sfx.svg',
  AUDIO_UI: './icons/audio/ui.svg',
  AUDIO_MUSIC: './icons/audio/music.svg',
  AUDIO_PLAY: './icons/audio/play.svg',
  AUDIO_STOP: './icons/audio/stop.svg',

  // Іконки футера й кнопки «Нагору» (/icons/footer)
  FOOTER_BUG: './icons/footer/bug.svg',
  FOOTER_IDEA: './icons/footer/idea.svg',
  FOOTER_STAR: './icons/footer/star.svg',
  FOOTER_HEART: './icons/footer/heart.svg',
  FOOTER_HELP: './icons/footer/help.svg',
  FOOTER_ARROW_UP: './icons/footer/arrow-up.svg',

  // Іконки типів змін на сторінці «Що нового» (/icons/changelog)
  CHANGELOG_NEW: './icons/changelog/new.svg',
  CHANGELOG_CHANGE: './icons/changelog/change.svg',
  CHANGELOG_FIX: './icons/changelog/fix.svg',
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

// Іменовані експорти аудіоіконок
export const ICON_VOLUME_ON = ICONS.VOLUME_ON;
export const ICON_VOLUME_OFF = ICONS.VOLUME_OFF;
export const ICON_AUDIO_SFX = ICONS.AUDIO_SFX;
export const ICON_AUDIO_UI = ICONS.AUDIO_UI;
export const ICON_AUDIO_MUSIC = ICONS.AUDIO_MUSIC;
export const ICON_AUDIO_PLAY = ICONS.AUDIO_PLAY;
export const ICON_AUDIO_STOP = ICONS.AUDIO_STOP;

// Іконки футера: ключ = поле icon у FOOTER_COLUMNS (js/config/footer-config.js), плюс arrowUp для кнопки «Нагору»
export const FOOTER_ICONS = Object.freeze({
  bug: ICONS.FOOTER_BUG,
  idea: ICONS.FOOTER_IDEA,
  star: ICONS.FOOTER_STAR,
  heart: ICONS.FOOTER_HEART,
  help: ICONS.FOOTER_HELP,
  arrowUp: ICONS.FOOTER_ARROW_UP,
});

// Іконки типів змін: ключ = type у CHANGELOG (js/config/changelog-config.js) і в CHANGE_TYPES
export const CHANGELOG_ICONS = Object.freeze({
  new: ICONS.CHANGELOG_NEW,
  change: ICONS.CHANGELOG_CHANGE,
  fix: ICONS.CHANGELOG_FIX,
});

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


