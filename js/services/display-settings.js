// Налаштування відображення (поки одне: режим LDM — «полегшений»). Єдине джерело правди для ключа localStorage.
//
// LDM вмикається ЛИШЕ вручну (Профіль → Теми/Вигляд). Автовизначення за FPS, пам'яттю чи системною
// настройкою «зменшити анімацію» немає: за замовчуванням режим завжди вимкнений.
//
// Що робить увімкнений LDM:
//   • вішає клас `ldm` на <html> — css/ldm.css вимикає важкі анімації, розмиття фону та тіньові ефекти;
//   • JS-ефекти (рулетка, шлюз, перехід у бункер, конфеті кубика) переходять на спрощені гілки
//     через isLdmEnabled() / onLdmChange().
//
// ВАЖЛИВО: inline-скрипт у <head> index.html дублює лише КЛЮЧ і клас, щоб застосувати режим ДО першого рендеру
// (без блимання важких ефектів). Якщо міняєте LDM_STORAGE_KEY чи LDM_CLASS — тримайте той скрипт синхронізованим.

export const LDM_STORAGE_KEY = 'bunker-ldm';
export const LDM_CLASS = 'ldm';

const listeners = new Set();

function readStored() {
  try {
    return localStorage.getItem(LDM_STORAGE_KEY) === '1';
  } catch {
    return false; // сховище недоступне (приватний режим, Node у тестах) — LDM вимкнений
  }
}

let enabled = readStored();

function applyClass() {
  try {
    document.documentElement.classList.toggle(LDM_CLASS, enabled);
  } catch { /* немає DOM (тести) — клас просто не ставимо */ }
}

function notify() {
  listeners.forEach(fn => {
    try { fn(enabled); } catch (err) { console.error('LDM listener error:', err); }
  });
}

export function isLdmEnabled() {
  return enabled;
}

export function setLdmEnabled(value, { save = true } = {}) {
  const next = Boolean(value);
  if (save) {
    try {
      localStorage.setItem(LDM_STORAGE_KEY, next ? '1' : '0');
    } catch (err) {
      console.error('Не вдалося зберегти режим LDM:', err);
    }
  }
  if (next === enabled) {
    applyClass(); // клас міг не встигнути виставитися (наприклад, перший виклик)
    return;
  }
  enabled = next;
  applyClass();
  notify();
}

export function onLdmChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let initialized = false;

// Викликається один раз при старті app.js: підтягує збережене значення, ставить клас і слухає інші вкладки.
export function initDisplaySettings() {
  enabled = readStored();
  applyClass();
  if (initialized || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  initialized = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== LDM_STORAGE_KEY && event.key !== null) return;
    setLdmEnabled(readStored(), { save: false });
  });
}
