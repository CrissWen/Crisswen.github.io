import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import { setMobileCardView } from '../controllers/mobile-nav.js';
import { $ } from '../ui/shared.js';
import { state } from '../state.js';
import { cataDraftPending, resetCataForm, dynDraftPending, resetDynForm } from '../controllers/controllers.js';

// Мобільна навігація між розділами редактора карток (FAB «назад» і «додати»)
export function bindMobileFab(ctx) {
  const { signal } = ctx;

  $('pe-fab-back')?.addEventListener('click', () => {
    if (state.mobileCardView === 'form') {
      setMobileCardView('list');
    } else {
      setMobileCardView('categories');
    }
  }, { signal });

  // Клік на кнопку "Скасувати" у формі повертає до списку карток на мобільних
  document.addEventListener('click', e => {
    const cancelBtn = e.target.closest('[data-cata-action="cancel"], [data-dyn-action="cancel"]');
    if (cancelBtn) {
      setMobileCardView('list');
    }
  }, { signal });

  $('pe-mobile-add-btn')?.addEventListener('click', () => {
    if (state.activeCategory === 'cataclysm') {
      if (cataDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return;
      }
      resetCataForm();
      setMobileCardView('form');
      $('pe-cata-name')?.focus();
    } else {
      if (dynDraftPending()) {
        showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
        return;
      }
      resetDynForm();
      setMobileCardView('form');
      $('pe-dyn-name')?.focus();
    }
  }, { signal });
}
