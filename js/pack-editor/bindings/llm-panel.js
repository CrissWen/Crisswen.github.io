import { reconcileCards } from '../parser.js';
import { getPromptForCategory } from '../categories.js';
import { cataFieldStrings } from '../payload.js';
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

    ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });

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
}
