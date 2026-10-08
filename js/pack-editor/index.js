import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, getPromptForCategory } from './categories.js';
import { parseLines, oneLine, parseCards, cardToLine } from './parser.js';
import {
  buildCardRows, MAX_PACK_CARDS, RANGE_DEFAULTS,
  validateTitle, validateRanges, stagesTextFromConfig, rangesFromConfig, buildPackConfig, normalizeForm,
  cataclysmNamesText, cataFieldStrings, hasCataDraft, validateCataclysmInput
} from './payload.js';
import { tokenize, cataMatches, collectSearchResults } from './search.js';
import { getPack, savePack, getDefaultPackConfig, checkIsAdmin, DEFAULT_PACK_ID } from '../services/packs-store.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import * as ui from './ui.js';
import { $ } from './ui.js';

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

function getPackIdFromHash() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
}

// ----- Допоміжні -----
// Зайві пробіли та порожні рядки змінами не вважаються (нормалізація — pack-payload.js)
const isDirty = () => normalizeForm(state.form) !== normalizeForm(state.initialForm);
const isFormEmpty = () => normalizeForm(state.form) === normalizeForm(blankForm());

// Фінальний config для збереження (логіка злиття — buildPackConfig у pack-payload.js)
const buildConfig = () => buildPackConfig({ defaultConfig: state.defaultConfig, packConfig: state.packConfig, stages: state.form.stages, ranges: state.form.ranges });

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

// ----- Пошук по характеристиках -----
// Один рядок пошуку на всі категорії (логіка збігів — pack-search.js). Дві поведінки залежно від того, де шукаємо:
//  • категорія "Катаклізм" (лише активна): фільтрується сам список катаклізмів (renderCataList) за назвою й описом;
//  • решта (текстові категорії, або будь-яка, якщо увімкнено "У всіх категоріях"): під полем будується список знайдених рядків.
// Клік по результату перемикає категорію, виділяє рядок у textarea (або відкриває катаклізм у формі).
const searchTokens = () => tokenize(state.searchQuery);

// Фільтр самого списку катаклізмів діє, лише коли шукаємо в активній категорії "Катаклізм"
const cataFilterActive = () => state.activeCategory === 'cataclysm' && !state.searchAll && searchTokens().length > 0;

// Перемальовує панель результатів, лічильник і кнопку "×" за станом (state.searchQuery / state.searchAll / state.activeCategory / state.form)
function renderSearch() {
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

function setSearchQuery(value, { focus = false } = {}) {
  state.searchQuery = value;
  ui.setSearchInput(value);
  renderList();
  renderSearch();
  if (focus) ui.focusSearchInput();
}

// Результат-рядок: переходимо в його категорію, виділяємо рядок у textarea й прокручуємо до нього
function openTextResult(category, lineIndex) {
  if (category !== state.activeCategory) selectCategory(category);

  if (state.viewMode === 'visual' && CATEGORY_SCHEMAS[category]) {
    const cards = getDynamicCards();
    if (!cards[lineIndex]) {
      showGlobalToast('Рядок змінився — виберіть результат ще раз');
      renderSearch();
      return;
    }
    if (typeof dynDraftPending === 'function' && dynDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startDynEdit(lineIndex, cards[lineIndex]);
  } else {
    if (!ui.selectCardsLine(lineIndex)) {
      showGlobalToast('Рядок змінився — виберіть результат ще раз');
      renderSearch();
    }
  }
}

// Результат-катаклізм: відкриваємо його у формі (з тим самим захистом від втрати незбереженого, що й у кліку по списку)
function openCataResult(index) {
  if (state.activeCategory !== 'cataclysm') selectCategory('cataclysm');
  if (!state.form.cataclysms[index]) return;
  if (index !== state.cataEditIndex) {
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      // ui.scrollCataFormIntoView();
      return;
    }
    startCataEdit(index);
    return;
  }
  // ui.scrollCataFormIntoView();
}

function onSearchResultClick(e) {
  const row = e.target.closest('.pe-result');
  if (!row) return;
  if (row.dataset.resCata !== undefined) openCataResult(Number(row.dataset.resCata));
  else openTextResult(row.dataset.resCat, Number(row.dataset.resLine));
}

function onSearchKeydown(e) {
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
function onSearchListKeydown(e) {
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

function initSearch() {
  ui.initSearchControls({ query: state.searchQuery, all: state.searchAll });
  const searchInput = $('pe-search');
  searchInput.addEventListener('input', e => setSearchQuery(e.target.value));
  searchInput.addEventListener('keydown', onSearchKeydown);
  $('pe-search-clear').addEventListener('click', () => setSearchQuery('', { focus: true }));

  // Клік мишею/тапом по «×» або чекбоксу всередині поля не має відбирати фокус у поля вводу: інакше воно на мить втрачає
  // фокус (зникає світіння рамки, тьмяніє лупа), а потім фокус стрибає назад — це й було миготінням.
  // preventDefault на mousedown лишає фокус в інпуті (сам click і перемикання чекбокса працюють як раніше).
  // Деякі браузери при кліку по label усе одно переводять фокус на чекбокс, тому після change повертаємо його в поле.
  // Клавіатурна навігація (Tab / Space) не зачеплена: прапорець виставляється лише від миші.
  let searchHadFocus = false;
  document.querySelector('.pe-search__inside')?.addEventListener('mousedown', e => {
    searchHadFocus = document.activeElement === searchInput;
    if (!searchHadFocus) return;
    e.preventDefault();
    // Прапорець скидаємо одразу після відпускання кнопки (click і change спрацьовують до цього таймера), навіть якщо курсор зсунули повз
    window.addEventListener('mouseup', () => setTimeout(() => { searchHadFocus = false; }), { once: true });
  });

  $('pe-search-all').addEventListener('change', e => {
    state.searchAll = e.target.checked;
    renderList();
    renderSearch();
    if (searchHadFocus) searchInput.focus({ preventScroll: true }); // курсор лишається там, де був
  });
  const results = $('pe-search-results');
  results.addEventListener('click', onSearchResultClick);
  results.addEventListener('keydown', onSearchListKeydown);
  $('pe-cata-list').addEventListener('keydown', onSearchListKeydown);
}

// ----- Катаклізми: список рядків (.added-item-row) + форма під ним -----
// Джерело істини — state.form.cataclysms (записи з pack-payload.js). Текст у textarea лише відображає їхні назви (по одній на рядок),
// тому змінити катаклізм можна лише через форму: клік по назві → поля заповнюються → "Зберегти зміни" або "Видалити".

// Текст списку (назви по одній на рядок) усередині state.form.texts.cataclysm: з нього читаються лічильники, підсумок і трекінг змін
function syncCataText(f = state.form) {
  f.texts.cataclysm = cataclysmNamesText(f.cataclysms);
}

// Чи є у формі дані, які ще не потрапили в список (новий катаклізм або незбережені правки існуючого).
// Захист від втрати: без нього "Оновити пак" або клік по іншому катаклізму мовчки відкинули б заповнене.
const cataDraftPending = () => hasCataDraft(ui.readCataRaw(), state.form.cataclysms[state.cataEditIndex], state.cataEditIndex >= 0);

function renderCataList() {
  ui.renderCataList({
    cataclysms: state.form.cataclysms,
    editIndex: state.cataEditIndex,
    newIndex: state.newCataIndex,
    tokens: cataFilterActive() ? searchTokens() : []
  });
}

function getDynamicCards() {
  if (state.activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[state.activeCategory]) return [];
  return parseCards(state.form.texts[state.activeCategory] || '', state.activeCategory, state.extraMeta);
}

function renderList() {
  if (state.activeCategory === 'cataclysm') {
    renderCataList();
  } else if (CATEGORY_SCHEMAS[state.activeCategory] && state.viewMode === 'visual') {
    const cards = getDynamicCards();
    ui.renderCataList({
      cataclysms: cards.map(c => ({ name: c.value })),
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

// Режим форми: -1 — додавання нового, ≥ 0 — редагування існуючого
function setCataMode(index) {
  state.cataEditIndex = index;
  ui.paintCataMode(index >= 0 ? state.form.cataclysms[index] : null);
  renderList();
}

// Очищає поля і повертає форму в режим "додати"
function resetCataForm() {
  ui.clearCataFields();
  ui.showCataError('');
  setCataMode(-1);
}

// Після будь-якої зміни списку: перемальовуємо поле-список, лічильники, підсумок і стан кнопок "Скасувати зміни"/"Очистити все"
function applyCataChange({ scrollToEnd = false } = {}) {
  syncCataText();
  renderList();
  if (scrollToEnd) ui.scrollCataListToEnd();
  renderSearch();
  updateCardsMeta();
  
  renderSummary();
  updateButtons();
}

// "Додати" / "Зберегти зміни" — залежно від режиму форми. Після успіху дані з’являються в полі-списку, а поля форми очищаються.
function submitCata() {
  const result = validateCataclysmInput(ui.readCataRaw(), { cataclysms: state.form.cataclysms, editIndex: state.cataEditIndex });
  if (result.error) {
    ui.showCataError(result.error, result.field);
    return;
  }

  const existing = state.cataEditIndex >= 0 ? state.form.cataclysms[state.cataEditIndex] : null;
  if (existing) {
    // Додаткова meta цього катаклізму, якої форма не показує, лишається правою
    state.form.cataclysms[state.cataEditIndex] = { ...result.item, extra: existing.extra || {} };
  } else {
    state.form.cataclysms.push(result.item);
  }

  applyCataChange();
  resetCataForm();

  // Новий рядок з’являється з анімацією: клас is-new діє лише на цей рендер (далі перемальовки його вже не мають)
  if (!existing) {
    state.newCataIndex = state.form.cataclysms.length - 1;
    renderList();
    state.newCataIndex = -1;
    ui.scrollCataListToEnd();
  }
  showGlobalToast(existing ? 'Катаклізм оновлено' : 'Катаклізм додано');
  $(ui.CATA_FIELDS.name)?.focus();
}

// Клік по назві у списку → поля форми заповнюються даними цього катаклізму
function startCataEdit(index) {
  const item = state.form.cataclysms[index];
  if (!item) return;
  ui.fillCataFields(cataFieldStrings(item));
  ui.showCataError('');
  setCataMode(index);
  $(ui.CATA_FIELDS.name)?.focus({ preventScroll: true });
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

async function deleteCata(btn) {
  const item = state.cataEditIndex >= 0 ? state.form.cataclysms[state.cataEditIndex] : null;
  if (!item || state.isConfirming) return;

  state.isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити катаклізм "${oneLine(item.name)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    state.isConfirming = false;
  }
  if (!confirmed) return;

  // Після await індекс міг змінитися (наприклад, "Очистити все"), тому шукаємо запис за посиланням
  const index = state.form.cataclysms.indexOf(item);
  if (index < 0) return;
  state.form.cataclysms.splice(index, 1);

  applyCataChange();
  resetCataForm();
  showGlobalToast('Катаклізм видалено');
}

function handleCataClick(e) {
  const btn = e.target.closest('[data-cata-action]');
  if (!btn || btn.disabled) return;

  switch (btn.dataset.cataAction) {
    case 'submit': submitCata(); break;
    case 'cancel': resetCataForm(); break;
    case 'delete': deleteCata(btn); break;
  }
}

// Числові поля приймають лише цифри (і при вставці "50 000" → 50000); правка поля прибирає попередню помилку
function handleCataInput(e) {
  ui.sanitizeCataNumericInput(e.target);
  if (ui.isCataErrorVisible()) ui.showCataError('');
}


// ----- Динамічні форми -----

function dynDraftPending() {
  if (state.activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[state.activeCategory] || state.viewMode !== 'visual') return false;
  const current = readDynRaw();
  if (!current.value && Object.values(current).every(v => !v || (Array.isArray(v) && !v.length))) return false;
  
  if (state.dynEditIndex < 0) return true;
  
  const cards = getDynamicCards();
  const item = cards[state.dynEditIndex];
  if (!item) return false;
  
  if (current.value !== item.value) return true;
  for (const f of CATEGORY_SCHEMAS[state.activeCategory].fields) {
    const v1 = current[f.key];
    const v2 = item.meta[f.key];
    if (f.type === 'checkbox') {
      if (Boolean(v1) !== Boolean(v2)) return true;
    } else if (f.type === 'list') {
      if ((v1 || []).join('\n') !== (v2 || []).join('\n')) return true;
    } else {
      if ((v1 || '') !== (v2 || '')) return true;
    }
  }
  return false;
}

function readDynRaw() {
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (!schema) return {};
  const data = {};
  data.value = $('pe-dyn-name').value.trim();
  for (const f of schema.fields) {
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) {
      if (f.type === 'checkbox') data[f.key] = el.checked;
      else if (f.type === 'list') data[f.key] = parseLines(el.value);
      else data[f.key] = el.value.trim();
    }
  }
  return data;
}

function fillDynFields(card) {
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (!schema) return;
  $('pe-dyn-name').value = card.value;
  for (const f of schema.fields) {
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) {
      const val = card.meta[f.key];
      if (f.type === 'checkbox') el.checked = Boolean(val);
      else if (f.type === 'list') el.value = Array.isArray(val) ? val.join('\n') : '';
      else el.value = val || '';
    }
  }
}

function setDynMode(index) {
  state.dynEditIndex = index;
  const cards = getDynamicCards();
  const item = index >= 0 ? cards[index] : null;
  const submitBtn = document.querySelector('[data-dyn-action="submit"]');
  if (submitBtn) submitBtn.textContent = item ? 'Зберегти зміни' : 'Додати';
  
  const cancelBtn = document.querySelector('[data-dyn-action="cancel"]');
  if (cancelBtn) cancelBtn.hidden = !item;
  
  const deleteBtn = document.querySelector('[data-dyn-action="delete"]');
  if (deleteBtn) deleteBtn.hidden = !item;
  
  const modeEl = $('pe-dyn-mode');
  if (modeEl) modeEl.textContent = item ? `Редагування: "${oneLine(item.value)}"` : 'Нова картка';
  
  renderList();
}

function updateDynFormState() {
  if (state.activeCategory !== 'body_type') return;
  const noHeight = $('pe-dyn-has_no_height')?.checked;
  const mode = $('pe-dyn-custom_height_mode')?.value;
  
  const toggleField = (key, enabled) => {
    const el = $(`pe-dyn-${key}`);
    if (el) {
      el.disabled = !enabled;
      el.closest('.pe-field').style.display = enabled ? '' : 'none';
      if (!enabled) {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
      }
    }
  };

  if (noHeight) {
    toggleField('custom_height_mode', false);
    toggleField('height_min', false);
    toggleField('height_max', false);
    toggleField('exact_height', false);
  } else {
    toggleField('custom_height_mode', true);
    if (mode === 'range') {
      toggleField('height_min', true);
      toggleField('height_max', true);
      toggleField('exact_height', false);
    } else if (mode === 'exact') {
      toggleField('height_min', false);
      toggleField('height_max', false);
      toggleField('exact_height', true);
    } else {
      toggleField('height_min', false);
      toggleField('height_max', false);
      toggleField('exact_height', false);
    }
  }
}

function startDynEdit(index, card) {
  fillDynFields(card);
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  setDynMode(index);
  updateDynFormState();
  $('pe-dynamic-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('pe-dyn-name')?.focus({ preventScroll: true });
}

function resetDynForm() {
  $('pe-dyn-name').value = '';
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (schema) {
    for (const f of schema.fields) {
      const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
      if (el) {
        if (f.type === 'checkbox') el.checked = false;
        else el.value = '';
      }
    }
  }
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  setDynMode(-1);
  updateDynFormState();
}

function applyDynChange({ scrollToEnd = false } = {}) {
  ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });
  renderList();
  if (scrollToEnd) $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
  renderSearch();
  updateCardsMeta();
  
  renderSummary();
  updateButtons();
}

function submitDyn() {
  const data = readDynRaw();
  const isEdit = state.dynEditIndex >= 0;
  if (!data.value) {
    const err = $('pe-dyn-error');
    err.textContent = 'Назва обов\'язкова';
    err.hidden = false;
    $('pe-dyn-name').focus();
    return;
  }
  
  const cards = getDynamicCards();
  const meta = { ...data };
  delete meta.value;
  
  for (const k of Object.keys(meta)) {
    if (meta[k] === '' || (Array.isArray(meta[k]) && meta[k].length === 0)) {
      delete meta[k];
    }
  }

    let oldOpposite = null;
    if (state.activeCategory === 'gender') {
      if (state.dynEditIndex >= 0) oldOpposite = cards[state.dynEditIndex].meta.opposite;
      const targetName = meta.opposite;
      const currentName = data.value;
      if (targetName) {
        if (targetName === currentName) {
          const err = document.getElementById('pe-dyn-error');
          err.textContent = "Стать не може бути протилежною сама собі.";
          err.hidden = false;
          return;
        }
        let targetIndex = cards.findIndex(c => c.value === targetName);
        if (targetIndex >= 0) {
          const targetOpposite = cards[targetIndex].meta.opposite;
          if (targetOpposite && targetOpposite !== currentName) {
            const err = document.getElementById('pe-dyn-error');
            err.textContent = `Стать "${targetName}" вже має протилежну стать "${targetOpposite}".`;
            err.hidden = false;
            return;
          }
        }
      }
    }

  
  if (state.dynEditIndex >= 0) {
    cards[state.dynEditIndex] = { value: data.value, meta };
  } else {
    cards.push({ value: data.value, meta });
    state.newDynIndex = cards.length - 1;
  }

    if (state.activeCategory === 'gender') {
      const targetName = meta.opposite;
      const currentName = data.value;
      if (oldOpposite && oldOpposite !== targetName) {
        let oldIndex = cards.findIndex(c => c.value === oldOpposite);
        if (oldIndex >= 0 && cards[oldIndex].meta.opposite === currentName) {
          delete cards[oldIndex].meta.opposite;
        }
      }
      if (targetName) {
        let targetIndex = cards.findIndex(c => c.value === targetName);
        if (targetIndex >= 0) {
          cards[targetIndex].meta.opposite = currentName;
        } else {
          cards.push({ value: targetName, meta: { opposite: currentName } });
        }
      }
    }

  
  state.form.texts[state.activeCategory] = cards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');
  
  applyDynChange({ scrollToEnd: state.newDynIndex >= 0 });
  resetDynForm();
  
  if (state.newDynIndex >= 0) {
    state.newDynIndex = -1;
  }
  showGlobalToast(isEdit ? 'Картку оновлено' : 'Картку додано');
  $('pe-dyn-name')?.focus();
}

async function deleteDyn(btn) {
  if (state.dynEditIndex < 0 || state.isConfirming) return;
  const cards = getDynamicCards();
  const item = cards[state.dynEditIndex];
  
  state.isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити картку "${oneLine(item.value)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    state.isConfirming = false;
  }
  if (!confirmed) return;

  cards.splice(state.dynEditIndex, 1);
  state.form.texts[state.activeCategory] = cards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');
  
  applyDynChange();
  resetDynForm();
  showGlobalToast('Картку видалено');
}

function handleDynClick(e) {
  const btn = e.target.closest('[data-dyn-action]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.dynAction) {
    case 'submit': submitDyn(); break;
    case 'cancel': resetDynForm(); break;
    case 'delete': deleteDyn(btn); break;
  }
}

// ----- Дії -----
async function confirmAction(actionLabel, anchor) {
  if (state.isConfirming) return false;
  state.isConfirming = true;
  try {
    return await showPackConfirm(`Чи точно хочете ${actionLabel}? ${UNSAVED_NOTE}`, anchor, { confirmLabel: 'Підтвердити' });
  } finally {
    state.isConfirming = false;
  }
}

function goToList() {
  state.allowLeave = true;
  window.location.hash = '#/packs';
}

async function handleSave(btn) {
  if (state.isSaving) return;

  const title = state.form.title.trim();
  const error = validateTitle(title, { isDefaultPack: state.packId === DEFAULT_PACK_ID });
  if (error) {
    ui.showTitleError(error);
    ui.focusTitle();
    return;
  }

  const rangeError = validateRanges(state.form.ranges);
  if (rangeError) {
    showGlobalToast(rangeError);
    return;
  }

  // Заповнену, але не додану форму катаклізму не зберігаємо мовчки разом з паком — автор має спочатку натиснути "Додати" або "Скасувати"
  if (cataDraftPending()) {
    showGlobalToast('У формі катаклізму є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }
  
  if (typeof dynDraftPending === 'function' && dynDraftPending()) {
    showGlobalToast('У формі характеристики є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }

  // 3.3: рядки масового вводу → [{ pool_type, category, value, meta }] (розбір тексту — pack-parser.js)
  const cards = buildCardRows(state.form.texts, state.extraMeta, state.form.cataclysms);
  if (cards.length > MAX_PACK_CARDS) {
    showGlobalToast(`Забагато характеристик: ${cards.length}. Максимум — ${MAX_PACK_CARDS}`);
    return;
  }

  const isEdit = Boolean(state.packId);
  const originalLabel = btn.textContent;
  state.isSaving = true;
  ui.setButtonState(btn, { disabled: true, text: 'Збереження...' });

  try {
    await savePack({
      id: state.packId,
      title,
      description: state.form.description.trim(),
      config: buildConfig(),
      cards
    });
    showGlobalToast(isEdit ? 'Пак оновлено' : 'Пак створено');
    goToList();
  } catch (err) {
    console.error('Не вдалося зберегти пак:', err);
    showGlobalToast(err.message || 'Не вдалося зберегти пак');
    ui.setButtonState(btn, { disabled: false, text: originalLabel });
  } finally {
    state.isSaving = false;
  }
}

async function handleClear(btn) {
  if (!(await confirmAction('очистити все', btn))) return;
  state.form = blankForm();
  state.extraMeta = {}; // очищені картки не мають підтягувати стару додаткову meta, якщо автор введе ту саму назву заново
  syncFieldsFromForm();
  showGlobalToast('Форму очищено');
}

async function handleReset(btn) {
  if (!(await confirmAction('скасувати зміни', btn))) return;
  state.form = cloneForm(state.initialForm);
  syncFieldsFromForm();
  showGlobalToast('Зміни скасовано');
}

async function handleExit(btn) {
  // Без змін питати нема про що: попередження "зміни будуть втрачені" було б неправдою
  if (isDirty() && !(await confirmAction(btn.textContent.trim().toLowerCase(), btn))) return;
  goToList();
}

function handleActionsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;

  switch (btn.dataset.action) {
    case 'save':  handleSave(btn); break;
    case 'clear': handleClear(btn); break;
    case 'reset': handleReset(btn); break;
    case 'exit':  handleExit(btn); break;
  }
}

function onBeforeUnload(e) {
  if (!state.allowLeave && isDirty()) {
    e.preventDefault();
    e.returnValue = ''; // потрібно для Chrome
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


function updateComboDropdown(input, forceShowAll = false) {
  const list = input.parentElement.querySelector('.pe-combo__dropdown');
  if (!list) return;
  const cards = getDynamicCards();
  const nameEl = document.getElementById('pe-dyn-name');
  const currentName = nameEl ? nameEl.value : '';
  let options = cards.map(c => c.value);
  if (currentName) options = options.filter(o => o !== currentName);
  
  const filter = forceShowAll ? '' : input.value.toLowerCase();
  const filtered = options.filter(o => o.toLowerCase().includes(filter));
  
  if (filtered.length === 0) {
    list.innerHTML = '<div class="pe-combo__empty">Введіть нове значення</div>';
  } else {
    list.innerHTML = filtered.map(o => `<div class="pe-combo__item" data-val="${o.replace(/"/g, '&quot;')}">${o.replace(/</g, '&lt;')}</div>`).join('');
  }
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
    ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });
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