import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import { $ } from '../ui/shared.js';
import { updateSortBtnUi } from '../ui/ui.js';
import { state } from '../state.js';
import { renderSearch } from '../controllers/controllers.js';

// Кнопка та меню сортування карток
export function bindSortMenu(ctx) {
  const { signal } = ctx;
  const sortBtn = $('pe-sort-btn');
  const sortMenu = $('pe-sort-menu');

  function applyCardSort(dir = 'none') {
    state.cardsSortDir = dir;
    updateSortBtnUi(state.cardsSortDir);
    ctx.renderList();
    renderSearch();
    if (dir === 'asc') showGlobalToast('Сортувати в порядку Від "А" до "Я"');
    else if (dir === 'desc') showGlobalToast('Сортувати в порядку Від "Я" до "А"');
    else showGlobalToast('Початковий порядок');
  }

  const closeSortMenu = () => {
    if (sortMenu && !sortMenu.hidden) {
      sortMenu.hidden = true;
      sortBtn?.setAttribute('aria-expanded', 'false');
    }
  };

  sortBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (state.viewMode === 'llm' || state.isDeleteMode) return;
    const willOpen = sortMenu.hidden;
    sortMenu.hidden = !willOpen;
    sortBtn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      sortMenu.querySelector('.pe-sort-menu__item')?.focus();
    }
  }, { signal });

  sortBtn?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (sortMenu?.hidden) {
        e.preventDefault();
        sortMenu.hidden = false;
        sortBtn.setAttribute('aria-expanded', 'true');
        sortMenu.querySelector('.pe-sort-menu__item')?.focus();
      }
    }
  }, { signal });

  sortMenu?.addEventListener('click', e => {
    const item = e.target.closest('[data-sort-dir]');
    if (!item) return;
    const dir = item.dataset.sortDir || 'none';
    closeSortMenu();
    applyCardSort(dir);
    sortBtn?.focus();
  }, { signal });

  sortMenu?.addEventListener('keydown', e => {
    const items = [...sortMenu.querySelectorAll('.pe-sort-menu__item')];
    const currentIndex = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(currentIndex + 1) % items.length];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSortMenu();
      sortBtn?.focus();
    }
  }, { signal });

  document.addEventListener('click', e => {
    if (!e.target.closest('#pe-sort-wrap')) {
      closeSortMenu();
    }
  }, { signal });
}
