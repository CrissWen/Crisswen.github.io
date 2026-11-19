import { ALL_PACK_CATEGORIES } from '../categories.js';
import { cardToLine } from '../parser.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/helpers.js';
import { state } from '../state.js';
import {
  cataDraftPending, resetCataForm, dynDraftPending, resetDynForm, syncCataText,
  getDynamicCards, renderSearch, visibleListIndices, applyDeleteClick,
  toggleSelectVisible, areAllSelected
} from '../controllers/controllers.js';

// Режим масового видалення карток. Стан режиму живе в state; тут — перехід у режим / вихід, вибір і саме видалення.
// ctx потрібен лише для перемальовування (renderList, updateCardsMeta, renderSummary, updateButtons), які лишаються в editor.js.
export function createDeleteMode(ctx) {
  // Рядки списку, які користувач бачить зараз (список катаклізмів може бути відфільтрований пошуком)
  const visibleIndices = () => visibleListIndices($('pe-cata-list'));

  function updateUi() {
    // «Вибрати всі» і підпис кнопки рахуються по видимих рядках, а не по всіх картках категорії
    const visible = visibleIndices();
    ui.setDeleteModeUi({
      isDeleteMode: state.isDeleteMode,
      selectedCount: state.selectedDeleteIndices.size,
      totalCount: visible.length,
      allSelected: areAllSelected(visible)
    });
    const fab = $('pe-fab-back');
    if (fab) fab.hidden = state.isDeleteMode;
  }

  function enter({ initialIndex = null } = {}) {
    if (state.viewMode === 'llm') return false;
    if (state.activeCategory === 'cataclysm') {
      if (cataDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return false;
      }
      resetCataForm();
    } else {
      if (dynDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return false;
      }
      resetDynForm();
    }

    state.isDeleteMode = true;
    state.selectedDeleteIndices.clear();
    state.lastClickedDeleteIndex = null;

    if (initialIndex !== null && !isNaN(initialIndex)) {
      state.selectedDeleteIndices.add(initialIndex);
      state.lastClickedDeleteIndex = initialIndex;
    }

    ctx.renderList();
    renderSearch();
    updateUi();
    return true;
  }

  function exit() {
    state.isDeleteMode = false;
    state.selectedDeleteIndices.clear();
    state.lastClickedDeleteIndex = null;
    ctx.renderList();
    renderSearch();
    updateUi();
  }

  // «Вибрати всі» / «Зняти всі» чіпає лише видимі рядки: при активному фільтрі пошуку приховані картки не потраплять у видалення
  function toggleSelectAll() {
    toggleSelectVisible(visibleIndices());
    ctx.renderList();
    renderSearch();
    updateUi();
  }

  // Клік по рядку списку в режимі видалення: вибір рядка (Shift — діапазон)
  function applyClick(index, { shiftKey = false } = {}) {
    // Діапазон Shift — лише серед видимих рядків (список може бути відфільтрований пошуком)
    applyDeleteClick(index, { shiftKey, visibleIndices: visibleIndices() });
    ctx.renderList();
    renderSearch();
    updateUi();
  }

  async function executeBulk(anchorBtn) {
    const signal = ctx.signal;
    const count = state.selectedDeleteIndices.size;
    if (count === 0 || state.isConfirming) return;

    const categoryLabel = ALL_PACK_CATEGORIES.find(c => c.category === state.activeCategory)?.label || state.activeCategory;
    state.isConfirming = true;
    let confirmed = false;
    try {
      confirmed = await showPackConfirm(
        `Ви дійсно бажаєте видалити обрані записи (${count} шт.) з категорії "${categoryLabel}"?`,
        anchorBtn,
        { confirmLabel: 'Видалити' }
      );
    } finally {
      state.isConfirming = false;
    }
    if (!confirmed || signal?.aborted) return;

    const toDelete = state.selectedDeleteIndices;

    if (state.activeCategory === 'cataclysm') {
      for (let i = 0; i < state.form.cataclysms.length; i++) {
        if (toDelete.has(i) && state.form.cataclysms[i]?.id) {
          state.markCardDeleted(state.form.cataclysms[i].id);
        }
      }
      state.form.cataclysms = state.form.cataclysms.filter((_, i) => !toDelete.has(i));
      syncCataText();
    } else {
      const cards = getDynamicCards();
      for (let i = 0; i < cards.length; i++) {
        if (toDelete.has(i) && cards[i]?.id) {
          state.markCardDeleted(cards[i].id);
        }
      }
      const remainingCards = cards.filter((_, i) => !toDelete.has(i));
      state.cardData[state.activeCategory] = remainingCards;

      // Якщо стать, очищаємо протилежну стать, якщо вона посилалася на видалену картку
      if (state.activeCategory === 'gender') {
        const deletedNames = new Set(cards.filter((_, i) => toDelete.has(i)).map(c => c.value));
        for (const c of remainingCards) {
          if (c.meta?.opposite && deletedNames.has(c.meta.opposite)) {
            delete c.meta.opposite;
          }
        }
      }

      state.form.texts[state.activeCategory] = remainingCards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');
    }

    // Індекси зсунулись: мітка «нова» більше не вказує на ту саму картку
    state.newCataIndex = -1;
    state.newDynIndex = -1;

    exit();
    ctx.updateCardsMeta();
    ctx.renderSummary();
    ctx.updateButtons();
    showGlobalToast(`Видалено записів: ${count}`);
  }

  return { enter, exit, toggleSelectAll, applyClick, executeBulk, updateUi, visibleIndices };
}

// Кнопки режиму масового видалення (сам режим — createDeleteMode)
export function bindDeleteMode(ctx) {
  const { signal, deleteMode } = ctx;

  $('pe-bulk-delete-btn')?.addEventListener('click', () => {
    if (state.viewMode === 'llm') return;
    if (state.isDeleteMode) deleteMode.exit();
    else deleteMode.enter();
  }, { signal });
  $('pe-delete-cancel-btn')?.addEventListener('click', deleteMode.exit, { signal });
  $('pe-hazard-exit-btn')?.addEventListener('click', deleteMode.exit, { signal });
  $('pe-delete-select-all-btn')?.addEventListener('click', deleteMode.toggleSelectAll, { signal });
  $('pe-delete-submit-btn')?.addEventListener('click', e => deleteMode.executeBulk(e.currentTarget), { signal });
}
