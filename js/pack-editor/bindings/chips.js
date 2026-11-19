import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import { setMobileCardView } from '../controllers/mobile-nav.js';
import { $ } from '../ui/helpers.js';
import { state } from '../state.js';

// Чіпи категорій і жовті попередження «мало карток».
export function bindChips(ctx) {
  const { signal } = ctx;

  document.addEventListener('pack:mute-shortage', () => {
    ctx.muteShortageForCurrentPack();
  }, { signal });

  $('pe-cat-warn')?.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    ctx.muteShortageForCurrentPack();
  }, { signal });
  $('pe-cat-warn')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      ctx.muteShortageForCurrentPack();
    }
  }, { signal });

  $('pe-chips').addEventListener('keydown', e => {
    const warn = e.target.closest('.pe-warn');
    if (warn && (e.key === 'Enter' || e.key === ' ')) {
      e.stopPropagation();
      e.preventDefault();
      ctx.muteShortageForCurrentPack();
    }
  }, { signal });

  $('pe-chips').addEventListener('click', async e => {
    const warn = e.target.closest('.pe-warn');
    if (warn) {
      e.stopPropagation();
      e.preventDefault();
      ctx.muteShortageForCurrentPack();
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (!chip || state.isConfirming) return; // поки відкритий діалог підтвердження, не відкриваємо другий
    if (state.isDeleteMode && state.selectedDeleteIndices.size > 0) {
      state.isConfirming = true;
      let confirmed = false;
      try {
        confirmed = await showPackConfirm('Скинути вибрані картки для видалення?', chip, { confirmLabel: 'Скинути' });
      } finally {
        state.isConfirming = false;
      }
      if (!confirmed || signal?.aborted) return;
    }
    if (state.isDeleteMode) ctx.deleteMode.exit();
    ctx.selectCategory(chip.dataset.chip);
    setMobileCardView('list');
  }, { signal });
}
