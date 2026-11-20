import { reconcileCards } from '../parser.js';
import { getPromptForCategory } from '../categories.js';
import { cataFieldStrings } from '../payload.js';
import { processDroppedLlmFiles } from '../llm-file-import.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/shared.js';
import { state } from '../state.js';
import {
  syncCataText, syncCataclysmsFromLlmText, syncCataclysmsToLlmText,
  resetCataForm, setCataMode, getDynamicCards, fillDynFields, setDynMode,
  resetDynForm, updateDynFormState, renderSearch
} from '../controllers/controllers.js';
import { copyPromptToClipboard } from './shared.js';

function debounce(func, wait, signal) {
  let timeout;
  if (signal && !signal.aborted) {
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      timeout = null;
    }, { once: true });
  }
  return function executedFunction(...args) {
    if (signal?.aborted) return;
    const later = () => {
      clearTimeout(timeout);
      timeout = null;
      if (signal?.aborted) return;
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Режим LLM: перемикач «Режим LLM», копіювання промпту, велика textarea з картками.
export function bindLlmPanel(ctx) {
  const { signal } = ctx;

  const debouncedCardUpdates = debounce(() => {
    if (state.activeCategory === 'cataclysm' && state.viewMode === 'llm') {
      syncCataclysmsFromLlmText();
    }
    renderSearch();
    ctx.updateCardsMeta();
    ctx.renderSummary();
    ctx.updateButtons();
  }, 200, signal);

  $('pe-llm-mode')?.addEventListener('change', e => {
    if (state.isDeleteMode) ctx.deleteMode.exit();
    state.viewMode = e.target.checked ? 'llm' : 'visual';
    ui.setLlmCopyVisible(e.target.checked);

    if (state.activeCategory === 'cataclysm') {
      if (state.viewMode === 'visual') {
        syncCataclysmsFromLlmText();
        syncCataText();
      } else {
        syncCataclysmsToLlmText();
      }
    } else {
      if (state.viewMode === 'visual') {
        state.cardData[state.activeCategory] = reconcileCards(
          state.form.texts[state.activeCategory] || '',
          state.cardData[state.activeCategory] || [],
          state.activeCategory,
          state.extraMeta,
          state.deletionSink
        );
      }
    }

    ui.showCategory({
      category: state.activeCategory,
      text: state.form.texts[state.activeCategory] || '',
      viewMode: state.viewMode,
      ageCategoriesText: state.form?.stages?.age_categories || ''
    });

    if (state.viewMode === 'visual') {
      if (state.activeCategory === 'cataclysm') {
        if (state.cataEditIndex >= 0 && state.form.cataclysms[state.cataEditIndex]) {
          ui.fillCataFields(cataFieldStrings(state.form.cataclysms[state.cataEditIndex]));
        } else {
          resetCataForm();
          setCataMode(-1);
        }
      } else {
        if (state.dynEditIndex >= 0) {
          const cards = getDynamicCards();
          if (cards[state.dynEditIndex]) {
            fillDynFields(cards[state.dynEditIndex]);
          } else {
            resetDynForm();
            setDynMode(-1);
          }
        }
        updateDynFormState();
      }
    }

    ctx.renderList();
    renderSearch();
    ctx.updateCardsMeta();
    ctx.renderSummary();
  }, { signal });

  $('pe-llm-copy')?.addEventListener('click', () =>
    copyPromptToClipboard(getPromptForCategory(state.activeCategory), 'Промпт для цієї категорії відсутній'),
  { signal });

  $('pe-cards').addEventListener('input', e => {
    state.form.texts[state.activeCategory] = e.target.value;
    ctx.updateCardsMeta();
    debouncedCardUpdates();
  }, { signal });

  const cardsTa = $('pe-cards');
  cardsTa?.addEventListener('dragover', e => {
    if (cardsTa.hidden) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    cardsTa.classList.add('is-dragover');
  }, { signal });

  cardsTa?.addEventListener('dragleave', e => {
    if (!cardsTa.contains(e.relatedTarget)) {
      cardsTa.classList.remove('is-dragover');
    }
  }, { signal });

  cardsTa?.addEventListener('drop', async e => {
    if (cardsTa.hidden) return;
    e.preventDefault();
    cardsTa.classList.remove('is-dragover');
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    const sessionId = state.sessionId;
    const category = state.activeCategory;
    const res = await processDroppedLlmFiles(files, {
      mode: 'cards',
      targetKey: category,
      existingText: cardsTa.value
    });
    if (signal?.aborted || state.sessionId !== sessionId || state.activeCategory !== category) return;

    if (res.ok) {
      cardsTa.value = res.nextText;
      state.form.texts[category] = res.nextText;
      if (category === 'cataclysm' && state.viewMode === 'llm') {
        syncCataclysmsFromLlmText();
      }
      renderSearch();
      ctx.updateCardsMeta();
      ctx.renderSummary();
      ctx.updateButtons();
    }
    if (res.message) showGlobalToast(res.message);
  }, { signal });
}
