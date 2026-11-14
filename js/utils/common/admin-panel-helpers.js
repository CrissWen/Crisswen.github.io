// Чиста логіка адмін-панелі (без DOM-подій і мережі, тому тестується в Node): хоткей, поля вводу,
// групування інструментів, пошук іншої відкритої модалки, обхід фокуса, злиття паралельних запитів.
// Розмітка й поведінка: js/ui/admin-panel.js, дані: js/config/admin-tools-config.js.

// Клавіша ~ за фізичним кодом: працює на будь-якій розкладці (на українській це клавіша з апострофом).
export const TOGGLE_HOTKEY_CODE = 'Backquote';

// Типи <input>, у які не вводять текст: клавіша ~ у них нічого не зіпсує, тож панель може відкритися.
const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image',
]);

// Чи це натискання відкриває/закриває панель: Backquote без Ctrl/Alt/Meta (Shift дозволений),
// без автоповтору (утримання клавіші) і не під час складання символу через IME.
export function isToggleHotkey(e) {
  if (!e || e.code !== TOGGLE_HOTKEY_CODE) return false;
  if (e.repeat) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.isComposing) return false;
  return true;
}

// Чи фокус стоїть там, де гравець друкує текст (нотатки в грі, пошук, форми): тоді клавіша має лишитися символом.
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable === true) return true;
  if (typeof el.getAttribute === 'function') {
    const ce = el.getAttribute('contenteditable');
    if (ce !== null && ce !== undefined && String(ce).toLowerCase() !== 'false') return true;
  }
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(el.type || el.getAttribute?.('type') || 'text').toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

// Групує інструменти за полем group у порядку groups; порожні групи пропускає.
// Інструменти з невідомою групою збираються в fallback-групу в кінці. Записи без id ігноруються.
export function groupTools(tools, groups, fallback = { id: 'other', title: 'Інше' }) {
  const list = Array.isArray(tools) ? tools.filter(t => t && t.id) : [];
  const known = Array.isArray(groups) ? groups.filter(g => g && g.id) : [];
  const knownIds = new Set(known.map(g => g.id));

  const result = known.map(g => ({
    id: g.id,
    title: g.title ?? g.id,
    tools: list.filter(t => t.group === g.id),
  }));

  const orphans = list.filter(t => !knownIds.has(t.group));
  if (orphans.length) result.push({ id: fallback.id, title: fallback.title, tools: orphans });

  return result.filter(g => g.tools.length > 0);
}

// Селектор модалок: власні вікна гри мають aria-modal="true", а нативні <dialog> куратора іконок — атрибут open
// (вони в top layer, тож панель була би під ними незалежно від z-index).
export const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

// Видима модалка поза панеллю (confirm-dialog, pack-notice, airlock, <dialog> тощо; усі вони
// прибираються з DOM або знімають open після закриття). Приховані (hidden / aria-hidden="true") не рахуються.
// Повертає елемент або null. doc — document (або його тестова підміна з querySelectorAll).
export function findBlockingModal(doc, ownId = '') {
  const nodes = doc && typeof doc.querySelectorAll === 'function'
    ? doc.querySelectorAll(MODAL_SELECTOR)
    : [];
  for (const el of nodes) {
    if (ownId && el.id === ownId) continue;
    if (el.hidden) continue;
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-hidden') === 'true') continue;
    return el;
  }
  return null;
}

// Індекс наступного елемента при обході Tab у межах модалки (focus trap): по колу вперед або назад.
// currentIndex = -1, якщо фокус зараз поза списком: вперед тоді дає перший елемент, назад - останній.
export function nextFocusIndex(currentIndex, count, backwards = false) {
  if (!(count > 0)) return -1;
  if (currentIndex < 0 || currentIndex >= count) return backwards ? count - 1 : 0;
  return backwards
    ? (currentIndex - 1 + count) % count
    : (currentIndex + 1) % count;
}

// Обгортка, що зливає паралельні виклики в один: поки перший ще виконується, наступні отримують той самий Promise
// і fn не запускається вдруге. Після завершення (успіху чи помилки) наступний виклик знову запускає fn.
export function createSingleFlight(fn) {
  let pending = null;
  return function singleFlight(...args) {
    if (pending) return pending;
    pending = Promise.resolve()
      .then(() => fn(...args))
      .finally(() => { pending = null; });
    return pending;
  };
}
