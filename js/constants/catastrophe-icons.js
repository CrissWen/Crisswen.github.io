/**
 * Каталог іконок катастроф та катаклізмів (/icons/catastrophe).
 * Містить структурований реєстр усіх доступних векторних SVG-іконок
 * із семантичними категоріями, формою рамки (frame), україномовними мітками та тегами для підбору.
 */

import { CATASTROPHE_CATEGORIES, CATASTROPHE_ICONS } from './catastrophe-icons-data.js';

// Дані винесено в catastrophe-icons-data.js; тут реекспорт, щоб імпортери не змінювались
export { CATASTROPHE_CATEGORIES, CATASTROPHE_ICONS };

/** Масив усіх іконок катастроф для швидкої ітерації */
export const CATASTROPHE_ICONS_LIST = Object.freeze(Object.values(CATASTROPHE_ICONS));

/**
 * Отримати список іконок за категорією
 * @param {keyof typeof CATASTROPHE_CATEGORIES} category
 */
export function getCatastropheIconsByCategory(category) {
  return CATASTROPHE_ICONS_LIST.filter(icon => icon.category === category);
}

/**
 * Отримати список іконок за формою рамки ('square' | 'circle')
 * @param {'square' | 'circle'} frame
 */
export function getCatastropheIconsByFrame(frame) {
  return CATASTROPHE_ICONS_LIST.filter(icon => icon.frame === frame);
}

/**
 * Перевірити, чи іконка розроблена під квадратну рамку
 * @param {string | object} iconOrId
 * @returns {boolean}
 */
export function getCatastropheIconByPath(path) {
  if (!path) return null;
  const norm = String(path).toLowerCase();
  return CATASTROPHE_ICONS_LIST.find(icon => icon.path.toLowerCase() === norm || icon.path.toLowerCase().endsWith(norm)) || null;
}

export function isSquareFrameIcon(iconOrId) {
  if (!iconOrId) return false;
  if (typeof iconOrId === 'object') return iconOrId.frame === 'square';
  const icon = getCatastropheIconById(iconOrId) || getCatastropheIconByPath(iconOrId);
  return icon?.frame === 'square';
}

/**
 * Перевірити, чи іконка має широку горизонтальну форму (wide)
 * @param {string | object} iconOrId
 * @returns {boolean}
 */
export function isWideFrameIcon(iconOrId) {
  if (!iconOrId) return false;
  if (typeof iconOrId === 'object') return iconOrId.frame === 'wide';
  const icon = getCatastropheIconById(iconOrId) || getCatastropheIconByPath(iconOrId);
  return icon?.frame === 'wide';
}

/**
 * Знайти іконку за її id
 * @param {string} id
 */
export function getCatastropheIconById(id) {
  return CATASTROPHE_ICONS[id] || null;
}
