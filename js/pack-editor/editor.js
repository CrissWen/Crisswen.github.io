import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, getPromptForCategory } from './categories.js';
import { parseLines, oneLine, hasExplanationField, splitNameExplanation, cardToLine } from './parser.js';
import { STAGE_KEYS, stagesTextFromConfig, rangesFromConfig, RANGE_DEFAULTS, parseStageEntry } from './payload.js';
import { getStagePrompt } from './prompts/stage-prompts.js';
import { getPack, getDefaultPackConfig, checkIsAdmin, DEFAULT_PACK_ID } from '../services/packs-store.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { isPackNoticeMuted } from '../game-modules/overlays/pack-notice.js';
import { findShortByCounts } from '../utils/pack-fallback.js';
import { getGameConfigSync } from '../config/config-manager.js';
import { initTips } from './ui/tooltip.js';
import * as ui from './ui/ui.js';
import { $ } from './ui/helpers.js';
import {
  getPackIdFromHash, isDirty, confirmAction, goToList, onBeforeUnload,
  syncCataText, syncCataclysmsFromLlmText, syncCataclysmsToLlmText,
  cataDraftPending, renderCataList, setCataMode, resetCataForm,
  applyCataChange, submitCata, startCataEdit, deleteCata, handleCataClick,
  handleCataInput, setCataChangeHandler,
  getDynamicCards, dynDraftPending, readDynRaw, fillDynFields, setDynMode,
  updateDynFormState, startDynEdit, resetDynForm, applyDynChange, submitDyn,
  deleteDyn, handleDynClick, updateComboDropdown, setDynamicOrchestrator,
  searchTokens, cataFilterActive, renderSearch, setSearchQuery,
  openTextResult, openCataResult, onSearchResultClick, onSearchKeydown,
  onSearchListKeydown, initSearch, setSearchOrchestrator,
  isFormEmpty, buildConfig, handleSave, handleClear, handleReset,
  handleExit, handleActionsClick, setSaveOrchestrator
} from './controllers/controllers.js';

// ===== Сторінка "Редактор пака" (#/pack-editor, редагування — #/pack-editor?id=<uuid>) =====
// Це контролер: стан сторінки, валідація, обробники подій і координація
// ("взяли дані з UI → розібрали парсером → відправили в packs-store").
//   • розмітка і робота з DOM — js/pack-editor/ui.js (отримує дані аргументами, стану не знає);
//   • розбір тексту на картки — js/pack-editor/parser.js, збирання payload — js/pack-editor/payload.js;
//   • пошук по характеристиках — js/pack-editor/search.js.
// Замість сотні окремих інпутів: випадаючий список категорій + одна велика textarea (одна характеристика на рядок).
// Текст кожної категорії зберігається окремо, тож можна переключатись між категоріями, нічого не втрачаючи.
// Стадії (стаж професії, рівень хобі, ступінь хвороби) — одні на весь пак, зберігаються в packs.config.default_stages.

const UNSAVED_NOTE = 'Усі незбережені зміни будуть втрачені';

// ----- Стан сторінки (модульний: на екрані завжди один редактор) -----
import { state } from './state.js';

function blankForm() {
  return { title: '', description: '', texts: {}, stages: { ...state.baseStages }, ranges: { ...state.baseRanges }, cataclysms: [] };
}

function cloneForm(f) {
  return {
    title: f.title,
    description: f.description,
    texts: { ...f.texts },
    stages: { ...f.stages },
    ranges: { ...f.ranges },
    cataclysms: (f.cataclysms || []).map(c => ({ ...c, extra: { ...(c.extra || {}) } }))
  };
}

// Підключення координатора збереження
setSaveOrchestrator({
  blankForm,
  cloneForm,
  syncFieldsFromForm: () => syncFieldsFromForm()
});

// ----- Розмітка -----
export function renderPackEditor() {
  const id = getPackIdFromHash();
  return ui.packEditorTemplate({ isEdit: Boolean(id), isDefaultEdit: id === DEFAULT_PACK_ID });
}

// ----- Оновлення елементів за станом (дані рахуємо тут, малює UI) -----
// { [category]: кількість рядків } для підписів у списку категорій і підсумку
function categoryCounts() {
  const counts = {};
  for (const { category } of ALL_PACK_CATEGORIES) counts[category] = parseLines(state.form.texts[category]).length;
  return counts;
}

// Жовті кружечки «мало карток» показуємо лише у особистому паку, для якого користувач при збереженні поставив
// «Більше не показувати» (статус на пак, див. pack-notice.js). Працюють на тих же порогах, що й вікно, і оновлюються наживо.
function shortageByCategory(counts) {
  if (!state.packId || state.packId === DEFAULT_PACK_ID || !isPackNoticeMuted(state.packId)) return {};
  return Object.fromEntries(findShortByCounts(counts, getGameConfigSync() || {}).map(s => [s.category, s]));
}

const renderSummary = () => {
  const counts = categoryCounts();
  ui.renderSummary(counts, state.activeCategory, shortageByCategory(counts));
};
const updateButtons = () => ui.updateButtons({ dirty: isDirty(), empty: isFormEmpty() });

function updateCardsMeta() {
  const isCata = state.activeCategory === 'cataclysm';
  let count = 0;
  if (isCata) {
    count = state.form.cataclysms.length;
  } else if (CATEGORY_SCHEMAS[state.activeCategory] && state.viewMode === 'visual') {
    count = getDynamicCards().length;
  } else {
    count = parseLines(ui.getCardsText()).length;
  }
  ui.updateCardsMeta(isCata, count);
}

function selectCategory(category) {
  if (state.isDeleteMode) {
    exitDeleteMode();
  }
  state.activeCategory = category;
  state.viewMode = 'visual';
  
  ui.showCategory({ category, text: state.form.texts[category] || '', viewMode: state.viewMode });
  
  resetCataForm();
  resetDynForm();
  updateDynFormState();
  
  renderSearch();
  updateCardsMeta();
  renderSummary();
}

// Повністю перемальовує значення полів зі станом (після "Очистити все" / "Скасувати зміни" / завантаження пака)
function syncFieldsFromForm() {
  ui.fillFields(state.form);
  ui.setStagesViewMode(state.stagesViewMode);
  ui.showTitleError('');
  ui.updateDescCounter();
  
  resetCataForm();
  selectCategory(state.activeCategory);
  updateButtons();
}

// Підключення координатора пошуку
setSearchOrchestrator({
  selectCategory,
  renderList,
  getDynamicCards: () => getDynamicCards(),
  dynDraftPending: () => dynDraftPending(),
  startDynEdit: (idx, card) => startDynEdit(idx, card),
  updateDeleteModeUi
});

// Підключення координатора змін катаклізмів
setCataChangeHandler(({ scrollToEnd = false } = {}) => {
  renderList();
  if (scrollToEnd) ui.scrollCataListToEnd();
  renderSearch();
  updateCardsMeta();
  renderSummary();
  updateButtons();
});

// Підключення координатора динамічних карток
setDynamicOrchestrator(({ scrollToEnd = false } = {}) => {
  renderList();
  if (scrollToEnd) $('pe-cata-list')?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  renderSearch();
  updateCardsMeta();
  renderSummary();
  updateButtons();
});

function renderList() {
  if (state.activeCategory === 'cataclysm') {
    renderCataList(cataFilterActive() ? searchTokens() : []);
  } else if (CATEGORY_SCHEMAS[state.activeCategory] && state.viewMode === 'visual') {
    const cards = getDynamicCards();
    ui.renderCataList({
      // Фобія: у списку зліва показуємо лише назву (без " - пояснення"). В БД і в LLM-тексті картка лишається зклеєною;
      // пояснення передаємо як description, щоб пошук у списку і надалі знаходив картку за поясненням (в рядку воно не рендериться).
      cataclysms: cards.map(c => {
        if (!hasExplanationField(state.activeCategory)) return { name: c.value };
        const { name, explanation } = splitNameExplanation(c.value);
        return { name, description: explanation };
      }),
      editIndex: state.dynEditIndex,
      newIndex: state.newDynIndex,
      tokens: state.searchAll && !cataFilterActive() ? searchTokens() : [],
      category: state.activeCategory
    });
  }
}

function updateDeleteModeUi() {
  const isCata = state.activeCategory === 'cataclysm';
  const totalCount = isCata ? state.form.cataclysms.length : getDynamicCards().length;
  ui.setDeleteModeUi({
    isDeleteMode: state.isDeleteMode,
    selectedCount: state.selectedDeleteIndices.size,
    totalCount
  });
}

function enterDeleteMode() {
  if (state.activeCategory === 'cataclysm') {
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    resetCataForm();
  } else {
    if (dynDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    resetDynForm();
  }

  state.isDeleteMode = true;
  state.selectedDeleteIndices.clear();

  renderList();
  renderSearch();
  updateDeleteModeUi();
}

function exitDeleteMode() {
  state.isDeleteMode = false;
  state.selectedDeleteIndices.clear();
  renderList();
  renderSearch();
  updateDeleteModeUi();
}

function toggleSelectAllForDelete() {
  const isCata = state.activeCategory === 'cataclysm';
  const totalCount = isCata ? state.form.cataclysms.length : getDynamicCards().length;
  if (state.selectedDeleteIndices.size === totalCount) {
    state.selectedDeleteIndices.clear();
  } else {
    state.selectedDeleteIndices.clear();
    for (let i = 0; i < totalCount; i++) {
      state.selectedDeleteIndices.add(i);
    }
  }
  renderList();
  renderSearch();
  updateDeleteModeUi();
}

async function executeBulkDelete(anchorBtn) {
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
  if (!confirmed) return;

  const toDelete = state.selectedDeleteIndices;

  if (state.activeCategory === 'cataclysm') {
    state.form.cataclysms = state.form.cataclysms.filter((_, i) => !toDelete.has(i));
    syncCataText();
  } else {
    const cards = getDynamicCards();
    const remainingCards = cards.filter((_, i) => !toDelete.has(i));
    
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

  exitDeleteMode();
  updateCardsMeta();
  renderSummary();
  updateButtons();
  showGlobalToast(`Видалено записів: ${count}`);
}

function onCataListClick(e) {
  const row = e.target.closest('[data-cata-index]');
  if (!row) return;
  const index = Number(row.dataset.cataIndex);

  if (state.isDeleteMode) {
    if (state.selectedDeleteIndices.has(index)) {
      state.selectedDeleteIndices.delete(index);
    } else {
      state.selectedDeleteIndices.add(index);
    }
    renderList();
    renderSearch();
    updateDeleteModeUi();
    return;
  }

  if (state.activeCategory === 'cataclysm') {
    if (!state.form.cataclysms[index] || index === state.cataEditIndex) return;
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startCataEdit(index);
  } else {
    const cards = getDynamicCards();
    if (!cards[index] || index === state.dynEditIndex) return;
    if (dynDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startDynEdit(index, cards[index]);
  }
}







// ----- Ініціалізація -----
async function loadPackIntoForm(id) {
  const pack = await getPack(id);
  // Для адміна getPack повертає повний об'єкт базового пака (isDefault: true, isAdmin: true) — його пускаємо.
  // Для звичайного користувача — лише заглушка { isDefault: true } (без isAdmin), її блокуємо.
  const blockedDefault = Boolean(pack?.isDefault && !pack.isAdmin);
  if (!pack || pack.forbidden || blockedDefault) {
    // Чужий пак (напр., вручну введений id в URL) — негайно назад у список зі сповіщенням
    showGlobalToast(pack?.forbidden
      ? 'У вас немає прав для редагування цього пака'
      : (blockedDefault ? 'Дефолтний пак не можна редагувати' : 'Пак не знайдено'));
    goToList();
    return false;
  }

  state.packConfig = pack.config || {};
  state.extraMeta = pack.extraMeta || {};

  const texts = {};
  for (const [category, values] of Object.entries(pack.cards || {})) {
    texts[category] = values.join('\n');
  }
  // Стадії пака; якщо якоїсь немає — показуємо дефолтні (саме їх рушій і застосував би)
  const stages = {
    ...state.baseStages,
    ...Object.fromEntries(Object.entries(stagesTextFromConfig(state.packConfig)).filter(([, v]) => v))
  };
  const ranges = rangesFromConfig(state.packConfig, state.baseRanges);

  state.form = {
    title: pack.title,
    description: pack.description || '',
    texts,
    stages,
    ranges,
    cataclysms: (pack.cataclysms || []).map(c => ({ ...c, extra: { ...(c.extra || {}) } }))
  };
  syncCataText(state.form); // текст поля-списку будується з назв катаклізмів
  state.initialForm = cloneForm(state.form);
  return true;
}



function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedCardUpdates = debounce(() => {
  renderSearch();
  updateCardsMeta();
  renderSummary();
  updateButtons();
}, 200);

export async function initPackEditor() {
  state.packId = getPackIdFromHash();
  state.defaultConfig = {};
  state.packConfig = {};
  state.extraMeta = {};
  state.baseStages = {};
  state.baseRanges = {};
  state.form = blankForm();
  state.initialForm = cloneForm(state.form);
  state.activeCategory = ALL_PACK_CATEGORIES[0].category;
  state.stagesViewMode = 'visual';
  state.isSaving = false;
  state.isConfirming = false;
  state.allowLeave = false;
  state.cataEditIndex = -1;
  state.newCataIndex = -1;

  state.searchQuery = '';
  state.searchAll = false;

  window.addEventListener('beforeunload', onBeforeUnload);

  ui.setStageReorderCallback(key => {
    const text = ui.gatherStageText(key);
    state.form.stages[key] = text;
    const ta = document.querySelector(`[data-stage-ta="${key}"]`);
    if (ta) ta.value = text;
    updateButtons();
  });

  $('pe-title').addEventListener('input', e => {
    state.form.title = e.target.value;
    ui.showTitleError('');
    updateButtons();
  });

  $('pe-desc').addEventListener('input', e => {
    state.form.description = e.target.value;
    ui.updateDescCounter();
    updateButtons();
  });

  

  // Катаклізми: клік по назві у полі-списку відкриває їх у формі, кнопки форми додають/зберігають/видаляють
  $('pe-cata-list').addEventListener('click', onCataListClick);
  $('pe-cata').addEventListener('click', handleCataClick);
  $('pe-cata').addEventListener('input', handleCataInput);
  
  async function copyPromptToClipboard(prompt, emptyMsg) {
    if (!prompt) {
      showGlobalToast(emptyMsg);
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      showGlobalToast('Промпт для LLM скопійовано');
    } catch {
      showGlobalToast('Не вдалося скопіювати промпт');
    }
  }

  $('pe-dynamic-form').addEventListener('click', e => {
    handleDynClick(e);

    const toggle = e.target.closest('.pe-combo__toggle');
    if (toggle) {
      const input = toggle.parentElement.querySelector('.pe-combo__input');
      const list = toggle.parentElement.querySelector('.pe-combo__dropdown');
      list.hidden = !list.hidden;
      if (!list.hidden) {
        updateComboDropdown(input, true);
        input.focus();
      }
      return;
    }

    const item = e.target.closest('.pe-combo__item');
    if (item) {
      const input = item.closest('.pe-combo').querySelector('.pe-combo__input');
      input.value = item.dataset.val;
      item.closest('.pe-combo__dropdown').hidden = true;
      return;
    }

    const delBtn = e.target.closest('.pe-stage-del');
    if (delBtn) {
      const row = delBtn.closest('.pe-stage-row');
      const container = row?.closest('[data-dyn-stage-list]');
      if (container && row) {
        const key = container.dataset.dynStageList;
        const rows = [...container.querySelectorAll('.pe-stage-row')];
        const isLastRow = row === rows[rows.length - 1];
        if (isLastRow) {
          const nameInput = row.querySelector('.pe-stage-name');
          if (nameInput) nameInput.value = '';
        } else {
          row.remove();
        }
        ui.updateStageListVisuals(key, container);
      }
    }
  });

  $('pe-dynamic-form').addEventListener('input', e => {
    // Почали вводити в підсвічене поле — прибираємо червону рамку; коли не лишилося незаповнених — ховаємо помилку.
    if (e.target.classList?.contains('is-invalid') && e.target.value.trim() !== '') {
      e.target.classList.remove('is-invalid');
      if (!$('pe-dynamic-form').querySelector('.is-invalid')) {
        const dynErr = $('pe-dyn-error');
        if (dynErr) dynErr.hidden = true;
      }
    }

    if (e.target.classList.contains('pe-combo__input')) {
      const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
      list.hidden = false;
      updateComboDropdown(e.target);
    }

    const stageContainer = e.target.closest('[data-dyn-stage-list]');
    if (stageContainer) {
      const key = stageContainer.dataset.dynStageList;
      ui.ensureTrailingEmptyStageRow(stageContainer, key);
      ui.updateStageListVisuals(key, stageContainer);
    }
  });

  $('pe-dynamic-form').addEventListener('change', e => {
    updateDynFormState();

    if (e.target.matches('[data-dyn-custom-stages]')) {
      const isCustom = e.target.checked;
      const wrap = $('pe-dyn-stages-wrap');
      if (wrap) wrap.hidden = !isCustom;
      if (isCustom) {
        const current = ui.gatherDynStageList(state.activeCategory);
        if (!current.length) {
          const rawText = state.form.stages[state.activeCategory] || '';
          const entries = parseLines(rawText).map(line => parseStageEntry(state.activeCategory, line));
          ui.renderDynStageList(state.activeCategory, entries);
        }
        ui.initDynStageSortable(state.activeCategory);
      } else {
        ui.destroyDynStageSortable();
      }
    }
  });

  function handleStageKeydown(e) {
    const row = e.target.closest('.pe-stage-row');
    if (!row) return;

    const isY = e.target.dataset.type === 'y';
    const isM = e.target.dataset.type === 'm';
    const isName = e.target.classList.contains('pe-stage-name');
    const isSpace = e.key === ' ' || e.code === 'Space';
    const isEnter = e.key === 'Enter';

    const focusInput = el => {
      if (!el) return false;
      el.focus();
      el.select();
      return true;
    };

    const focusRowTimeOrName = targetRow => {
      if (!targetRow || !targetRow.classList.contains('pe-stage-row')) return false;
      const timeField = targetRow.querySelector('.pe-stage-to-wrap .pe-time-field');
      const yInput = targetRow.querySelector('[data-type="y"]');
      if (timeField && timeField.style.display !== 'none' && yInput) {
        return focusInput(yInput);
      }
      return focusInput(targetRow.querySelector('.pe-stage-name'));
    };

    // У полі року: Пробіл або Enter перескакує на місяць
    if (isY && (isSpace || isEnter)) {
      e.preventDefault();
      focusInput(row.querySelector('[data-type="m"]'));
      return;
    }

    // У полі місяця: Пробіл або Enter перескакує на наступне поле цифр або назву наступної стадії
    if (isM && (isSpace || isEnter)) {
      e.preventDefault();
      if (!focusRowTimeOrName(row.nextElementSibling)) e.target.blur();
      return;
    }

    // У назві стадії: Enter переходить до цифр цього рядка (якщо є) або до наступної стадії
    if (isName && isEnter) {
      e.preventDefault();
      const timeField = row.querySelector('.pe-stage-to-wrap .pe-time-field');
      const yInput = row.querySelector('[data-type="y"]');
      if (timeField && timeField.style.display !== 'none' && yInput) {
        focusInput(yInput);
      } else {
        const nextRow = row.nextElementSibling;
        if (!focusInput(nextRow?.querySelector('.pe-stage-name'))) e.target.blur();
      }
    }
  }

  $('pe-dynamic-form').addEventListener('keydown', e => {
    if (e.target.closest('[data-dyn-stage-list]')) {
      handleStageKeydown(e);
      return;
    }

    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.id === 'pe-dyn-name' && !e.shiftKey))) {
      e.preventDefault();
      submitDyn();
    }
  });

  $('pe-dynamic-form').addEventListener('focusin', e => {
    ui.handleStageTimeFocusIn(e);
    if (e.target.classList.contains('pe-combo__input')) {
      const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
      list.hidden = false;
      updateComboDropdown(e.target);
    }
  });

  $('pe-dynamic-form').addEventListener('focusout', e => {
    const stageContainer = e.target.closest('[data-dyn-stage-list]');
    if (ui.normalizeStageRowTimeOnBlur(e, stageContainer)) {
      ui.updateStageListVisuals(stageContainer.dataset.dynStageList, stageContainer);
    }
  });

  $('pe-cata').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.id === 'pe-cata-name' && !e.shiftKey))) {
      e.preventDefault();
      submitCata();
    }
  });

  $('pe-llm-mode')?.addEventListener('change', e => {
    if (state.isDeleteMode) exitDeleteMode();
    state.viewMode = e.target.checked ? 'llm' : 'visual';
    ui.setLlmCopyVisible(e.target.checked);

    if (state.activeCategory === 'cataclysm') {
      if (state.viewMode === 'visual') syncCataclysmsFromLlmText();
      else syncCataclysmsToLlmText();
    }

    ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });

    if (state.viewMode === 'visual' && state.activeCategory !== 'cataclysm') {
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

    renderList();
    renderSearch();
    updateCardsMeta();
  });

  $('pe-llm-copy')?.addEventListener('click', () =>
    copyPromptToClipboard(getPromptForCategory(state.activeCategory), 'Промпт для цієї категорії відсутній')
  );

  $('pe-cards').addEventListener('input', e => {
    if (state.activeCategory === 'cataclysm') return;
    state.form.texts[state.activeCategory] = e.target.value;
    debouncedCardUpdates();
  });

  $('pe-chips').addEventListener('click', async e => {
    const chip = e.target.closest('[data-chip]');
    if (!chip) return;
    if (state.isDeleteMode && state.selectedDeleteIndices.size > 0) {
      state.isConfirming = true;
      let confirmed = false;
      try {
        confirmed = await showPackConfirm('Скинути вибрані картки для видалення?', chip, { confirmLabel: 'Скинути' });
      } finally {
        state.isConfirming = false;
      }
      if (!confirmed) return;
    }
    if (state.isDeleteMode) exitDeleteMode();
    selectCategory(chip.dataset.chip);
  });

  // Кнопки режиму масового видалення
  $('pe-bulk-delete-btn')?.addEventListener('click', () => {
    if (state.isDeleteMode) exitDeleteMode();
    else enterDeleteMode();
  });
  $('pe-delete-cancel-btn')?.addEventListener('click', exitDeleteMode);
  $('pe-delete-select-all-btn')?.addEventListener('click', toggleSelectAllForDelete);
  $('pe-delete-submit-btn')?.addEventListener('click', e => executeBulkDelete(e.currentTarget));

  $('pe-stages-llm')?.addEventListener('change', e => {
    const isLlm = e.target.checked;
    state.stagesViewMode = isLlm ? 'llm' : 'visual';

    STAGE_KEYS.forEach(key => {
      const ta = document.querySelector(`[data-stage-ta="${key}"]`);
      if (isLlm) {
        const text = ui.gatherStageText(key);
        state.form.stages[key] = text;
        if (ta) ta.value = text;
      } else {
        if (ta) state.form.stages[key] = ta.value;
        ui.renderStageList(key, state.form.stages[key] || '');
      }
    });
    ui.setStagesViewMode(state.stagesViewMode);
    updateButtons();
  });

  $('pe-stages').addEventListener('input', e => {
    const ta = e.target.closest('[data-stage-ta]');
    if (ta) {
      state.form.stages[ta.dataset.stageTa] = ta.value;
      updateButtons();
      return;
    }

    const stageGroup = e.target.closest('[data-stage-list]');
    if (stageGroup) {
      const key = stageGroup.dataset.stageList;
      ui.ensureTrailingEmptyStageRow(stageGroup, key);
      state.form.stages[key] = ui.gatherStageText(key);
      updateButtons();
    }
  });

  $('pe-stages').addEventListener('keydown', e => {
    if (e.target.closest('[data-stage-list]')) {
      handleStageKeydown(e);
    }
  });

  $('pe-stages').addEventListener('focusin', ui.handleStageTimeFocusIn);

  $('pe-stages').addEventListener('focusout', e => {
    const stageGroup = e.target.closest('[data-stage-list]');
    if (ui.normalizeStageRowTimeOnBlur(e, stageGroup)) {
      const key = stageGroup.dataset.stageList;
      state.form.stages[key] = ui.gatherStageText(key);
      updateButtons();
    }
  });

  $('pe-stages').addEventListener('change', e => {
    const stageGroup = e.target.closest('[data-stage-list]');
    if (stageGroup) {
      const key = stageGroup.dataset.stageList;
      const rows = [...stageGroup.querySelectorAll('.pe-stage-row')];
      let i = rows.length - 1;
      while (i > 0 && !rows[i].querySelector('.pe-stage-name')?.value?.trim() && !rows[i - 1].querySelector('.pe-stage-name')?.value?.trim()) {
        rows[i].remove();
        i--;
      }
      state.form.stages[key] = ui.gatherStageText(key);
      updateButtons();
    }
  });

  $('pe-stages').addEventListener('click', async e => {
    const copyBtn = e.target.closest('[data-stage-copy]');
    if (copyBtn) {
      await copyPromptToClipboard(getStagePrompt(copyBtn.dataset.stageCopy), 'Промпт для цієї стадії відсутній');
      return;
    }

    const addBtn = e.target.closest('[data-stage-add]');
    if (addBtn) {
      const key = addBtn.dataset.stageAdd;
      const list = document.querySelector(`[data-stage-list="${key}"]`);
      if (list) {
        list.insertAdjacentHTML('beforeend', ui.stageRowHtml(key, { name: '' }));
        state.form.stages[key] = ui.gatherStageText(key);
        updateButtons();
      }
    }

    const delBtn = e.target.closest('.pe-stage-del');
    if (delBtn) {
      const row = delBtn.closest('.pe-stage-row');
      const list = row?.closest('[data-stage-list]');
      if (list && row) {
        const key = list.dataset.stageList;
        const rows = [...list.querySelectorAll('.pe-stage-row')];
        const isLastRow = row === rows[rows.length - 1];
        const name = row.querySelector('.pe-stage-name')?.value?.trim();
        if (isLastRow && !name) return;

        if (name) {
          const confirmed = await showPackConfirm(`Чи точно хочете видалити стадію "${oneLine(name)}"?`, delBtn, { confirmLabel: 'Видалити' });
          if (!confirmed) return;
        }

        row.remove();
        state.form.stages[key] = ui.gatherStageText(key);
        updateButtons();
      }
    }
  });

  $('pe-ranges').addEventListener('input', e => {
    const field = e.target.closest('[data-range]');
    if (!field) return;
    state.form.ranges[field.dataset.range] = field.value;
    updateButtons();
  });

  initSearch();
  initTips();

  $('pe-actions').addEventListener('click', handleActionsClick);

  $('pe-root')?.addEventListener('click', e => {
    if (!e.target.closest('.pe-combo')) {
      document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });
    }
  });

  document.getElementById('pe-root')?.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.isDeleteMode) {
      e.preventDefault();
      exitDeleteMode();
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
  });


  try {
    // Базовий пак редагує лише адмін: перевіряємо ще до завантаження даних (статус кешується в packs-store.js; дублює перевірку в getPack)
    if (state.packId === DEFAULT_PACK_ID && !(await checkIsAdmin())) {
      showGlobalToast('Дефолтний пак не можна редагувати');
      goToList();
      return;
    }

    // Конфіг дефолтного пака потрібен в обох режимах: без нього не зібрати повний config (age_range, height_range...)
    state.defaultConfig = await getDefaultPackConfig();
    state.baseStages = stagesTextFromConfig(state.defaultConfig);
    state.baseRanges = rangesFromConfig(state.defaultConfig, RANGE_DEFAULTS);

    if (state.packId) {
      if (!(await loadPackIntoForm(state.packId))) return;
    } else {
      state.form = blankForm();
      state.initialForm = cloneForm(state.form);
    }
  } catch (err) {
    console.error('Не вдалося завантажити дані редактора:', err);
    showGlobalToast(err.message || 'Не вдалося завантажити дані');
    goToList();
    return;
  }

  // Користувач міг устигнути піти зі сторінки, поки вантажились дані — тоді DOM уже інший
  if (!ui.isEditorMounted()) return;
  ui.markEditorLoaded();

  syncFieldsFromForm();
  if (!state.packId) ui.focusTitle();
}

export function cleanupPackEditor() {
  window.removeEventListener('beforeunload', onBeforeUnload);
  ui.destroyStageSortables();
  state.isSaving = false;
  state.isConfirming = false;
  state.isDeleteMode = false;
  state.selectedDeleteIndices.clear();
}