import { state } from '../state.js';
import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS } from '../categories.js';
import { tokenize, cataMatches, collectSearchResults } from '../search.js';
import { cataDraftPending, startCataEdit } from './cataclysm.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/helpers.js';

let orchestrator = {
  selectCategory: () => {},
  renderList: () => {},
  getDynamicCards: () => [],
  dynDraftPending: () => false,
  startDynEdit: () => {}
};

export function setSearchOrchestrator(handlers) {
  orchestrator = { ...orchestrator, ...handlers };
}

export const searchTokens = () => tokenize(state.searchQuery);

// Фільтр самого списку катаклізмів діє, лише коли шукаємо в активній категорії "Катаклізм"
export const cataFilterActive = () => state.activeCategory === 'cataclysm' && !state.searchAll && searchTokens().length > 0;

// Перемальовує панель результатів, лічильник і кнопку "×" за станом
export function renderSearch() {
  const tokens = searchTokens();
  const view = { query: state.searchQuery, tokens, searchAll: state.searchAll };

  if (!tokens.length) {
    ui.paintSearch({ ...view, mode: 'idle' });
    return;
  }

  // Катаклізми в активній категорії: фільтрується сам список, окрема панель не потрібна
  if (cataFilterActive()) {
    ui.paintSearch({ ...view, mode: 'cata-filter', cataCount: state.form.cataclysms.filter(c => cataMatches(c, tokens)).length });
    return;
  }

  const categories = state.searchAll ? ALL_PACK_CATEGORIES : ALL_PACK_CATEGORIES.filter(c => c.category === state.activeCategory);
  const { results, total } = collectSearchResults({ categories, texts: state.form.texts, cataclysms: state.form.cataclysms, tokens });
  ui.paintSearch({ ...view, mode: 'results', results, total });
}

export function setSearchQuery(value, { focus = false } = {}) {
  state.searchQuery = value;
  ui.setSearchInput(value);
  orchestrator.renderList();
  renderSearch();
  if (focus) ui.focusSearchInput();
}

// Результат-рядок: переходимо в його категорію, виділяємо рядок у textarea й прокручуємо до нього
export function openTextResult(category, lineIndex) {
  if (category !== state.activeCategory) orchestrator.selectCategory(category);

  if (state.viewMode === 'visual' && CATEGORY_SCHEMAS[category]) {
    const cards = orchestrator.getDynamicCards();
    if (!cards[lineIndex]) {
      showGlobalToast('Рядок змінився — виберіть результат ще раз');
      renderSearch();
      return;
    }
    if (orchestrator.dynDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    orchestrator.startDynEdit(lineIndex, cards[lineIndex]);
  } else {
    if (!ui.selectCardsLine(lineIndex)) {
      showGlobalToast('Рядок змінився — виберіть результат ще раз');
      renderSearch();
    }
  }
}

// Результат-катаклізм: відкриваємо його у формі (з тим самим захистом від втрати незбереженого, що й у кліку по списку)
export function openCataResult(index) {
  if (state.activeCategory !== 'cataclysm') orchestrator.selectCategory('cataclysm');
  if (!state.form.cataclysms[index]) return;
  if (index !== state.cataEditIndex) {
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startCataEdit(index);
    return;
  }
}

export function onSearchResultClick(e) {
  const row = e.target.closest('.pe-result');
  if (!row) return;
  if (row.dataset.resCata !== undefined) openCataResult(Number(row.dataset.resCata));
  else openTextResult(row.dataset.resCat, Number(row.dataset.resLine));
}

export function onSearchKeydown(e) {
  if (e.key === 'Escape') {
    if (state.searchQuery) {
      e.preventDefault();
      setSearchQuery('');
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    ui.firstSearchTargetEl(cataFilterActive())?.click();
  } else if (e.key === 'ArrowDown') {
    const target = ui.firstSearchTargetEl(cataFilterActive());
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }
}

// Стрілки ↑/↓ ходять по рядках результатів (або по списку катаклізмів), Esc / ↑ з першого рядка повертає в поле пошуку
export function onSearchListKeydown(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (e.key === 'Escape') {
    ui.focusSearchInput();
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const dynForm = document.getElementById('pe-dynamic-form');
    if (dynForm && !dynForm.hidden) {
      document.getElementById('pe-dyn-name')?.focus({ preventScroll: true });
    } else {
      const cataForm = document.getElementById('pe-cata');
      if (cataForm && !cataForm.hidden) {
        document.getElementById('pe-cata-name')?.focus({ preventScroll: true });
      }
    }
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const moved = ui.focusSiblingRow(btn, e.key === 'ArrowDown' ? 1 : -1);
  if (!moved && e.key === 'ArrowUp') ui.focusSearchInput();
}

export function initSearch() {
  ui.initSearchControls({ query: state.searchQuery, all: state.searchAll });
  const searchInput = $('pe-search');
  searchInput.addEventListener('input', e => setSearchQuery(e.target.value));
  searchInput.addEventListener('keydown', onSearchKeydown);
  $('pe-search-clear').addEventListener('click', () => setSearchQuery('', { focus: true }));

  let searchHadFocus = false;
  document.querySelector('.pe-search__inside')?.addEventListener('mousedown', e => {
    searchHadFocus = document.activeElement === searchInput;
    if (!searchHadFocus) return;
    e.preventDefault();
    window.addEventListener('mouseup', () => setTimeout(() => { searchHadFocus = false; }), { once: true });
  });

  $('pe-search-all').addEventListener('change', e => {
    state.searchAll = e.target.checked;
    orchestrator.renderList();
    renderSearch();
    if (searchHadFocus) searchInput.focus({ preventScroll: true });
  });
  const results = $('pe-search-results');
  results.addEventListener('click', onSearchResultClick);
  results.addEventListener('keydown', onSearchListKeydown);
  $('pe-cata-list').addEventListener('keydown', onSearchListKeydown);
}

