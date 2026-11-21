import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, POOL_TYPE_BY_CATEGORY } from './categories.js';
import { parseLines, hasExplanationField, splitNameExplanation, reconcileCards, cardToLine } from './parser.js';
import { stagesTextFromConfig, rangesFromConfig, RANGE_DEFAULTS, cataclysmToRow, canonicalCardSnapshot } from './payload.js';
import {
  getPack, getDefaultPackConfig, checkIsAdmin, DEFAULT_PACK_ID,
  countPersonalPacks, MAX_PERSONAL_PACKS, PACK_LIMIT_MESSAGE
} from '../services/packs-store.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { isPackNoticeMuted, isPackShortageMuted, setPackShortageMuted } from '../game-modules/overlays/pack-notice.js';
import { findShortByCounts } from '../utils/game/pack-fallback.js';
import { getGameConfigSync } from '../config/config-manager.js';
import { initTips } from './ui/tooltip.js';
import * as ui from './ui/ui.js';
import { initMobileNav, cleanupMobileNav, setMobileCardView } from './controllers/mobile-nav.js';
import { $ } from './ui/helpers.js';
import { initAutosave, destroyAutosave, onEditorChanged, getDraftContext } from './autosave-bridge.js';
import {
  getPackIdFromHash, isDirty, goToList, onBeforeUnload,
  syncCataText, syncCataclysmsFromLlmText, syncCataclysmsToLlmText,
  renderCataList, resetCataForm, setCataChangeHandler,
  getDynamicCards, dynDraftPending, updateDynFormState, startDynEdit, resetDynForm,
  setDynamicOrchestrator, searchTokens, cataFilterActive, renderSearch,
  initSearch, setSearchOrchestrator, isFormEmpty, setSaveOrchestrator, cancelSaveTimers
} from './controllers/controllers.js';
import { createDeleteMode, bindDeleteMode } from './bindings/delete-mode.js';
import { bindFormFields } from './bindings/form-fields.js';
import { bindDynamicForm } from './bindings/dynamic-form.js';
import { bindLlmPanel } from './bindings/llm-panel.js';
import { bindChips } from './bindings/chips.js';
import { bindMobileFab } from './bindings/mobile-fab.js';
import { bindSortMenu } from './bindings/sort-menu.js';
import { bindStagesTabs } from './bindings/stages-tabs.js';
import { bindWidgets } from './bindings/widgets.js';
import { bindEditorKeys } from './bindings/editor-keys.js';

// ===== Сторінка "Редактор пака" (#/pack-editor, редагування — #/pack-editor?id=<uuid>) =====
// Це оркестратор: стан сторінки, валідація і координація
// ("взяли дані з UI → розібрали парсером → відправили в packs-store").
//   • розмітка і робота з DOM — js/pack-editor/ui/ (отримує дані аргументами, стану не знає);
//   • обробники подій по зонах сторінки — js/pack-editor/bindings/ (кожен модуль: bind…(ctx));
//   • розбір тексту на картки — js/pack-editor/parser.js, збирання payload — js/pack-editor/payload.js;
//   • пошук по характеристиках — js/pack-editor/search.js.
// Замість сотні окремих інпутів: випадаючий список категорій + одна велика textarea (одна характеристика на рядок).
// Текст кожної категорії зберігається окремо, тож можна переключатись між категоріями, нічого не втрачаючи.
// Стадії (стаж професії, рівень хобі, ступінь хвороби) — одні на весь пак, зберігаються в packs.config.default_stages.

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
  syncFieldsFromForm: () => syncFieldsFromForm(),
  getDraftContext
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
    state.form.texts[state.activeCategory] = state.cardData[state.activeCategory]
      .map(c => cardToLine(state.activeCategory, c.value, c.meta))
      .join('\n');
  }
  state.activeCategory = category;
  if (state.viewMode === 'llm' && category === 'cataclysm') syncCataclysmsToLlmText();

  ui.showCategory({
    category,
    text: state.form.texts[category] || '',
    viewMode: state.viewMode,
    ageCategoriesText: state.form?.stages?.age_categories || ''
  });

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

function renderList() {
  if (state.activeCategory === 'cataclysm') {
    renderCataList([]);
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
      tokens: [],
      category: state.activeCategory,
      cardsSortDir: state.cardsSortDir,
      isDeleteMode: state.isDeleteMode,
      selectedDeleteIndices: state.selectedDeleteIndices
    });
  }
}

// Контекст для модулів bindings/: функції, що лишаються тут і перемальовують сторінку за станом.
// signal підставляється в initPackEditor на кожну сесію редактора: ним знімаються всі слухачі.
const ctx = {
  signal: null,
  deleteMode: null,
  renderList,
  updateCardsMeta,
  renderSummary,
  updateButtons,
  selectCategory,
  muteShortageForCurrentPack
};
ctx.deleteMode = createDeleteMode(ctx);

// Підключення координатора пошуку
setSearchOrchestrator({
  selectCategory,
  renderList,
  getDynamicCards: () => getDynamicCards(),
  dynDraftPending: () => dynDraftPending(),
  startDynEdit: (idx, card) => startDynEdit(idx, card),
  updateDeleteModeUi: () => ctx.deleteMode.updateUi(),
  enterDeleteMode: (opts) => ctx.deleteMode.enter(opts)
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

// ----- Ініціалізація -----
async function loadPackIntoForm(id, isStale = () => false) {
  const pack = await getPack(id);
  if (isStale()) return false;
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
      state.initialCardMap.set(c.id, canonicalCardSnapshot({ pool_type: poolType, category, value: c.value, meta: c.meta || {} }));
    }
  }

  for (const cata of pack.cataclysms || []) {
    if (cata.id) {
      const row = cataclysmToRow(cata);
      state.initialCardMap.set(cata.id, canonicalCardSnapshot(row));
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

// Скидає стан сторінки до початкового (новий пак або відкриття існуючого)
function resetEditorState() {
  state.sessionId++;
  state.packId = getPackIdFromHash();
  state.newPackId = state.packId ? null : crypto.randomUUID();
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
  state.searchNamesOnly = false;
  state.searchWholeWord = false;
  state.searchCustomOnly = false;
  state.searchOverlayDismissed = false;
}

// Завантажує дані редактора; false — користувача вже перенаправлено (немає прав, ліміт, помилка, застаріла сесія)
async function loadEditorData({ sessionId, signal, packId }) {
  const isStale = () => state.sessionId !== sessionId || signal.aborted;
  try {
    // Базовий пак редагує лише адмін: перевіряємо ще до завантаження даних (статус кешується в packs-store.js; дублює перевірку в getPack)
    if (packId === DEFAULT_PACK_ID) {
      const isAdmin = await checkIsAdmin();
      if (isStale()) return false;
      if (!isAdmin) {
        showGlobalToast('Дефолтний пак не можна редагувати');
        goToList();
        return false;
      }
    }

    // Новий пак при вичерпаному ліміті не відкриваємо (збереження теж перевіряє ліміт). Збій самого підрахунку редактор не блокує.
    if (!packId) {
      const overLimit = await countPersonalPacks().then(n => n >= MAX_PERSONAL_PACKS, () => false);
      if (isStale()) return false;
      if (overLimit) {
        showGlobalToast(PACK_LIMIT_MESSAGE);
        goToList();
        return false;
      }
    }

    // Конфіг дефолтного пака потрібен в обох режимах: без нього не зібрати повний config (age_range, height_range...)
    const defaultConfig = await getDefaultPackConfig();
    if (isStale()) return false;
    state.defaultConfig = defaultConfig;
    state.baseStages = stagesTextFromConfig(state.defaultConfig);
    state.baseRanges = rangesFromConfig(state.defaultConfig, RANGE_DEFAULTS);

    if (packId) {
      const loaded = await loadPackIntoForm(packId, isStale);
      if (isStale() || !loaded) return false;
    } else {
      state.form = blankForm();
      state.initialForm = cloneForm(state.form);
    }
  } catch (err) {
    if (isStale()) return false;
    console.error('Не вдалося завантажити дані редактора:', err);
    showGlobalToast(err.message || 'Не вдалося завантажити дані');
    goToList();
    return false;
  }
  return true;
}

let sessionAbortController = null;

export async function initPackEditor() {
  sessionAbortController?.abort();
  sessionAbortController = new AbortController();
  const { signal } = sessionAbortController;
  ctx.signal = signal;

  resetEditorState();
  const sessionId = state.sessionId;
  const packId = state.packId;

  window.addEventListener('beforeunload', onBeforeUnload, { signal });

  // Обробники подій по зонах сторінки (кожен модуль реєструє слухачі через спільний signal)
  bindFormFields(ctx);
  bindDynamicForm(ctx);
  bindLlmPanel(ctx);
  bindChips(ctx);
  bindDeleteMode(ctx);
  bindMobileFab(ctx);
  bindSortMenu(ctx);
  bindStagesTabs(ctx);
  initSearch(signal);
  initTips(signal);
  bindWidgets(ctx);
  bindEditorKeys(ctx);

  if (!(await loadEditorData({ sessionId, signal, packId }))) return;

  // Користувач міг устигнути піти зі сторінки (або перевідкрити редактор), поки вантажились дані
  if (state.sessionId !== sessionId || signal.aborted || !ui.isEditorMounted()) return;
  ui.markEditorLoaded();

  syncFieldsFromForm();
  ui.updateSortBtnUi(state.cardsSortDir);
  initMobileNav();
  if (!packId) ui.focusTitle();

  // Автосейв чернеток, Undo/Redo, гарячі клавіші, банер відновлення. Після завантаження даних: базова лінія історії = початковий стан
  await initAutosave({ syncFieldsFromForm, exitDeleteMode: ctx.deleteMode.exit });
  if (state.sessionId !== sessionId || signal.aborted || !ui.isEditorMounted()) return;

  const launchTour = (force = false) => ui.startPackEditorTour({
    signal,
    force,
    onMobileViewChange: setMobileCardView
  });

  $('pe-tour-start-btn')?.addEventListener('click', () => launchTour(true), { signal });

  const draftModal = $('pe-draft-modal');
  if (draftModal?.open) {
    draftModal.addEventListener('close', () => launchTour(false), { once: true, signal });
  } else {
    launchTour(false);
  }
}

export function cleanupPackEditor() {
  state.sessionId++;
  cancelSaveTimers();
  destroyAutosave(); // спершу: зберігає чернетку при виході, поки стан ще не скинуто
  cleanupMobileNav();
  sessionAbortController?.abort(); // знімає всі слухачі, зареєстровані через signal (window, document і елементи редактора)
  sessionAbortController = null;
  ui.destroyStageSortables();
  state.isSaving = false;
  state.isConfirming = false;
  state.isDeleteMode = false;
  state.cardsSortDir = 'none';
  state.selectedDeleteIndices.clear();
}
