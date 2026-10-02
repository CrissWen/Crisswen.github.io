import { esc } from '../utils/escape-html.js';
import { CHARACTER_CATEGORIES, BUNKER_CATEGORIES, ALL_PACK_CATEGORIES } from '../utils/pack-categories.js';
import { parseLines, buildCardRows, MAX_PACK_CARDS } from '../utils/pack-payload.js';
import { getPack, savePack, getDefaultPackConfig } from '../services/packs-store.js';
import { showCustomConfirm } from '../game-modules/overlays/confirm-dialog.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';

// ===== Сторінка «Редактор пака» (#/pack-editor, редагування — #/pack-editor?id=<uuid>) =====
// Замість сотні окремих інпутів: випадаючий список категорій + одна велика textarea (одна характеристика на рядок).
// Текст кожної категорії зберігається окремо, тож можна переключатись між категоріями, нічого не втрачаючи.
// Стадії (стаж професії, рівень хобі, ступінь хвороби) — одні на весь пак, зберігаються в packs.config.default_stages.

const TITLE_MAX = 100;
const DESC_MAX = 255;
const RESERVED_TITLES = ['default', 'дефолт']; // дзеркало перевірки в RPC save_personal_pack
const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';
const UNSAVED_NOTE = 'Усі незбережені зміни будуть втрачені';

// Ключі збігаються з packs.config.default_stages, які читає ігровий рушій (game-generator.js, characteristics.js)
const STAGE_FIELDS = [
  { key: 'profession', label: 'Стаж професії' },
  { key: 'hobby',      label: 'Рівень хобі' },
  { key: 'health',     label: 'Ступінь хвороби' }
];

// ----- Стан сторінки (модульний: на екрані завжди один редактор) -----
let packId = null;          // null = режим створення
let defaultConfig = {};     // packs.config дефолтного пака: основа конфігу, бо рушій вимагає age_range, height_range тощо
let packConfig = {};        // packs.config пака, що редагується (для нового — порожній)
let baseStages = {};        // стадії дефолтного пака (текст): те, до чого повертає «Очистити все» і порожнє поле стадій
let form = { title: '', description: '', texts: {}, stages: {} }; // texts: { [category]: string }, stages: { [key]: string }
let initialForm = cloneForm(form); // значення на момент відкриття (для «Скасувати зміни» і відстеження змін)
let activeCategory = ALL_PACK_CATEGORIES[0].category;
let isSaving = false;
let isConfirming = false;
let allowLeave = false;     // після успішного збереження не питаємо браузер «Залишити сторінку?»

function blankForm() {
  return { title: '', description: '', texts: {}, stages: { ...baseStages } };
}

function cloneForm(f) {
  return { title: f.title, description: f.description, texts: { ...f.texts }, stages: { ...f.stages } };
}

function getPackIdFromHash() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
}

// ----- Допоміжні -----
// Нормалізований вигляд для порівняння: зайві пробіли та порожні рядки змінами не вважаються
function normalize(f) {
  const texts = {};
  for (const { category } of ALL_PACK_CATEGORIES) {
    const lines = parseLines(f.texts[category]);
    if (lines.length) texts[category] = lines.join('\n');
  }
  const stages = {};
  for (const { key } of STAGE_FIELDS) stages[key] = parseLines(f.stages[key]).join('\n');
  return JSON.stringify({ title: f.title.trim(), description: f.description.trim(), texts, stages });
}

const isDirty = () => normalize(form) !== normalize(initialForm);
const isFormEmpty = () => normalize(form) === normalize(blankForm());

// Стадії з конфігу пака (масиви рядків) → текст для textarea
function stagesTextFromConfig(config) {
  const text = {};
  for (const { key } of STAGE_FIELDS) {
    const list = config?.default_stages?.[key];
    text[key] = Array.isArray(list) ? list.filter(s => typeof s === 'string').join('\n') : '';
  }
  return text;
}

// 3.4: фінальний config для збереження. Основа — конфіг дефолтного пака, поверх нього конфіг самого пака,
// а default_stages перекриваються стадіями з форми. Порожнє поле стадій = лишається те, що було (стадії дефолтного пака).
function buildConfig() {
  const stages = {};
  for (const { key } of STAGE_FIELDS) {
    const lines = parseLines(form.stages[key]);
    if (lines.length) stages[key] = lines;
  }
  return {
    ...defaultConfig,
    ...packConfig,
    default_stages: {
      ...(defaultConfig.default_stages || {}),
      ...(packConfig.default_stages || {}),
      ...stages
    }
  };
}

function categoryLabel(c) {
  const count = parseLines(form.texts[c.category]).length;
  return count ? `${c.label} (${count})` : c.label;
}

const $ = id => document.getElementById(id);

// ----- Розмітка -----
function optionsHtml(list) {
  return list.map(c => `<option value="${esc(c.category)}">${esc(categoryLabel(c))}</option>`).join('');
}

function stageFieldsHtml() {
  return STAGE_FIELDS.map(({ key, label }) => `
    <div class="pe-field">
      <label class="pe-label" for="pe-stage-${key}">${esc(label)}</label>
      <textarea id="pe-stage-${key}" class="pe-input pe-stage" data-stage="${key}" rows="6" spellcheck="false" placeholder="Одна стадія на рядок"></textarea>
    </div>`).join('');
}

export function renderPackEditor() {
  const isEdit = Boolean(getPackIdFromHash());
  const saveLabel = isEdit ? 'Оновити особистий пак' : 'Створити особистий пак';

  const buttons = isEdit
    ? `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="reset">Скасувати зміни</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="clear">Очистити все</button>
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit">Відмінити та вийти</button>`
    : `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="clear">Очистити все</button>
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit">Вийти</button>`;

  // is-loading знімається, коли завантажено конфіг дефолтного пака (і сам пак у режимі редагування)
  return `
    <section id="pe-root" class="pack-editor layout-large-centered is-loading">
      <div class="block">
        <div class="block-head"><h2>${isEdit ? 'Редагування пака' : 'Створення пака'}</h2></div>
        <div class="block-body pe-body">
          <div class="pe-field">
            <label class="pe-label" for="pe-title">Назва пака <span class="pe-required" title="Обов'язкове поле">*</span></label>
            <input id="pe-title" class="pe-input" type="text" maxlength="${TITLE_MAX}" autocomplete="off" placeholder="Наприклад: Постапокаліпсис">
            <p id="pe-title-error" class="pe-error" role="alert" hidden></p>
          </div>
          <div class="pe-field">
            <label class="pe-label" for="pe-desc">Опис</label>
            <textarea id="pe-desc" class="pe-input pe-desc" rows="3" maxlength="${DESC_MAX}" placeholder="Коротко про те, для якого сценарію цей пак"></textarea>
            <span id="pe-desc-counter" class="pe-counter">0/${DESC_MAX}</span>
          </div>
        </div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Характеристики</h2></div>
        <div class="block-body pe-body">
          <div class="pe-field">
            <label class="pe-label" for="pe-category">Категорія</label>
            <select id="pe-category" class="pe-input pe-select">
              <optgroup label="Характеристики гравця">${optionsHtml(CHARACTER_CATEGORIES)}</optgroup>
              <optgroup label="Бункер">${optionsHtml(BUNKER_CATEGORIES)}</optgroup>
            </select>
          </div>
          <div class="pe-field">
            <textarea id="pe-cards" class="pe-input pe-cards" placeholder="${esc(TEXTAREA_PLACEHOLDER)}" spellcheck="false"></textarea>
            <span id="pe-lines-count" class="pe-counter">Рядків: 0</span>
          </div>
          <div class="pe-summary">
            <p id="pe-summary-total" class="pe-summary__total"></p>
            <div id="pe-chips" class="pe-chips"></div>
          </div>
        </div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Стадії</h2></div>
        <div class="block-body pe-body">
          <p class="pe-hint">
            Стадії діють на весь пак: для кожної професії, хобі та хвороби гра випадково обирає одне зі значень.
            Одне значення — один рядок. Порожнє поле означає, що лишаються стадії дефолтного пака.
          </p>
          <div class="pe-stages" id="pe-stages">${stageFieldsHtml()}</div>
        </div>
      </div>

      <div class="block pe-actions-block">
        <div class="block-body pe-actions" id="pe-actions">${buttons}</div>
      </div>
    </section>
  `;
}

// ----- Оновлення елементів за станом -----
function renderSummary() {
  const filled = ALL_PACK_CATEGORIES
    .map(c => ({ ...c, count: parseLines(form.texts[c.category]).length }))
    .filter(c => c.count > 0);
  const total = filled.reduce((sum, c) => sum + c.count, 0);

  $('pe-summary-total').textContent = total
    ? `Усього характеристик: ${total} · категорій: ${filled.length}`
    : 'Характеристик ще немає';

  $('pe-chips').innerHTML = filled.map(c => `
    <button type="button" class="pe-chip${c.category === activeCategory ? ' is-active' : ''}" data-chip="${esc(c.category)}">
      ${esc(c.label)} <span>${c.count}</span>
    </button>`).join('');
}

function updateCategoryOptionLabels() {
  $('pe-category').querySelectorAll('option').forEach(option => {
    const c = ALL_PACK_CATEGORIES.find(x => x.category === option.value);
    if (c) option.textContent = categoryLabel(c); // змінюємо лише текст, щоб select не втрачав фокус
  });
}

function updateButtons() {
  const reset = document.querySelector('[data-action="reset"]');
  const clear = document.querySelector('[data-action="clear"]');
  if (reset) reset.disabled = !isDirty();
  if (clear) clear.disabled = isFormEmpty();
}

function updateCardsMeta() {
  $('pe-lines-count').textContent = `Рядків: ${parseLines($('pe-cards').value).length}`;
}

function updateDescCounter() {
  $('pe-desc-counter').textContent = `${$('pe-desc').value.length}/${DESC_MAX}`;
}

function showTitleError(message) {
  const el = $('pe-title-error');
  el.textContent = message || '';
  el.hidden = !message;
  $('pe-title').classList.toggle('is-invalid', Boolean(message));
}

function selectCategory(category) {
  activeCategory = category;
  $('pe-category').value = category;
  $('pe-cards').value = form.texts[category] || '';
  $('pe-cards').scrollTop = 0;
  updateCardsMeta();
  renderSummary();
}

// Повністю перемальовує значення полів зі стану (після «Очистити все» / «Скасувати зміни» / завантаження пака)
function syncFieldsFromForm() {
  $('pe-title').value = form.title;
  $('pe-desc').value = form.description;
  document.querySelectorAll('[data-stage]').forEach(el => { el.value = form.stages[el.dataset.stage] || ''; });
  showTitleError('');
  updateDescCounter();
  updateCategoryOptionLabels();
  selectCategory(activeCategory);
  updateButtons();
}

// ----- Дії -----
// 3.2: назва не порожня і не дорівнює default / дефолт (без урахування регістру)
function validateTitle(title) {
  if (!title) return 'Вкажіть назву пака';
  if (RESERVED_TITLES.includes(title.toLowerCase())) return `Назва «${title}» зарезервована системою`;
  return '';
}

async function confirmAction(actionLabel, anchor) {
  if (isConfirming) return false;
  isConfirming = true;
  try {
    return await showCustomConfirm(`Чи точно хочете ${actionLabel}? ${UNSAVED_NOTE}`, anchor);
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
  const error = validateTitle(title);
  if (error) {
    showTitleError(error);
    $('pe-title').focus();
    return;
  }

  // 3.3: рядки масового вводу → [{ pool_type, category, value, meta: {} }]
  const cards = buildCardRows(form.texts);
  if (cards.length > MAX_PACK_CARDS) {
    showGlobalToast(`Забагато характеристик: ${cards.length}. Максимум — ${MAX_PACK_CARDS}`);
    return;
  }

  const isEdit = Boolean(packId);
  const originalLabel = btn.textContent;
  isSaving = true;
  btn.disabled = true;
  btn.textContent = 'Збереження...';

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
    btn.disabled = false;
    btn.textContent = originalLabel;
  } finally {
    isSaving = false;
  }
}

async function handleClear(btn) {
  if (!(await confirmAction('очистити все', btn))) return;
  form = blankForm();
  syncFieldsFromForm();
}

async function handleReset(btn) {
  if (!(await confirmAction('скасувати зміни', btn))) return;
  form = cloneForm(initialForm);
  syncFieldsFromForm();
}

async function handleExit(btn) {
  // Без змін питати нема про що: попередження «зміни будуть втрачені» було б неправдою
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
  if (!pack || pack.isDefault) {
    showGlobalToast(pack?.isDefault ? 'Дефолтний пак не можна редагувати' : 'Пак не знайдено');
    goToList();
    return false;
  }

  packConfig = pack.config || {};

  const texts = {};
  for (const [category, values] of Object.entries(pack.cards || {})) {
    texts[category] = values.join('\n');
  }
  // Стадії пака; якщо якоїсь немає — показуємо дефолтні (саме їх рушій і застосував би)
  const stages = {
    ...baseStages,
    ...Object.fromEntries(Object.entries(stagesTextFromConfig(packConfig)).filter(([, v]) => v))
  };

  form = { title: pack.title, description: pack.description || '', texts, stages };
  initialForm = cloneForm(form);
  return true;
}

export async function initPackEditor() {
  packId = getPackIdFromHash();
  defaultConfig = {};
  packConfig = {};
  baseStages = {};
  form = blankForm();
  initialForm = cloneForm(form);
  activeCategory = ALL_PACK_CATEGORIES[0].category;
  isSaving = false;
  isConfirming = false;
  allowLeave = false;

  window.addEventListener('beforeunload', onBeforeUnload);

  $('pe-title').addEventListener('input', e => {
    form.title = e.target.value;
    showTitleError('');
    updateButtons();
  });

  $('pe-desc').addEventListener('input', e => {
    form.description = e.target.value;
    updateDescCounter();
    updateButtons();
  });

  $('pe-category').addEventListener('change', e => selectCategory(e.target.value));

  $('pe-cards').addEventListener('input', e => {
    form.texts[activeCategory] = e.target.value;
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

  $('pe-actions').addEventListener('click', handleActionsClick);

  try {
    // Конфіг дефолтного пака потрібен в обох режимах: без нього не зібрати повний config (age_range, height_range...)
    defaultConfig = await getDefaultPackConfig();
    baseStages = stagesTextFromConfig(defaultConfig);

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
  if (!$('pe-root')) return;
  $('pe-root').classList.remove('is-loading');

  syncFieldsFromForm();
  if (!packId) $('pe-title').focus();
}

export function cleanupPackEditor() {
  window.removeEventListener('beforeunload', onBeforeUnload);
  isSaving = false;
  isConfirming = false;
}
