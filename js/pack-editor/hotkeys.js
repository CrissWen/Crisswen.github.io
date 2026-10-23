// ===== Гарячі клавіші редактора паків =====
//   Ctrl/Cmd + S                      — миттєве локальне збереження чернетки (без запитів у БД), глушить «Зберегти сторінку як…»
//   Ctrl/Cmd + Shift + S, Ctrl + Enter — збереження в базу (через трирівневий щит у controllers/save.js)
//   Ctrl/Cmd + Z                      — Undo; Ctrl/Cmd + Y або Ctrl/Cmd + Shift + Z — Redo
// Модуль не знає про DOM редактора: усі дії передає editor.js через initHotkeys(...).

let cleanup = null;

const isMac = (() => {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toUpperCase();
  return p.includes('MAC');
})();

// Нативний побуквений undo браузера не чіпаємо, коли користувач друкує в полі
function isEditingText(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// options:
//   isActive()            — чи відкритий редактор (щоб не перехоплювати клавіші на інших сторінках); за замовчуванням true
//   saveDraftLocal()      — миттєвий запис чернетки (повертає true/false)
//   onDraftSaved(ok)      — мікро-тост «💾 Чернетку збережено локально»
//   saveToDatabase()      — запуск збереження в БД
//   undo() / redo()       — виклики історії (editor.js сам перемикає категорію й оновлює інтерфейс)
//   canUndo() / canRedo() — чи є що відкочувати
export function initHotkeys(options = {}) {
  destroyHotkeys();
  const {
    isActive = () => true,
    saveDraftLocal,
    onDraftSaved,
    saveToDatabase,
    undo,
    redo,
    canUndo = () => true,
    canRedo = () => true
  } = options;

  const onKeyDown = e => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;

    // На українській/російській розкладці e.key для S/Z/Y дає 'і'/'я'/'н' (або 'ы'), тож порівняння лише з e.key не спрацьовувало,
    // і браузер відкривав «Зберегти сторінку як…». Тому: якщо e.key — латинська літера (або Enter), довіряємо їй
    // (це правильно й для Dvorak/Colemak: фізична KeyS там дає іншу літеру і НЕ має зберігати); для нелатинських розкладок
    // беремо фізичну клавішу e.code.
    const byCode = { KeyS: 's', KeyZ: 'z', KeyY: 'y', Enter: 'enter', NumpadEnter: 'enter' };
    const rawKey = (e.key || '').toLowerCase();
    const key = /^[a-z]$/.test(rawKey) || rawKey === 'enter' ? rawKey : (byCode[e.code] || rawKey);
    const code = e.code || '';

    const isKeyS = key === 's';
    const isKeyZ = key === 'z';
    const isKeyY = key === 'y';

    // 1. Ctrl/Cmd + S — перехоплюємо ЗАВЖДИ, щоб браузер ніколи не відкривав діалог збереження HTML сторінки
    if (isKeyS && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || !isActive()) return;
      const ok = saveDraftLocal ? saveDraftLocal() : false;
      onDraftSaved?.(ok !== false);
      return;
    }

    // Якщо редактор не активний (наприклад, відкрите модальне вікно підтвердження), решту дій не обробляємо
    if (!isActive()) return;

    // 2. Ctrl/Cmd + Shift + S або Ctrl/Cmd + Enter — збереження в базу
    if ((isKeyS && e.shiftKey) || code === 'Enter' || key === 'enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      saveToDatabase?.();
      return;
    }

    // 3. Undo / Redo
    if (isKeyZ || isKeyY) {
      if (isEditingText(document.activeElement)) return; // працює нативний відкат літер, глобальний стек не чіпаємо
      if (isKeyZ && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (canUndo()) undo?.();
      } else if (isKeyY || (isKeyZ && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (canRedo()) redo?.();
      }
    }
  };

  // Використовуємо capture phase ({ capture: true }), щоб гарантовано перехопити подію ДО стандартної реакції браузера
  window.addEventListener('keydown', onKeyDown, { capture: true });
  cleanup = () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  return destroyHotkeys;
}

export function destroyHotkeys() {
  cleanup?.();
  cleanup = null;
}
