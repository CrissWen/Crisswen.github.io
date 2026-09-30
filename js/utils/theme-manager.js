// Керування вибором візуальної теми (Theme Switcher). Єдине джерело правди для ключа localStorage
// і списку доступних тем.
//
// ВАЖЛИВО: маленький inline-скрипт у <head> index.html (одразу під <link id="theme-stylesheet">)
// дублює лише сам КЛЮЧ localStorage і шаблон шляху до файлу теми, щоб застосувати збережену тему
// синхронно ДО завантаження цього ES-модуля — інакше при кожному перезавантаженні сторінки на частку
// секунди блимала б дефолтна тема "Сталкер", перш ніж JS встигав би її підмінити. Якщо міняєте
// THEME_STORAGE_KEY або шаблон шляху нижче — тримайте той inline-скрипт синхронізованим.

export const THEME_STORAGE_KEY = 'bunker-theme';
export const DEFAULT_THEME = 'stalker';

export const THEMES = [
  { value: 'stalker',   label: 'Сталкер (Гримдарк)' },
  { value: 'fallout',   label: 'Fallout (Термінал)' },
  { value: 'cyberpunk', label: 'Cyberpunk (Нео-Нуар)' }
];

const VALID_THEME_VALUES = new Set(THEMES.map(t => t.value));

function themeHref(themeName) {
  return `css/themes/theme-${themeName}.css`;
}

// Повертає збережений вибір гравця або тему за замовчуванням, якщо нічого не збережено
// (або localStorage недоступний — приватний режим, заборона в налаштуваннях браузера тощо).
export function getCurrentTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEME_VALUES.has(stored) ? stored : DEFAULT_THEME;
  } catch (err) {
    return DEFAULT_THEME;
  }
}

// Перемикає <link id="theme-stylesheet"> на файл обраної теми і запам'ятовує вибір у localStorage,
// щоб він не скидався після оновлення сторінки.
let pendingLink = null; // тема, що ще вантажиться (на випадок швидкого подвійного перемикання)

export function setTheme(themeName) {
  if (!VALID_THEME_VALUES.has(themeName)) return;

  if (pendingLink) { pendingLink.remove(); pendingLink = null; } // скасовуємо попереднє незавершене перемикання

  const oldLink = document.getElementById('theme-stylesheet');
  if (oldLink) {
    const href = themeHref(themeName);
    if (oldLink.getAttribute('href') !== href) {
      // Не міняємо href на місці: поки нова таблиця вантажиться, браузер уже прибрав би стару, і сторінка
      // на мить лишилась би без змінних палітри (блимання). Тому вантажимо нову тему ОКРЕМИМ <link>
      // і прибираємо стару лише після події load.
      const newLink = document.createElement('link');
      newLink.rel = 'stylesheet';
      newLink.href = href;
      newLink.addEventListener('load', () => {
        oldLink.remove();
        newLink.id = 'theme-stylesheet';
        pendingLink = null;
      }, { once: true });
      newLink.addEventListener('error', () => {
        newLink.remove(); // файл теми не завантажився — лишаємо поточну тему, а не ламаємо сторінку
        pendingLink = null;
        console.error('Не вдалося завантажити тему:', href);
      }, { once: true });
      pendingLink = newLink;
      oldLink.after(newLink);
    }
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeName);
  } catch (err) {
    console.error('Не вдалося зберегти вибір теми:', err);
  }
}

// Застосовує вже збережену (або дефолтну) тему до <link id="theme-stylesheet">. Викликається один раз
// при старті app.js. Не дублює роботу inline-скрипта в <head> (той лише запобігає першому миготінню) —
// це підстраховка на випадок, якщо inline-скрипт колись прибрати або якщо він не встиг відпрацювати.
export function applyStoredTheme() {
  const link = document.getElementById('theme-stylesheet');
  if (link) link.href = themeHref(getCurrentTheme());
}
