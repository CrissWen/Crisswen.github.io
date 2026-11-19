import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import { setMobileCardView } from '../controllers/mobile-nav.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/shared.js';
import { state } from '../state.js';
import {
  getDynamicCards, dynDraftPending, startDynEdit, cataDraftPending, startCataEdit,
  handleCataClick, handleCataInput, submitCata, handleActionsClick
} from '../controllers/controllers.js';

// Основні поля пака (назва, опис), список карток, форма катаклізму і панель дій (збереження/очищення/вихід)
export function bindFormFields(ctx) {
  const { signal } = ctx;

  function onCataListClick(e) {
    const row = e.target.closest('[data-cata-index]');
    if (!row) return;
    const index = Number(row.dataset.cataIndex);

    if (state.isDeleteMode) {
      ctx.deleteMode.applyClick(index, { shiftKey: e.shiftKey });
      return;
    }

    if (state.activeCategory === 'cataclysm') {
      if (!state.form.cataclysms[index] || index === state.cataEditIndex) return;
      if (cataDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return;
      }
      startCataEdit(index);
      setMobileCardView('form');
    } else {
      const cards = getDynamicCards();
      if (!cards[index] || index === state.dynEditIndex) return;
      if (dynDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return;
      }
      startDynEdit(index, cards[index]);
      setMobileCardView('form');
    }
  }

  $('pe-title').addEventListener('input', e => {
    state.form.title = e.target.value;
    ui.showTitleError('');
    ctx.updateButtons();
  }, { signal });

  $('pe-desc').addEventListener('input', e => {
    state.form.description = e.target.value;
    ui.updateDescCounter();
    ctx.updateButtons();
  }, { signal });

  // Катаклізми: клік по назві у полі-списку відкриває їх у формі, кнопки форми додають/зберігають/видаляють
  $('pe-cata-list').addEventListener('click', onCataListClick, { signal });
  $('pe-cata').addEventListener('click', handleCataClick, { signal });
  $('pe-cata').addEventListener('input', handleCataInput, { signal });
  $('pe-cata').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.id === 'pe-cata-name' && !e.shiftKey))) {
      e.preventDefault();
      submitCata();
    }
  }, { signal });

  $('pe-actions').addEventListener('click', handleActionsClick, { signal });
}
