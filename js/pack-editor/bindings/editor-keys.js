import { state } from '../state.js';

// Гарячі клавіші редактора: Esc / X — режим масового видалення, Ctrl+Shift+1-4 — перехід між зонами сторінки.
// (Ctrl+Z / Ctrl+Y / Ctrl+S живуть окремо — js/pack-editor/hotkeys.js.)
export function bindEditorKeys(ctx) {
  const { signal, deleteMode } = ctx;

  function onEditorKeydown(e) {
    if (e.key === 'Escape' && state.isDeleteMode) {
      e.preventDefault();
      deleteMode.exit();
      return;
    }

    // Перемикання режиму вибору клавішею X (працює поза текстовими полями введення)
    if ((e.code === 'KeyX' || e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'х') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      if (state.viewMode === 'llm' || state.isConfirming) return;

      e.preventDefault();
      if (state.isDeleteMode) deleteMode.exit();
      else deleteMode.enter();
      return;
    }

    if (e.ctrlKey && e.shiftKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();

      const ZONES = [
        () => document.querySelector('.pe-char-menu-item.is-active') || document.querySelector('.pe-char-menu-item'),
        () => document.getElementById('pe-search'),
        () => {
          const list = document.getElementById('pe-cata-list');
          if (list && !list.hidden) {
            return list.querySelector('.is-selected') || list.querySelector('[data-cata-index]');
          }
          const cards = document.getElementById('pe-cards');
          return (cards && !cards.hidden) ? cards : null;
        },
        () => {
          const dynForm = document.getElementById('pe-dynamic-form');
          if (dynForm && !dynForm.hidden) return document.getElementById('pe-dyn-name');
          const cataForm = document.getElementById('pe-cata');
          if (cataForm && !cataForm.hidden) return document.getElementById('pe-cata-name');
          return null;
        }
      ];

      const idx = Number(e.key) - 1;
      const el = ZONES[idx]();
      if (el) {
        el.focus({ preventScroll: true });
      }
    }
  }

  document.addEventListener('keydown', onEditorKeydown, { signal });
}
