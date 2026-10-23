// ===== Менеджер конфігурації балансу гри =====
// Єдина точка, звідки гра (js/utils/game-generator.js) бере фінальні налаштування балансу.
// Статично імпортує базовий конфіг (завжди є в репозиторії/на проді) і намагається ДИНАМІЧНО
// довантажити локальний (є лише на диску розробника, в .gitignore) — якщо файлу немає,
// помилка import() ловиться і гра просто лишається на базових значеннях.

import { gameConfigBase } from './game-config.base.js';

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

// Рекурсивно зливає властивості override поверх base: вкладені об'єкти мерджаться по полях
// (можна перевизначити лише одне вкладене значення, не повторюючи сусідні), а масиви/примітиви —
// повністю перезаписуються значенням з override.
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    const baseVal = result[key];
    const overrideVal = override[key];
    result[key] = (isPlainObject(baseVal) && isPlainObject(overrideVal))
      ? deepMerge(baseVal, overrideVal)
      : overrideVal;
  }
  return result;
}

let finalConfig = gameConfigBase;

// Намагається довантажити js/config/game-config.local.js. На проді (GitHub Pages) цього файлу
// немає — браузер поверне помилку завантаження модуля (аналог 404), яку ловимо тут і тихо
// лишаємося на базовому конфігу. Жодних необроблених винятків, що зупинили б інші скрипти.
async function loadConfig() {
  try {
    const localModule = await import('./game-config.local.js');
    const localConfig = localModule.gameConfigLocal || localModule.default || {};
    finalConfig = deepMerge(gameConfigBase, localConfig);
    console.info('[config-manager] Застосовано game-config.local.js (локальне перевизначення балансу гри).');
  } catch (err) {
    // Файл відсутній (прод) або в ньому синтаксична помилка — працюємо на базовому конфігу
    finalConfig = gameConfigBase;
  }
  return finalConfig;
}

// Один спільний проміс на всю сесію сторінки: dynamic import() виконується рівно один раз,
// незалежно від того, скільки разів викличуть getGameConfig().
const readyPromise = loadConfig();

// Основний спосіб отримати конфіг: дочікується (першого) злиття і повертає фінальний об'єкт
// (базовий або базовий+локальний, залежно від того, чи знайшовся файл).
export async function getGameConfig() {
  await readyPromise;
  return finalConfig;
}

// Синхронний доступ — ДО завершення dynamic import() поверне лише базовий конфіг (без локальних
// перевизначень). Використовуйте getGameConfig() там, де важливо дочекатися локального файлу.
export function getGameConfigSync() {
  return finalConfig;
}
