import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, getPromptForCategory } from './categories.js';
import { parseLines, oneLine, parseCards, cardToLine, hasExplanationField, splitNameExplanation } from './parser.js';
import { stagesTextFromConfig, rangesFromConfig, RANGE_DEFAULTS } from './payload.js';
import { getPack, getDefaultPackConfig, checkIsAdmin, DEFAULT_PACK_ID } from '../services/packs-store.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import * as ui from './ui/index.js';
import { $ } from './ui/helpers.js';
import {
  getPackIdFromHash, isDirty, confirmAction, goToList, onBeforeUnload,
  syncCataText, cataDraftPending, renderCataList, setCataMode, resetCataForm,
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
} from './controllers/index.js';

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

const renderSummary = () => ui.renderSummary(categoryCounts(), state.activeCategory);
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
  state.activeCategory = category;
  state.viewMode = 'visual';
  
  ui.showCategory({ category, text: state.form.texts[category] || '', viewMode: state.viewMode });
  
  resetCataForm();
  resetDynForm();
  
  renderSearch();
  updateCardsMeta();
  renderSummary();
}

// Повністю перемальовує значення полів зі стану (після "Очистити все" / "Скасувати зміни" / завантаження пака)
function syncFieldsFromForm() {
  ui.fillFields(state.form);
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
  startDynEdit: (idx, card) => startDynEdit(idx, card)
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
    if (state.activeCategory === 'gender') {
      const datalist = document.getElementById('pe-dyn-opposite-list');
      if (datalist) {
        datalist.innerHTML = cards.map(c => '<option value="' + c.value.replace(/"/g, '&quot;') + '">').join('');
      }
    }
  }
}


function onCataListClick(e) {
  const row = e.target.closest('[data-cata-index]');
  if (!row) return;
  const index = Number(row.dataset.cataIndex);

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
  state.isSaving = false;
  state.isConfirming = false;
  state.allowLeave = false;
  state.cataEditIndex = -1;
  state.newCataIndex = -1;

  state.searchQuery = '';
  state.searchAll = false;

  window.addEventListener('beforeunload', onBeforeUnload);

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
  
  $('pe-dynamic-form').addEventListener('click', handleDynClick);
  $('pe-dynamic-form').addEventListener('change', e => {
    updateDynFormState();
  });
  $('pe-dynamic-form').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      submitDyn();
    }
  });

  $('pe-cata').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.preventDefault();
      submitCata();
    }
  });
  
  $('pe-llm-mode')?.addEventListener('change', e => {
    state.viewMode = e.target.checked ? 'llm' : 'visual';
    ui.setLlmCopyVisible(e.target.checked); // кнопка копіювання з'являється лише в режимі LLM
    
    // Синхронізація Cataclysms при перемиканні режимів
    if (state.activeCategory === 'cataclysm') {
      if (state.viewMode === 'visual') {
        const parsed = parseCards(state.form.texts.cataclysm, 'cataclysm');
        state.form.cataclysms = parsed.map(c => ({
          name: c.value,
          description: c.meta.description || '',
          timer_minutes: c.meta.timer_minutes || 0,
          stay_time_months: c.meta.stay_time_months || null,
          population: c.meta.population || null,
          extra: c.meta.extra || {}
        })).filter(c => c.name);
      } else {
        state.form.texts.cataclysm = state.form.cataclysms.map(c => cardToLine('cataclysm', c.name, {
          description: c.description,
          timer_minutes: c.timer_minutes,
          stay_time_months: c.stay_time_months,
          population: c.population
        })).join('\n');
      }
    }
    
    ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });
    
    if (state.viewMode === 'visual' && state.activeCategory !== 'cataclysm' && state.dynEditIndex >= 0) {
      const cards = getDynamicCards();
      if (cards[state.dynEditIndex]) {
        fillDynFields(cards[state.dynEditIndex]);
        updateDynFormState();
      } else {
        resetDynForm();
        setDynMode(-1);
      }
    }
    
    renderList();
    renderSearch();
    updateCardsMeta();
  });
  
  $('pe-llm-copy')?.addEventListener('click', async () => {
    const prompt = getPromptForCategory(state.activeCategory);
    if (prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
        showGlobalToast('Промпт для LLM скопійовано');
      } catch (err) {
        showGlobalToast('Не вдалося скопіювати промпт');
      }
    } else {
      showGlobalToast('Промпт для цієї категорії відсутній');
    }
  });

  $('pe-cards').addEventListener('input', e => {
    if (state.activeCategory === 'cataclysm') return; // список катаклізмів не редагується текстом
    state.form.texts[state.activeCategory] = e.target.value;
    debouncedCardUpdates();
  });

  $('pe-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) selectCategory(chip.dataset.chip);
  });

  $('pe-stages').addEventListener('input', e => {
    const stageField = e.target.closest('[data-stage]');
    if (stageField) {
      state.form.stages[stageField.dataset.stage] = stageField.value;
      updateButtons();
      return;
    }
    const rangeField = e.target.closest('[data-range]');
    if (rangeField) {
      state.form.ranges[rangeField.dataset.range] = rangeField.value;
      updateButtons();
    }
  });


  $('pe-ranges').addEventListener('input', e => {
    const field = e.target.closest('[data-range]');
    if (!field) return;
    state.form.ranges[field.dataset.range] = field.value;
    updateButtons();
  });

  initSearch();


  $('pe-actions').addEventListener('click', handleActionsClick);

  const dynForm = document.getElementById('pe-dynamic-form');
  if (dynForm) {
    dynForm.addEventListener('input', e => {
      if (e.target.classList.contains('pe-combo__input')) {
        const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
        list.hidden = false;
        updateComboDropdown(e.target);
      }
    });

    dynForm.addEventListener('focusin', e => {
      if (e.target.classList.contains('pe-combo__input')) {
        const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
        list.hidden = false;
        updateComboDropdown(e.target);
      }
    });

    dynForm.addEventListener('click', e => {
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
      }
    });
  }

  document.getElementById('pe-root')?.addEventListener('click', e => {
    if (!e.target.closest('.pe-combo')) {
      document.querySelectorAll('.pe-combo__dropdown').forEach(d => d.hidden = true);
    }
  });

  document.getElementById('pe-root')?.addEventListener('keydown', e => {
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
  state.isSaving = false;
  state.isConfirming = false;
}