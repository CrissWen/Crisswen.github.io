import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, POOL_TYPE_BY_CATEGORY, getPromptForCategory } from './categories.js';
import { parseLines, oneLine, hasExplanationField, splitNameExplanation, cardToLine, reconcileCards } from './parser.js';
import { STAGE_KEYS, stagesTextFromConfig, rangesFromConfig, RANGE_DEFAULTS, parseStageEntry, cataclysmToRow } from './payload.js';
import { getStagePrompt } from './prompts/stage-prompts.js';
import {
  getPack, getDefaultPackConfig, checkIsAdmin, DEFAULT_PACK_ID,
  countPersonalPacks, MAX_PERSONAL_PACKS, PACK_LIMIT_MESSAGE
} from '../services/packs-store.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { isPackNoticeMuted, isPackShortageMuted, setPackShortageMuted } from '../game-modules/overlays/pack-notice.js';
import { findShortByCounts } from '../utils/pack-fallback.js';
import { getGameConfigSync } from '../config/config-manager.js';
import { initTips } from './ui/tooltip.js';
import * as ui from './ui/ui.js';
import { initMobileNav, setMobileCardView } from './controllers/mobile-nav.js';
import { $ } from './ui/helpers.js';
import { initAutosave, destroyAutosave, onEditorChanged } from './autosave-bridge.js';
import {
  getPackIdFromHash, isDirty, confirmAction, goToList, onBeforeUnload,
  syncCataText, syncCataclysmsFromLlmText, syncCataclysmsToLlmText,
  cataDraftPending, renderCataList, setCataMode, resetCataForm,
  applyCataChange, submitCata, startCataEdit, deleteCata, handleCataClick,
  handleCataInput, setCataChangeHandler,
  getDynamicCards, dynDraftPending, readDynRaw, fillDynFields, setDynMode, syncCustomSelect,
  updateDynFormState, startDynEdit, resetDynForm, applyDynChange, submitDyn,
  deleteDyn, handleDynClick, updateComboDropdown, setDynamicOrchestrator,
  searchTokens, cataFilterActive, renderSearch, setSearchQuery,
  openTextResult, openCataResult, onSearchResultClick, onSearchKeydown,
  onSearchListKeydown, initSearch, setSearchOrchestrator,
  isFormEmpty, buildConfig, handleSave, handleClear, handleReset,
  handleExit, handleActionsClick, setSaveOrchestrator,
  visibleListIndices, applyDeleteClick, toggleSelectVisible, areAllSelected
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
  const pid = state.packId;
  if (!pid || pid === DEFAULT_PACK_ID || isPackShortageMuted(pid)) return {};
  if (!isPackNoticeMuted(pid)) return {};
  return Object.fromEntries(findShortByCounts(counts, getGameConfigSync() || {}).map(s => [s.category, s]));
}

function muteShortageForCurrentPack() {
  const packId = state.packId;
  if (!packId || packId === DEFAULT_PACK_ID) return;
  setPackShortageMuted(packId, true);
  renderSummary();
  showGlobalToast('Попередження про нестачу приховано для цього пака', {
    actionText: 'Скасувати',
    duration: 6000,
    onAction: () => {
      setPackShortageMuted(packId, false);
      renderSummary();
    }
  });
}

const renderSummary = () => {
  const counts = categoryCounts();
  ui.renderSummary(counts, state.activeCategory, shortageByCategory(counts));
};
// Кожна зміна стану редактора закінчується викликом updateButtons: через нього міст автосейву бачить зміни (чернетка + історія Undo/Redo)
const updateButtons = () => {
  ui.updateButtons({ dirty: isDirty(), empty: isFormEmpty() });
  onEditorChanged();
};

function updateCardsMeta() {
  const isCata = state.activeCategory === 'cataclysm';
  let count = 0;
  if (state.viewMode === 'llm') {
    count = parseLines(ui.getCardsText()).length;
  } else if (isCata) {
    count = state.form.cataclysms.length;
  } else if (CATEGORY_SCHEMAS[state.activeCategory]) {
    count = getDynamicCards().length;
  } else {
    count = parseLines(ui.getCardsText()).length;
  }
  ui.updateCardsMeta(isCata, count);
}

function selectCategory(category) {
  // Режим LLM — один на весь редактор: state.viewMode міняє лише чекбокс «Режим LLM», тому при перемиканні категорій він не скидається.
  // Катаклізми зберігаються масивом, а в LLM-режимі редагуються текстом: при виході з вкладки розбираємо текст назад
  // у масив (і повертаємо у state.form.texts звичний список назв), при вході — генеруємо LLM-текст з масиву.
  if (state.viewMode === 'llm' && state.activeCategory) {
    const currentText = ui.getCardsText();
    if (currentText !== undefined) {
      state.form.texts[state.activeCategory] = currentText;
    }
  }

  if (state.viewMode === 'llm' && state.activeCategory === 'cataclysm' && category !== 'cataclysm') {
    syncCataclysmsFromLlmText();
    syncCataText();
  } else if (state.viewMode === 'llm' && state.activeCategory && state.activeCategory !== 'cataclysm' && category !== state.activeCategory) {
    state.cardData[state.activeCategory] = reconcileCards(
      state.form.texts[state.activeCategory] || '',
      state.cardData[state.activeCategory] || [],
      state.activeCategory,
      state.extraMeta,
      state.deletionSink
    );
  }
  state.activeCategory = category;
  if (state.viewMode === 'llm' && category === 'cataclysm') syncCataclysmsToLlmText();
  
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
  updateDeleteModeUi,
  enterDeleteMode: (opts) => enterDeleteMode(opts)
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

// Рядки списку, які користувач бачить зараз (список катаклізмів може бути відфільтрований пошуком)
const currentVisibleIndices = () => visibleListIndices($('pe-cata-list'));

function updateDeleteModeUi() {
  // «Вибрати всі» і підпис кнопки рахуються по видимих рядках, а не по всіх картках категорії
  const visible = currentVisibleIndices();
  ui.setDeleteModeUi({
    isDeleteMode: state.isDeleteMode,
    selectedCount: state.selectedDeleteIndices.size,
    totalCount: visible.length,
    allSelected: areAllSelected(visible)
  });
  const fab = $('pe-fab-back');
  if (fab) fab.hidden = state.isDeleteMode;
}

function enterDeleteMode({ initialIndex = null } = {}) {
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

  renderList();
  renderSearch();
  updateDeleteModeUi();
  return true;
}

function exitDeleteMode() {
  state.isDeleteMode = false;
  state.selectedDeleteIndices.clear();
  state.lastClickedDeleteIndex = null;
  renderList();
  renderSearch();
  updateDeleteModeUi();
}

// «Вибрати всі» / «Зняти всі» чіпає лише видимі рядки: при активному фільтрі пошуку приховані картки не потраплять у видалення
function toggleSelectAllForDelete() {
  toggleSelectVisible(currentVisibleIndices());
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

  exitDeleteMode();
  updateCardsMeta();
  renderSummary();
  updateButtons();
  showGlobalToast(`Видалено записів: ${count}`);
}

function applyCardSort(dir = 'none') {
  state.cardsSortDir = dir;
  updateSortBtnUi();
  renderList();
  renderSearch();
  if (dir === 'asc') showGlobalToast('Сортувати в порядку Від "А" до "Я"');
  else if (dir === 'desc') showGlobalToast('Сортувати в порядку Від "Я" до "А"');
  else showGlobalToast('Початковий порядок');
}

function updateSortBtnUi() {
  const sortBtn = $('pe-sort-btn');
  const sortMenu = $('pe-sort-menu');
  if (!sortBtn || !sortMenu) return;

  const dir = state.cardsSortDir || 'none';
  const isSorted = dir !== 'none';

  sortBtn.classList.toggle('is-active', isSorted);
  if (dir === 'asc') {
    sortBtn.title = 'Сортувати в порядку Від "А" до "Я"';
    sortBtn.setAttribute('aria-label', 'Сортувати в порядку Від "А" до "Я"');
  } else if (dir === 'desc') {
    sortBtn.title = 'Сортувати в порядку Від "Я" до "А"';
    sortBtn.setAttribute('aria-label', 'Сортувати в порядку Від "Я" до "А"');
  } else {
    sortBtn.title = 'Сортування списку';
    sortBtn.setAttribute('aria-label', 'Сортування списку');
  }

  sortMenu.querySelectorAll('.pe-sort-menu__item').forEach(item => {
    const active = item.dataset.sortDir === dir;
    item.classList.toggle('is-active', active);
    const check = item.querySelector('.pe-sort-menu__check');
    if (check) check.textContent = active ? '✓' : '';
  });
}

function onCataListClick(e) {
  const row = e.target.closest('[data-cata-index]');
  if (!row) return;
  const index = Number(row.dataset.cataIndex);

  if (state.isDeleteMode) {
    // Діапазон Shift — лише серед видимих рядків (список може бути відфільтрований пошуком)
    applyDeleteClick(index, { shiftKey: e.shiftKey, visibleIndices: currentVisibleIndices() });
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
  // Версія пака на сервері (optimistic locking) і мітка часу — основа для expectedVersion та порівняння з чернеткою
  state.packVersion = pack.version ?? 1;
  state.packUpdatedAt = pack.updatedAt || null;

  state.cardData = {};
  state.initialCardMap = new Map();
  state.deletedCardIds = new Set();

  for (const [category, objs] of Object.entries(pack.cardObjects || {})) {
    state.cardData[category] = objs.map(c => ({
      id: c.id,
      value: c.value,
      meta: c.meta || {}
    }));
    const poolType = POOL_TYPE_BY_CATEGORY[category] || 'character';
    for (const c of objs) {
      state.initialCardMap.set(c.id, JSON.stringify({ pool_type: poolType, category, value: c.value, meta: c.meta || {} }));
    }
  }

  for (const cata of pack.cataclysms || []) {
    if (cata.id) {
      const row = cataclysmToRow(cata);
      state.initialCardMap.set(cata.id, JSON.stringify({ pool_type: row.pool_type, category: row.category, value: row.value, meta: row.meta || {} }));
    }
  }

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
  if (state.activeCategory === 'cataclysm' && state.viewMode === 'llm') {
    syncCataclysmsFromLlmText();
  }
  renderSearch();
  updateCardsMeta();
  renderSummary();
  updateButtons();
}, 200);

function onEditorKeydown(e) {
  if (e.key === 'Escape' && state.isDeleteMode) {
    e.preventDefault();
    exitDeleteMode();
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
    if (state.isDeleteMode) exitDeleteMode();
    else enterDeleteMode();
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

export async function initPackEditor() {
  state.packId = getPackIdFromHash();
  state.packVersion = null; // новий пак: версії ще немає
  state.packUpdatedAt = null;
  state.userId = null;
  state.saveStatus = 'saved';
  state.skipDraftFlush = false;
  state.defaultConfig = {};
  state.packConfig = {};
  state.extraMeta = {};
  state.cardData = {};
  state.initialCardMap = new Map();
  state.deletedCardIds = new Set();
  state.baseStages = {};
  state.baseRanges = {};
  state.form = blankForm();
  state.initialForm = cloneForm(state.form);
  state.activeCategory = ALL_PACK_CATEGORIES[0].category;
  state.stagesViewMode = 'visual';
  state.viewMode = 'visual';
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

    const comboInput = e.target.closest('.pe-combo__input');
    if (comboInput) {
      const list = comboInput.parentElement.querySelector('.pe-combo__dropdown');
      const toggle = comboInput.parentElement.querySelector('.pe-combo__toggle');
      if (list && list.hidden) {
        list.hidden = false;
        if (toggle) toggle.classList.add('is-open');
        updateComboDropdown(comboInput, true);
      }
      return;
    }

    const toggle = e.target.closest('.pe-combo__toggle');
    if (toggle) {
      const input = toggle.parentElement.querySelector('.pe-combo__input');
      const list = toggle.parentElement.querySelector('.pe-combo__dropdown');
      const isOpening = list.hidden;
      list.hidden = !isOpening;
      toggle.classList.toggle('is-open', isOpening);
      if (isOpening) {
        updateComboDropdown(input, true);
        input.focus();
      }
      return;
    }

    const item = e.target.closest('.pe-combo__item');
    if (item) {
      const combo = item.closest('.pe-combo');
      const input = combo.querySelector('.pe-combo__input');
      const toggleBtn = combo.querySelector('.pe-combo__toggle');
      input.value = item.dataset.val;
      item.closest('.pe-combo__dropdown').hidden = true;
      if (toggleBtn) toggleBtn.classList.remove('is-open');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
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
      const toggle = e.target.parentElement.querySelector('.pe-combo__toggle');
      if (list) list.hidden = false;
      if (toggle) toggle.classList.add('is-open');
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
      const toggle = e.target.parentElement.querySelector('.pe-combo__toggle');
      if (list) list.hidden = false;
      if (toggle) toggle.classList.add('is-open');
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

    renderList();
    renderSearch();
    updateCardsMeta();
    renderSummary();
  });

  $('pe-llm-copy')?.addEventListener('click', () =>
    copyPromptToClipboard(getPromptForCategory(state.activeCategory), 'Промпт для цієї категорії відсутній')
  );

  $('pe-cards').addEventListener('input', e => {
    state.form.texts[state.activeCategory] = e.target.value;
    updateCardsMeta();
    debouncedCardUpdates();
  });

  document.addEventListener('pack:mute-shortage', () => {
    muteShortageForCurrentPack();
  });

  $('pe-cat-warn')?.addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    muteShortageForCurrentPack();
  });
  $('pe-cat-warn')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      muteShortageForCurrentPack();
    }
  });

  $('pe-chips').addEventListener('keydown', e => {
    const warn = e.target.closest('.pe-warn');
    if (warn && (e.key === 'Enter' || e.key === ' ')) {
      e.stopPropagation();
      e.preventDefault();
      muteShortageForCurrentPack();
    }
  });

  $('pe-chips').addEventListener('click', async e => {
    const warn = e.target.closest('.pe-warn');
    if (warn) {
      e.stopPropagation();
      e.preventDefault();
      muteShortageForCurrentPack();
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
      if (!confirmed) return;
    }
    if (state.isDeleteMode) exitDeleteMode();
    selectCategory(chip.dataset.chip);
    setMobileCardView('list');
  });

  // Кнопки режиму масового видалення
  $('pe-bulk-delete-btn')?.addEventListener('click', () => {
    if (state.viewMode === 'llm') return;
    if (state.isDeleteMode) exitDeleteMode();
    else enterDeleteMode();
  });
  $('pe-delete-cancel-btn')?.addEventListener('click', exitDeleteMode);
  $('pe-hazard-exit-btn')?.addEventListener('click', exitDeleteMode);
  $('pe-delete-select-all-btn')?.addEventListener('click', toggleSelectAllForDelete);
  $('pe-delete-submit-btn')?.addEventListener('click', e => executeBulkDelete(e.currentTarget));

  // Мобільна навігація між розділами редактора карток (FAB)
  $('pe-fab-back')?.addEventListener('click', () => {
    if (state.mobileCardView === 'form') {
      setMobileCardView('list');
    } else {
      setMobileCardView('categories');
    }
  });

  // Клік на кнопку "Скасувати" у формі повертає до списку карток на мобільних
  document.addEventListener('click', e => {
    const cancelBtn = e.target.closest('[data-cata-action="cancel"], [data-dyn-action="cancel"]');
    if (cancelBtn) {
      setMobileCardView('list');
    }
  });

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
  });

  // Кнопка та меню сортування карток
  const sortBtn = $('pe-sort-btn');
  const sortMenu = $('pe-sort-menu');

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
  });

  sortBtn?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (sortMenu?.hidden) {
        e.preventDefault();
        sortMenu.hidden = false;
        sortBtn.setAttribute('aria-expanded', 'true');
        sortMenu.querySelector('.pe-sort-menu__item')?.focus();
      }
    }
  });

  sortMenu?.addEventListener('click', e => {
    const item = e.target.closest('[data-sort-dir]');
    if (!item) return;
    const dir = item.dataset.sortDir || 'none';
    closeSortMenu();
    applyCardSort(dir);
    sortBtn?.focus();
  });

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
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#pe-sort-wrap')) {
      closeSortMenu();
    }
  });

  $('pe-stages-nav')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-stage-tab]');
    if (!btn) return;
    const key = btn.dataset.stageTab;
    document.querySelectorAll('#pe-stages-nav [data-stage-tab]').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('#pe-stages [data-stage-group]').forEach(group => {
      group.classList.toggle('is-active-mobile', group.dataset.stageGroup === key);
    });
  });

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
    const stepperBtn = e.target.closest('.pe-stepper__btn');
    if (stepperBtn) {
      const stepper = stepperBtn.closest('.pe-stepper');
      const numInput = stepper?.querySelector('input[type="number"]');
      if (numInput && !numInput.disabled) {
        if (stepperBtn.dataset.step === 'up') numInput.stepUp();
        else numInput.stepDown();
        numInput.dispatchEvent(new Event('input', { bubbles: true }));
        numInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    const selectBtn = e.target.closest('.pe-select-custom__btn');
    if (selectBtn) {
      const wrap = selectBtn.closest('.pe-select-custom');
      const dropdown = wrap?.querySelector('.pe-select-custom__dropdown');
      if (dropdown) {
        const isOpening = dropdown.hidden;
        document.querySelectorAll('.pe-select-custom__dropdown').forEach(d => { d.hidden = true; });
        document.querySelectorAll('.pe-select-custom__btn').forEach(b => { 
          b.classList.remove('is-open');
          b.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });

        dropdown.hidden = !isOpening;
        selectBtn.classList.toggle('is-open', isOpening);
        selectBtn.setAttribute('aria-expanded', String(isOpening));
      }
      return;
    }

    const selectItem = e.target.closest('.pe-select-custom__item');
    if (selectItem) {
      const wrap = selectItem.closest('.pe-select-custom');
      const hiddenSelect = wrap?.querySelector('.pe-hidden-select');
      const val = selectItem.dataset.value;
      if (hiddenSelect) {
        hiddenSelect.value = val;
        syncCustomSelect(hiddenSelect);
        hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
        hiddenSelect.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const dropdown = wrap?.querySelector('.pe-select-custom__dropdown');
      const btn = wrap?.querySelector('.pe-select-custom__btn');
      if (dropdown) dropdown.hidden = true;
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    if (!e.target.closest('.pe-select-custom')) {
      document.querySelectorAll('.pe-select-custom__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.pe-select-custom__btn').forEach(b => { 
        b.classList.remove('is-open');
        b.setAttribute('aria-expanded', 'false');
      });
    }

    if (!e.target.closest('.pe-combo')) {
      document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.pe-combo__toggle').forEach(t => { t.classList.remove('is-open'); });
    }
  });

  document.addEventListener('keydown', onEditorKeydown);


  try {
    // Базовий пак редагує лише адмін: перевіряємо ще до завантаження даних (статус кешується в packs-store.js; дублює перевірку в getPack)
    if (state.packId === DEFAULT_PACK_ID && !(await checkIsAdmin())) {
      showGlobalToast('Дефолтний пак не можна редагувати');
      goToList();
      return;
    }

    // Новий пак при вичерпаному ліміті не відкриваємо (збереження теж перевіряє ліміт). Збій самого підрахунку редактор не блокує.
    if (!state.packId && await countPersonalPacks().then(n => n >= MAX_PERSONAL_PACKS, () => false)) {
      showGlobalToast(PACK_LIMIT_MESSAGE);
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
  updateSortBtnUi();
  initMobileNav();
  if (!state.packId) ui.focusTitle();

  // Автосейв чернеток, Undo/Redo, гарячі клавіші, банер відновлення. Після завантаження даних: базова лінія історії = початковий стан
  await initAutosave({ syncFieldsFromForm, exitDeleteMode });
}

export function cleanupPackEditor() {
  destroyAutosave(); // спершу: зберігає чернетку при виході, поки стан ще не скинуто
  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('keydown', onEditorKeydown);
  ui.destroyStageSortables();
  state.isSaving = false;
  state.isConfirming = false;
  state.isDeleteMode = false;
  state.cardsSortDir = 'none';
  state.selectedDeleteIndices.clear();
}