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
let packId = null;          // null = режим створення
let defaultConfig = {};     // packs.config дефолтного пака: основа конфігу, бо рушій вимагає age_range, height_range тощо
let packConfig = {};        // packs.config пака, що редагується (для нового — порожній)
let extraMeta = {};         // meta карток, яких немає в тексті редактора (custom_age, stages...): повертається в картки при збереженні (катаклізми тримають свою extra у самих записах)
let baseStages = {};        // стадії дефолтного пака (текст): те, до чого повертає "Очистити все" і порожнє поле стадій
let baseRanges = {};        // діапазони віку/зросту дефолтного пака (рядки): те, до чого повертає "Очистити все"
let form = { title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: [] }; // texts: { [category]: string }, stages: { [key]: string }, cataclysms: записи катаклізмів (форма в pack-payload.js)
let initialForm = cloneForm(form); // значення на момент відкриття (для "Скасувати зміни" і відстеження змін)
let activeCategory = ALL_PACK_CATEGORIES[0].category;
let viewMode = 'visual';
let dynEditIndex = -1;
let newDynIndex = -1;
let isSaving = false;
let isConfirming = false;
let allowLeave = false;     // після успішного збереження не питаємо браузер "Залишити сторінку?"
let cataEditIndex = -1;     // індекс катаклізму, який зараз редагується у формі під списком; -1 = форма додає новий
let newCataIndex = -1;      // індекс щойно доданого катаклізму: лише на один рендер отримує клас is-new (анімація появи)
let searchQuery = '';       // запит у полі пошуку по характеристиках
let searchAll = false;      // true = шукати у всіх категоріях, false = лише в активній

function blankForm() {
  return { title: '', description: '', texts: {}, stages: { ...baseStages }, ranges: { ...baseRanges }, cataclysms: [] };
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
const isDirty = () => normalizeForm(form) !== normalizeForm(initialForm);
const isFormEmpty = () => normalizeForm(form) === normalizeForm(blankForm());

// Фінальний config для збереження (логіка злиття — buildPackConfig у pack-payload.js)
const buildConfig = () => buildPackConfig({ defaultConfig, packConfig, stages: form.stages, ranges: form.ranges });

// ----- Розмітка -----
export function renderPackEditor() {
  const id = getPackIdFromHash();
  return ui.packEditorTemplate({ isEdit: Boolean(id), isDefaultEdit: id === DEFAULT_PACK_ID });
}

// ----- Оновлення елементів за станом (дані рахуємо тут, малює UI) -----
// { [category]: кількість рядків } для підписів у списку категорій і підсумку
function categoryCounts() {
  const counts = {};
  for (const { category } of ALL_PACK_CATEGORIES) counts[category] = parseLines(form.texts[category]).length;
  return counts;
}

const renderSummary = () => ui.renderSummary(categoryCounts(), activeCategory);
const updateCategoryOptionLabels = () => ui.updateCategoryOptionLabels(categoryCounts());
const updateButtons = () => ui.updateButtons({ dirty: isDirty(), empty: isFormEmpty() });

function updateCardsMeta() {
  const isCata = activeCategory === 'cataclysm';
  let count = 0;
  if (isCata) {
    count = form.cataclysms.length;
  } else if (CATEGORY_SCHEMAS[activeCategory] && viewMode === 'visual') {
    count = getDynamicCards().length;
  } else {
    count = parseLines(ui.getCardsText()).length;
  }
  ui.updateCardsMeta(isCata, count);
}

function selectCategory(category) {
  activeCategory = category;
  viewMode = 'visual';
  dynEditIndex = -1;
  ui.showCategory({ category, text: form.texts[category] || '', viewMode });
  renderList();
  renderSearch();
  updateCardsMeta();
  renderSummary();
}

// Повністю перемальовує значення полів зі стану (після "Очистити все" / "Скасувати зміни" / завантаження пака)
function syncFieldsFromForm() {
  ui.fillFields(form);
  ui.showTitleError('');
  ui.updateDescCounter();
  updateCategoryOptionLabels();
  resetCataForm();
  selectCategory(activeCategory);
  updateButtons();
}

// ----- Пошук по характеристиках -----
// Один рядок пошуку на всі категорії (логіка збігів — pack-search.js). Дві поведінки залежно від того, де шукаємо:
//  • категорія "Катаклізм" (лише активна): фільтрується сам список катаклізмів (renderCataList) за назвою й описом;
//  • решта (текстові категорії, або будь-яка, якщо увімкнено "У всіх категоріях"): під полем будується список знайдених рядків.
// Клік по результату перемикає категорію, виділяє рядок у textarea (або відкриває катаклізм у формі).
const searchTokens = () => tokenize(searchQuery);

// Фільтр самого списку катаклізмів діє, лише коли шукаємо в активній категорії "Катаклізм"
const cataFilterActive = () => activeCategory === 'cataclysm' && !searchAll && searchTokens().length > 0;

// Перемальовує панель результатів, лічильник і кнопку "×" за станом (searchQuery / searchAll / activeCategory / form)
function renderSearch() {
  const tokens = searchTokens();
  const view = { query: searchQuery, tokens, searchAll };

  if (!tokens.length) {
    ui.paintSearch({ ...view, mode: 'idle' });
    return;
  }

  // Катаклізми в активній категорії: фільтрується сам список, окрема панель не потрібна
  if (cataFilterActive()) {
    ui.paintSearch({ ...view, mode: 'cata-filter', cataCount: form.cataclysms.filter(c => cataMatches(c, tokens)).length });
    return;
  }

  const categories = searchAll ? ALL_PACK_CATEGORIES : ALL_PACK_CATEGORIES.filter(c => c.category === activeCategory);
  const { results, total } = collectSearchResults({ categories, texts: form.texts, cataclysms: form.cataclysms, tokens });
  ui.paintSearch({ ...view, mode: 'results', results, total });
}

function setSearchQuery(value, { focus = false } = {}) {
  searchQuery = value;
  ui.setSearchInput(value);
  renderList();
  renderSearch();
  if (focus) ui.focusSearchInput();
}

// Результат-рядок: переходимо в його категорію, виділяємо рядок у textarea й прокручуємо до нього
function openTextResult(category, lineIndex) {
  if (category !== activeCategory) selectCategory(category);
  if (!ui.selectCardsLine(lineIndex)) {
    showGlobalToast('Рядок змінився — виберіть результат ще раз');
    renderSearch();
  }
}

// Результат-катаклізм: відкриваємо його у формі (з тим самим захистом від втрати незбереженого, що й у кліку по списку)
function openCataResult(index) {
  if (activeCategory !== 'cataclysm') selectCategory('cataclysm');
  if (!form.cataclysms[index]) return;
  if (index !== cataEditIndex) {
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      ui.scrollCataFormIntoView();
      return;
    }
    startCataEdit(index);
    return;
  }
  ui.scrollCataFormIntoView();
}

function onSearchResultClick(e) {
  const row = e.target.closest('.pe-result');
  if (!row) return;
  if (row.dataset.resCata !== undefined) openCataResult(Number(row.dataset.resCata));
  else openTextResult(row.dataset.resCat, Number(row.dataset.resLine));
}

function onSearchKeydown(e) {
  if (e.key === 'Escape') {
    if (searchQuery) {
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
  if (!btn || !searchQuery) return;
  if (e.key === 'Escape') {
    ui.focusSearchInput();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const moved = ui.focusSiblingRow(btn, e.key === 'ArrowDown' ? 1 : -1);
  if (!moved && e.key === 'ArrowUp') ui.focusSearchInput();
}

function initSearch() {
  ui.initSearchControls({ query: searchQuery, all: searchAll });
  $('pe-search').addEventListener('input', e => setSearchQuery(e.target.value));
  $('pe-search').addEventListener('keydown', onSearchKeydown);
  $('pe-search-clear').addEventListener('click', () => setSearchQuery('', { focus: true }));
  $('pe-search-all').addEventListener('change', e => {
    searchAll = e.target.checked;
    renderList();
    renderSearch();
  });
  const results = $('pe-search-results');
  results.addEventListener('click', onSearchResultClick);
  results.addEventListener('keydown', onSearchListKeydown);
  $('pe-cata-list').addEventListener('keydown', onSearchListKeydown);
}

// ----- Катаклізми: список рядків (.added-item-row) + форма під ним -----
// Джерело істини — form.cataclysms (записи з pack-payload.js). Текст у textarea лише відображає їхні назви (по одній на рядок),
// тому змінити катаклізм можна лише через форму: клік по назві → поля заповнюються → "Зберегти зміни" або "Видалити".

// Текст списку (назви по одній на рядок) усередині form.texts.cataclysm: з нього читаються лічильники, підсумок і трекінг змін
function syncCataText(f = form) {
  f.texts.cataclysm = cataclysmNamesText(f.cataclysms);
}

// Чи є у формі дані, які ще не потрапили в список (новий катаклізм або незбережені правки існуючого).
// Захист від втрати: без нього "Оновити пак" або клік по іншому катаклізму мовчки відкинули б заповнене.
const cataDraftPending = () => hasCataDraft(ui.readCataRaw(), form.cataclysms[cataEditIndex], cataEditIndex >= 0);

function renderCataList() {
  ui.renderCataList({
    cataclysms: form.cataclysms,
    editIndex: cataEditIndex,
    newIndex: newCataIndex,
    tokens: cataFilterActive() ? searchTokens() : []
  });
}

function getDynamicCards() {
  if (activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[activeCategory]) return [];
  return parseCards(form.texts[activeCategory] || '', activeCategory, extraMeta);
}

function renderList() {
  if (activeCategory === 'cataclysm') {
    renderCataList();
  } else if (CATEGORY_SCHEMAS[activeCategory] && viewMode === 'visual') {
    const cards = getDynamicCards();
    ui.renderCataList({
      cataclysms: cards.map(c => ({ name: c.value })),
      editIndex: dynEditIndex,
      newIndex: newDynIndex,
      tokens: searchAll && !cataFilterActive() ? searchTokens() : []
    });
    if (activeCategory === 'gender') {
      const datalist = document.getElementById('pe-dyn-opposite-list');
      if (datalist) {
        datalist.innerHTML = cards.map(c => '<option value="' + c.value.replace(/"/g, '&quot;') + '">').join('');
      }
    }
  }
}

// Режим форми: -1 — додавання нового, ≥ 0 — редагування існуючого
function setCataMode(index) {
  cataEditIndex = index;
  ui.paintCataMode(index >= 0 ? form.cataclysms[index] : null);
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
  updateCategoryOptionLabels();
  renderSummary();
  updateButtons();
}

// "Додати" / "Зберегти зміни" — залежно від режиму форми. Після успіху дані з’являються в полі-списку, а поля форми очищаються.
function submitCata() {
  const result = validateCataclysmInput(ui.readCataRaw(), { cataclysms: form.cataclysms, editIndex: cataEditIndex });
  if (result.error) {
    ui.showCataError(result.error, result.field);
    return;
  }

  const existing = cataEditIndex >= 0 ? form.cataclysms[cataEditIndex] : null;
  if (existing) {
    // Додаткова meta цього катаклізму, якої форма не показує, лишається правою
    form.cataclysms[cataEditIndex] = { ...result.item, extra: existing.extra || {} };
  } else {
    form.cataclysms.push(result.item);
  }

  applyCataChange();
  resetCataForm();

  // Новий рядок з’являється з анімацією: клас is-new діє лише на цей рендер (далі перемальовки його вже не мають)
  if (!existing) {
    newCataIndex = form.cataclysms.length - 1;
    renderList();
    newCataIndex = -1;
    ui.scrollCataListToEnd();
  }
  showGlobalToast(existing ? 'Катаклізм оновлено' : 'Катаклізм додано');
  $(ui.CATA_FIELDS.name)?.focus();
}

// Клік по назві у списку → поля форми заповнюються даними цього катаклізму
function startCataEdit(index) {
  const item = form.cataclysms[index];
  if (!item) return;
  ui.fillCataFields(cataFieldStrings(item));
  ui.showCataError('');
  setCataMode(index);
  ui.scrollCataFormIntoView();
}

function onCataListClick(e) {
  const row = e.target.closest('[data-cata-index]');
  if (!row) return;
  const index = Number(row.dataset.cataIndex);

  if (activeCategory === 'cataclysm') {
    if (!form.cataclysms[index] || index === cataEditIndex) return;
    if (cataDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startCataEdit(index);
  } else {
    const cards = getDynamicCards();
    if (!cards[index] || index === dynEditIndex) return;
    if (dynDraftPending()) {
      showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
      return;
    }
    startDynEdit(index, cards[index]);
  }
}

async function deleteCata(btn) {
  const item = cataEditIndex >= 0 ? form.cataclysms[cataEditIndex] : null;
  if (!item || isConfirming) return;

  isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити катаклізм "${oneLine(item.name)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    isConfirming = false;
  }
  if (!confirmed) return;

  // Після await індекс міг змінитися (наприклад, "Очистити все"), тому шукаємо запис за посиланням
  const index = form.cataclysms.indexOf(item);
  if (index < 0) return;
  form.cataclysms.splice(index, 1);

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
  if (activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[activeCategory] || viewMode !== 'visual') return false;
  const current = readDynRaw();
  if (!current.value && Object.values(current).every(v => !v || (Array.isArray(v) && !v.length))) return false;
  
  if (dynEditIndex < 0) return true;
  
  const cards = getDynamicCards();
  const item = cards[dynEditIndex];
  if (!item) return false;
  
  if (current.value !== item.value) return true;
  for (const f of CATEGORY_SCHEMAS[activeCategory].fields) {
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
  const schema = CATEGORY_SCHEMAS[activeCategory];
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
  const schema = CATEGORY_SCHEMAS[activeCategory];
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
  dynEditIndex = index;
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

function startDynEdit(index, card) {
  fillDynFields(card);
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  setDynMode(index);
  $('pe-dynamic-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetDynForm() {
  $('pe-dyn-name').value = '';
  const schema = CATEGORY_SCHEMAS[activeCategory];
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
}

function applyDynChange({ scrollToEnd = false } = {}) {
  ui.showCategory({ category: activeCategory, text: form.texts[activeCategory] || '', viewMode });
  renderList();
  if (scrollToEnd) $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
  renderSearch();
  updateCardsMeta();
  updateCategoryOptionLabels();
  renderSummary();
  updateButtons();
}

function submitDyn() {
  const data = readDynRaw();
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
    if (activeCategory === 'gender') {
      if (dynEditIndex >= 0) oldOpposite = cards[dynEditIndex].meta.opposite;
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

  
  if (dynEditIndex >= 0) {
    cards[dynEditIndex] = { value: data.value, meta };
  } else {
    cards.push({ value: data.value, meta });
    newDynIndex = cards.length - 1;
  }

    if (activeCategory === 'gender') {
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

  
  form.texts[activeCategory] = cards.map(c => cardToLine(activeCategory, c.value, c.meta)).join('\n');
  
  applyDynChange({ scrollToEnd: newDynIndex >= 0 });
  resetDynForm();
  
  if (newDynIndex >= 0) {
    newDynIndex = -1;
  }
  showGlobalToast(dynEditIndex >= 0 ? 'Картку оновлено' : 'Картку додано');
  $('pe-dyn-name')?.focus();
}

async function deleteDyn(btn) {
  if (dynEditIndex < 0 || isConfirming) return;
  const cards = getDynamicCards();
  const item = cards[dynEditIndex];
  
  isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити картку "${oneLine(item.value)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    isConfirming = false;
  }
  if (!confirmed) return;

  cards.splice(dynEditIndex, 1);
  form.texts[activeCategory] = cards.map(c => cardToLine(activeCategory, c.value, c.meta)).join('\n');
  
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
  if (isConfirming) return false;
  isConfirming = true;
  try {
    return await showPackConfirm(`Чи точно хочете ${actionLabel}? ${UNSAVED_NOTE}`, anchor, { confirmLabel: 'Підтвердити' });
  } finally {
    isConfirming = false;
  }
}

function goToList() {
  allowLeave = true;
  window.location.hash = '#/packs';
}

async function handleSave(btn) {
  if (isSaving) return;

  const title = form.title.trim();
  const error = validateTitle(title, { isDefaultPack: packId === DEFAULT_PACK_ID });
  if (error) {
    ui.showTitleError(error);
    ui.focusTitle();
    return;
  }

  const rangeError = validateRanges(form.ranges);
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
  const cards = buildCardRows(form.texts, extraMeta, form.cataclysms);
  if (cards.length > MAX_PACK_CARDS) {
    showGlobalToast(`Забагато характеристик: ${cards.length}. Максимум — ${MAX_PACK_CARDS}`);
    return;
  }

  const isEdit = Boolean(packId);
  const originalLabel = btn.textContent;
  isSaving = true;
  ui.setButtonState(btn, { disabled: true, text: 'Збереження...' });

  try {
    await savePack({
      id: packId,
      title,
      description: form.description.trim(),
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
    isSaving = false;
  }
}

async function handleClear(btn) {
  if (!(await confirmAction('очистити все', btn))) return;
  form = blankForm();
  extraMeta = {}; // очищені картки не мають підтягувати стару додаткову meta, якщо автор введе ту саму назву заново
  syncFieldsFromForm();
}

async function handleReset(btn) {
  if (!(await confirmAction('скасувати зміни', btn))) return;
  form = cloneForm(initialForm);
  syncFieldsFromForm();
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
  if (!allowLeave && isDirty()) {
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

  packConfig = pack.config || {};
  extraMeta = pack.extraMeta || {};

  const texts = {};
  for (const [category, values] of Object.entries(pack.cards || {})) {
    texts[category] = values.join('\n');
  }
  // Стадії пака; якщо якоїсь немає — показуємо дефолтні (саме їх рушій і застосував би)
  const stages = {
    ...baseStages,
    ...Object.fromEntries(Object.entries(stagesTextFromConfig(packConfig)).filter(([, v]) => v))
  };
  const ranges = rangesFromConfig(packConfig, baseRanges);

  form = {
    title: pack.title,
    description: pack.description || '',
    texts,
    stages,
    ranges,
    cataclysms: (pack.cataclysms || []).map(c => ({ ...c, extra: { ...(c.extra || {}) } }))
  };
  syncCataText(form); // текст поля-списку будується з назв катаклізмів
  initialForm = cloneForm(form);
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

export async function initPackEditor() {
  packId = getPackIdFromHash();
  defaultConfig = {};
  packConfig = {};
  extraMeta = {};
  baseStages = {};
  baseRanges = {};
  form = blankForm();
  initialForm = cloneForm(form);
  activeCategory = ALL_PACK_CATEGORIES[0].category;
  isSaving = false;
  isConfirming = false;
  allowLeave = false;
  cataEditIndex = -1;
  newCataIndex = -1;

  searchQuery = '';
  searchAll = false;

  window.addEventListener('beforeunload', onBeforeUnload);

  $('pe-title').addEventListener('input', e => {
    form.title = e.target.value;
    ui.showTitleError('');
    updateButtons();
  });

  $('pe-desc').addEventListener('input', e => {
    form.description = e.target.value;
    ui.updateDescCounter();
    updateButtons();
  });

  $('pe-category').addEventListener('change', e => selectCategory(e.target.value));

  // Катаклізми: клік по назві у полі-списку відкриває їх у формі, кнопки форми додають/зберігають/видаляють
  $('pe-cata-list').addEventListener('click', onCataListClick);
  $('pe-cata').addEventListener('click', handleCataClick);
  $('pe-cata').addEventListener('input', handleCataInput);
  
  $('pe-dynamic-form').addEventListener('click', handleDynClick);
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
    viewMode = e.target.checked ? 'llm' : 'visual';
    ui.showCategory({ category: activeCategory, text: form.texts[activeCategory] || '', viewMode });
    renderList();
    renderSearch();
    updateCardsMeta();
  });
  
  $('pe-llm-copy')?.addEventListener('click', async () => {
    const prompt = getPromptForCategory(activeCategory);
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
    if (activeCategory === 'cataclysm') return; // список катаклізмів не редагується текстом (джерело — form.cataclysms)
    form.texts[activeCategory] = e.target.value;
    renderSearch(); // результати пошуку завжди відображають актуальний текст
    updateCardsMeta();
    updateCategoryOptionLabels();
    renderSummary();
    updateButtons();
  });

  $('pe-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-chip]');
    if (chip) selectCategory(chip.dataset.chip);
  });

  $('pe-stages').addEventListener('input', e => {
    const field = e.target.closest('[data-stage]');
    if (!field) return;
    form.stages[field.dataset.stage] = field.value;
    updateButtons();
  });

  $('pe-ranges').addEventListener('input', e => {
    const field = e.target.closest('[data-range]');
    if (!field) return;
    form.ranges[field.dataset.range] = field.value;
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


  try {
    // Базовий пак редагує лише адмін: перевіряємо ще до завантаження даних (статус кешується в packs-store.js; дублює перевірку в getPack)
    if (packId === DEFAULT_PACK_ID && !(await checkIsAdmin())) {
      showGlobalToast('Дефолтний пак не можна редагувати');
      goToList();
      return;
    }

    // Конфіг дефолтного пака потрібен в обох режимах: без нього не зібрати повний config (age_range, height_range...)
    defaultConfig = await getDefaultPackConfig();
    baseStages = stagesTextFromConfig(defaultConfig);
    baseRanges = rangesFromConfig(defaultConfig, RANGE_DEFAULTS);

    if (packId) {
      if (!(await loadPackIntoForm(packId))) return;
    } else {
      form = blankForm();
      initialForm = cloneForm(form);
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
  if (!packId) ui.focusTitle();
}

export function cleanupPackEditor() {
  window.removeEventListener('beforeunload', onBeforeUnload);
  isSaving = false;
  isConfirming = false;
}

