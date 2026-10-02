import { esc } from '../utils/escape-html.js';
import { CHARACTER_CATEGORIES, BUNKER_CATEGORIES, ALL_PACK_CATEGORIES } from '../utils/pack-categories.js';
import { parseLines, buildCardRows, MAX_PACK_CARDS, CATACLYSM_LIMITS } from '../utils/pack-payload.js';
import { getPack, savePack, getDefaultPackConfig } from '../services/packs-store.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';

// ===== Сторінка "Редактор пака" (#/pack-editor, редагування — #/pack-editor?id=<uuid>) =====
// Замість сотні окремих інпутів: випадаючий список категорій + одна велика textarea (одна характеристика на рядок).
// Текст кожної категорії зберігається окремо, тож можна переключатись між категоріями, нічого не втрачаючи.
// Стадії (стаж професії, рівень хобі, ступінь хвороби) — одні на весь пак, зберігаються в packs.config.default_stages.

const TITLE_MAX = 100;
const DESC_MAX = 255;
const RESERVED_TITLES = ['default', 'дефолт']; // дзеркало перевірки в RPC save_personal_pack
const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';
// Спеціальний плейсхолдер: підказує синтаксис "Професія - Можливість", який buildCardRows (pack-payload.js) розбирає саме для цієї категорії.
const PROFESSION_PLACEHOLDER = 'Введіть професії стовпчиком (через Enter). Щоб додати професійну можливість, напишіть її через тире з пробілами. Наприклад: Лікар-хірург - Може вилікувати одну хворобу';

// Катаклізми редагуються не текстом, а формою під списком (блок "Катаклізми" нижче): у полі лише відображаються назви доданих катаклізмів.
const CATACLYSM_LIST_PLACEHOLDER = 'Тут з’являться додані катаклізми. Заповніть поля нижче й натисніть "Додати". Щоб змінити або видалити катаклізм — натисніть на його назву тут.';

function placeholderFor(category) {
  if (category === 'profession') return PROFESSION_PLACEHOLDER;
  if (category === 'cataclysm') return CATACLYSM_LIST_PLACEHOLDER;
  return TEXTAREA_PLACEHOLDER;
}
const UNSAVED_NOTE = 'Усі незбережені зміни будуть втрачені';

// Ключі збігаються з packs.config.default_stages, які читає ігровий рушій (game-generator.js, characteristics.js)
const STAGE_FIELDS = [
  { key: 'profession', label: 'Стаж професії' },
  { key: 'hobby',      label: 'Рівень хобі' },
  { key: 'health',     label: 'Ступінь хвороби' }
];

// Діапазони віку/зросту, які читає ігровий рушій з packs.config.age_range / height_range
// (game-generator.js при старті гри, host/characteristics.js при переролі статі/статури ведучим). Ці числа —
// лише підстава для НОВОГО пака, якщо в самому дефолтному паку раптом щось спійметься відсутнім (бач rangesFromConfig).
const RANGE_DEFAULTS = { ageMin: 16, ageMax: 85, heightMin: 150, heightMax: 210 };
const RANGE_FIELDS = [
  { key: 'ageMin',    label: 'Мін. вік',    min: 1,  max: 120 },
  { key: 'ageMax',    label: 'Макс. вік',   min: 1,  max: 120 },
  { key: 'heightMin', label: 'Мін. зріст',  min: 50, max: 300 },
  { key: 'heightMax', label: 'Макс. зріст', min: 50, max: 300 }
];

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
// Нормалізований вигляд для порівняння: зайві пробіли та порожні рядки змінами не вважаються
function normalize(f) {
  const texts = {};
  for (const { category } of ALL_PACK_CATEGORIES) {
    const lines = parseLines(f.texts[category]);
    if (lines.length) texts[category] = lines.join('\n');
  }
  const stages = {};
  for (const { key } of STAGE_FIELDS) stages[key] = parseLines(f.stages[key]).join('\n');
  const cataclysms = (f.cataclysms || []).map(c => [
    String(c.name ?? '').trim(), String(c.description ?? '').trim(), c.timer_minutes || 0, c.stay_time_months || 0, c.population || 0
  ]);
  return JSON.stringify({ title: f.title.trim(), description: f.description.trim(), texts, stages, ranges: f.ranges, cataclysms });
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

// Діапазони віку/зросту з конфігу → рядки для number-інпутів. fallback — об'єкт тих самих 4 ключів (числа або рядки —
// байдуже, String() на виході в будь-якому випадку): для базового пака — RANGE_DEFAULTS, для конкретного — baseRanges.
function rangesFromConfig(config, fallback) {
  const age = config?.age_range || {};
  const height = config?.height_range || {};
  return {
    ageMin:    String(age.min ?? fallback.ageMin),
    ageMax:    String(age.max ?? fallback.ageMax),
    heightMin: String(height.min ?? fallback.heightMin),
    heightMax: String(height.max ?? fallback.heightMax)
  };
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
    age_range: {
      min: parseInt(form.ranges.ageMin, 10),
      max: parseInt(form.ranges.ageMax, 10)
    },
    height_range: {
      min: parseInt(form.ranges.heightMin, 10),
      max: parseInt(form.ranges.heightMax, 10)
    },
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

function rangesFieldsHtml() {
  return RANGE_FIELDS.map(({ key, label, min, max }) => `
    <div class="pe-field">
      <label class="pe-label" for="pe-range-${key}">${esc(label)}</label>
      <input id="pe-range-${key}" class="pe-input" type="number" data-range="${key}" min="${min}" max="${max}" step="1">
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
        <div class="block-head"><h2>Глобальні налаштування генерації</h2></div>
        <div class="block-body pe-body">
          <p class="pe-hint">
            Діапазони, в межах яких гра випадково визначає вік і зріст персонажів. Якщо в картці статі/раси
            вказано власний вік (наприклад, "Без віку" у Кіборга) — цей діапазон для нього ігнорується.
          </p>
          <div class="pe-stages" id="pe-ranges">${rangesFieldsHtml()}</div>
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
          <!-- Пошук: у поточній категорії або в усіх. Для текстових категорій показує список знайдених рядків (клік виділяє рядок у полі),
               для катаклізмів фільтрує сам список (шукає за назвою й описом) -->
          <div class="pe-field pe-search">
            <label class="pe-label" for="pe-search">Пошук</label>
            <div class="pe-search__box">
              <svg class="pe-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
              <input id="pe-search" class="pe-input pe-search__input" type="text" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Пошук...">
              <button type="button" id="pe-search-clear" class="pe-search__clear" aria-label="Очистити пошук" title="Очистити (Esc)" hidden>×</button>
            </div>
            <div class="pe-search__meta">
              <label class="pe-search__all"><input type="checkbox" id="pe-search-all"> У всіх категоріях</label>
              <span id="pe-search-count" aria-live="polite"></span>
            </div>
            <div id="pe-search-results" class="pe-cata-list pe-search-results" role="group" aria-label="Результати пошуку" hidden></div>
          </div>
          <div class="pe-field">
            <textarea id="pe-cards" class="pe-input pe-cards" placeholder="${esc(TEXTAREA_PLACEHOLDER)}" spellcheck="false"></textarea>
            <div id="pe-cata-list" class="pe-cata-list" role="group" aria-label="Додані катаклізми" hidden></div>
            <span id="pe-lines-count" class="pe-counter">Рядків: 0</span>
          </div>

          <!-- Форма катаклізму: видна лише для категорії "Катаклізм" (перемикає selectCategory) -->
          <div id="pe-cata" class="pe-cata" hidden>
            <h3 id="pe-cata-mode" class="pe-cata__title">Новий катаклізм</h3>
            <p class="pe-hint">Список вище лише для перегляду. Щоб змінити або видалити катаклізм, натисніть на його назву у списку.</p>
            <div class="pe-field">
              <label class="pe-label" for="pe-cata-name">Назва катаклізму <span class="pe-required" title="Обов'язкове поле">*</span></label>
              <input id="pe-cata-name" class="pe-input" type="text" maxlength="${CATACLYSM_LIMITS.nameMax}" autocomplete="off" placeholder="Напр.: Повстання штучного інтелекту">
            </div>
            <div class="pe-field">
              <label class="pe-label" for="pe-cata-desc">Опис</label>
              <textarea id="pe-cata-desc" class="pe-input pe-desc" rows="4" maxlength="${CATACLYSM_LIMITS.descMax}" placeholder="Напр.: Штучний інтелект захопив керування мережами, міста знеструмлено"></textarea>
            </div>
            <div class="pe-cata__grid">
              <div class="pe-field">
                <label class="pe-label" for="pe-cata-timer">Таймер (хв)</label>
                <input id="pe-cata-timer" class="pe-input" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="Напр.: 30 (0 або порожньо — без таймера, макс. ${CATACLYSM_LIMITS.timerMax})">
              </div>
              <div class="pe-field">
                <label class="pe-label" for="pe-cata-stay">Час перебування (міс.)</label>
                <input id="pe-cata-stay" class="pe-input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Напр.: 6 (порожньо — стандартні 12)">
              </div>
              <div class="pe-field">
                <label class="pe-label" for="pe-cata-pop">Популяція</label>
                <input id="pe-cata-pop" class="pe-input" type="text" inputmode="numeric" maxlength="15" autocomplete="off" placeholder="Напр.: 5000 (лише цифри; порожньо — &quot;Невідомо&quot;)">
              </div>
            </div>
            <p id="pe-cata-error" class="pe-error" role="alert" hidden></p>
            <div class="pe-cata__actions">
              <button type="button" class="pk-btn pk-btn--primary" data-cata-action="submit">Додати</button>
              <button type="button" class="pk-btn pk-btn--ghost" data-cata-action="cancel" hidden>Скасувати</button>
              <button type="button" class="pk-btn pk-btn--danger" data-cata-action="delete" hidden>Видалити</button>
            </div>
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
  const count = activeCategory === 'cataclysm' ? form.cataclysms.length : parseLines($('pe-cards').value).length;
  $('pe-lines-count').textContent = activeCategory === 'cataclysm' ? `Катаклізмів: ${count}` : `Рядків: ${count}`;
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
  const isCata = category === 'cataclysm';
  $('pe-category').value = category;
  $('pe-cards').value = form.texts[category] || '';
  $('pe-cards').placeholder = placeholderFor(category);
  $('pe-cards').hidden = isCata;                         // у катаклізмів замість textarea — список рядків (.added-item-row); редагування лише через клік по рядку і форму
  $('pe-cata-list').hidden = !isCata;
  $('pe-cata').hidden = !isCata;
  renderCataList();
  $('pe-cards').scrollTop = 0;
  updateCardsMeta();
  renderSummary();
}

// Повністю перемальовує значення полів зі стану (після "Очистити все" / "Скасувати зміни" / завантаження пака)
function syncFieldsFromForm() {
  $('pe-title').value = form.title;
  $('pe-desc').value = form.description;
  document.querySelectorAll('[data-stage]').forEach(el => { el.value = form.stages[el.dataset.stage] || ''; });
  document.querySelectorAll('[data-range]').forEach(el => { el.value = form.ranges[el.dataset.range] ?? ''; });
  showTitleError('');
  updateDescCounter();
  updateCategoryOptionLabels();
  resetCataForm();
  selectCategory(activeCategory);
  updateButtons();
}

// ----- Дії -----
// 3.2: назва не порожня і не дорівнює default / дефолт (без урахування регістру)
function validateTitle(title) {
  if (!title) return 'Вкажіть назву пака';
  if (RESERVED_TITLES.includes(title.toLowerCase())) return `Назва "${title}" зарезервована системою`;
  return '';
}

// Числа й min <= max — інакше randInt(min, max) в ігровому рушії (game-generator.js / host/characteristics.js) поверне сміття.
function validateRanges() {
  const r = form.ranges;
  const ageMin = parseInt(r.ageMin, 10), ageMax = parseInt(r.ageMax, 10);
  const heightMin = parseInt(r.heightMin, 10), heightMax = parseInt(r.heightMax, 10);
  if ([ageMin, ageMax, heightMin, heightMax].some(Number.isNaN)) return 'Заповніть діапазони віку й зросту коректними числами';
  if (ageMin > ageMax) return 'Мін. вік не може перевищувати макс. вік';
  if (heightMin > heightMax) return 'Мін. зріст не може перевищувати макс. зріст';
  return '';
}

// ----- Катаклізми: список рядків (.added-item-row) + форма під ним -----
// Джерело істини — form.cataclysms (записи з pack-payload.js). Текст у textarea лише відображає їхні назви (по одній на рядок),
// тому змінити катаклізм можна лише через форму: клік по назві → поля заповнюються → "Зберегти зміни" або "Видалити".
const CATA_FIELDS = { name: 'pe-cata-name', desc: 'pe-cata-desc', timer: 'pe-cata-timer', stay: 'pe-cata-stay', pop: 'pe-cata-pop' };
const CATA_NUMERIC = ['timer', 'stay', 'pop'];

// Рядок без перенесень: назва з бази з \n зламала би співвідношення "рядок списку ↔ катаклізм"
const oneLine = text => String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();

// Текст списку (назви по одній на рядок) усередині form.texts.cataclysm: з нього читаються лічильники, підсумок і трекінг змін
function syncCataText(f = form) {
  f.texts.cataclysm = (f.cataclysms || []).map(c => oneLine(c.name)).join('\n');
}

// Значення полів форми для запису (рядками)
function cataFieldStrings(item) {
  return {
    name: String(item.name ?? '').trim(),
    desc: String(item.description ?? '').trim(),
    timer: String(item.timer_minutes || 0),
    stay: item.stay_time_months ? String(item.stay_time_months) : '',
    pop: item.population ? String(item.population) : ''
  };
}

function readCataRaw() {
  const get = key => $(CATA_FIELDS[key]).value.trim();
  return { name: get('name'), desc: get('desc'), timer: get('timer'), stay: get('stay'), pop: get('pop') };
}

// Чи є у формі дані, які ще не потрапили в список (новий катаклізм або незбережені правки існуючого).
// Захист від втрати: без нього "Оновити пак" або клік по іншому катаклізму мовчки відкинули б заповнене.
function cataDraftPending() {
  const raw = readCataRaw();
  if (cataEditIndex < 0) {
    return Boolean(raw.name || raw.desc || (raw.timer && raw.timer !== '0') || raw.stay || raw.pop);
  }
  const item = form.cataclysms[cataEditIndex];
  if (!item) return false;
  // Порожній таймер і "0" — одне й те саме (без таймера)
  return JSON.stringify({ ...raw, timer: raw.timer || '0' }) !== JSON.stringify(cataFieldStrings(item));
}

function showCataError(message, key) {
  const el = $('pe-cata-error');
  el.textContent = message || '';
  el.hidden = !message;
  Object.values(CATA_FIELDS).forEach(id => $(id).classList.remove('is-invalid'));
  if (message && key) {
    const field = $(CATA_FIELDS[key]);
    field.classList.add('is-invalid');
    field.focus();
  }
}

// Режим форми: -1 — додавання нового, ≥ 0 — редагування існуючого (змінює заголовок, підпис кнопки і показує "Скасувати"/"Видалити")
function setCataMode(index) {
  cataEditIndex = index;
  const item = index >= 0 ? form.cataclysms[index] : null;
  $('pe-cata-mode').textContent = item ? `Редагування: "${oneLine(item.name)}"` : 'Новий катаклізм';
  document.querySelector('[data-cata-action="submit"]').textContent = item ? 'Зберегти зміни' : 'Додати';
  document.querySelector('[data-cata-action="cancel"]').hidden = !item;
  document.querySelector('[data-cata-action="delete"]').hidden = !item;
  renderCataList();
}

// Очищає поля і повертає форму в режим "додати". Таймер за замовчуванням 0 (без таймера).
function resetCataForm() {
  Object.values(CATA_FIELDS).forEach(id => { $(id).value = ''; });
  // Таймер лишається порожнім, щоб було видно підказку в полі; порожнє = 0 (без таймера), див. readCataForm
  showCataError('');
  setCataMode(-1);
}

// Список доданих катаклізмів — справжні рядки (кнопки .added-item-row), а не текст у textarea: підсвічування при наведенні,
// "протискання" й виділення обраного рядка робить CSS (packs.css), без вимірювань геометрії та JS-анімацій.
function renderCataList() {
  const list = $('pe-cata-list');
  // Перемальовка замінює кнопки, тож клавіатурний фокус треба повернути на рядок з тим самим індексом
  const focusedIndex = document.activeElement?.closest?.('[data-cata-index]')?.dataset.cataIndex;

  if (!form.cataclysms.length) {
    list.innerHTML = `<p class="pe-cata-list__empty">${esc(CATACLYSM_LIST_PLACEHOLDER)}</p>`;
    return;
  }

  list.innerHTML = form.cataclysms.map((c, i) => {
    const selected = i === cataEditIndex;
    const isNew = i === newCataIndex;
    return `
      <button type="button" class="added-item-row${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}" data-cata-index="${i}" aria-pressed="${selected}">
        <span class="added-item-row__name">${esc(oneLine(c.name))}</span>
        <span class="added-item-row__hint">${selected ? 'редагується' : 'змінити'}</span>
      </button>`;
  }).join('');

  if (focusedIndex !== undefined) list.querySelector(`[data-cata-index="${focusedIndex}"]`)?.focus();
}
// Після будь-якої зміни списку: перемальовуємо поле-список, лічильники, підсумок і стан кнопок "Скасувати зміни"/"Очистити все"
function applyCataChange({ scrollToEnd = false } = {}) {
  syncCataText();
  renderCataList();
  if (scrollToEnd) $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
  updateCardsMeta();
  updateCategoryOptionLabels();
  renderSummary();
  updateButtons();
}

// Читає й перевіряє поля форми: повертає { item } або { error, field }
function readCataForm() {
  const raw = readCataRaw();
  const { timerMax, stayMax } = CATACLYSM_LIMITS;

  if (!raw.name) return { error: 'Вкажіть назву катаклізму', field: 'name' };

  const nameKey = raw.name.toLowerCase();
  const duplicate = form.cataclysms.some((c, i) => i !== cataEditIndex && String(c.name).trim().toLowerCase() === nameKey);
  if (duplicate) return { error: 'Катаклізм із такою назвою вже є в цьому паку', field: 'name' };

  const timer = raw.timer === '' ? 0 : Number(raw.timer);
  if (!Number.isInteger(timer) || timer < 0 || timer > timerMax) {
    return { error: `Таймер: ціле число від 0 до ${timerMax} хв (0 — без таймера)`, field: 'timer' };
  }

  let stay = null;
  if (raw.stay !== '') {
    stay = Number(raw.stay);
    if (!Number.isInteger(stay) || stay < 1 || stay > stayMax) {
      return { error: `Час перебування: від 1 до ${stayMax} міс. (або залиште поле порожнім)`, field: 'stay' };
    }
  }

  let population = null;
  if (raw.pop !== '') {
    const n = Number(raw.pop);
    if (!Number.isSafeInteger(n)) return { error: 'Популяція: лише цифри', field: 'pop' };
    population = n > 0 ? n : null; // 0 = "невідомо", як і порожнє поле
  }

  return { item: { name: raw.name, description: raw.desc, timer_minutes: timer, stay_time_months: stay, population, extra: {} } };
}

// "Додати" / "Зберегти зміни" — залежно від режиму форми. Після успіху дані з’являються в полі-списку, а поля форми очищаються.
function submitCata() {
  const result = readCataForm();
  if (result.error) {
    showCataError(result.error, result.field);
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
    renderCataList();
    newCataIndex = -1;
    $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
  showGlobalToast(existing ? 'Катаклізм оновлено' : 'Катаклізм додано');
}

// Клік по назві у списку → поля форми заповнюються даними цього катаклізму
function startCataEdit(index) {
  const item = form.cataclysms[index];
  if (!item) return;
  const values = cataFieldStrings(item);
  for (const key of Object.keys(CATA_FIELDS)) $(CATA_FIELDS[key]).value = values[key];
  showCataError('');
  setCataMode(index);
  $('pe-cata').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onCataListClick(e) {
  const row = e.target.closest('[data-cata-index]');
  if (!row) return;

  const index = Number(row.dataset.cataIndex);
  if (!form.cataclysms[index] || index === cataEditIndex) return;

  // Якщо у формі є незбережене, не перезаписуємо її даними іншого катаклізму — спочатку має бути "Додати"/"Зберегти зміни" або "Скасувати"
  if (cataDraftPending()) {
    showGlobalToast('Спочатку натисніть "Додати" / "Зберегти зміни" або "Скасувати" у формі');
    return;
  }

  startCataEdit(index);
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
  const key = CATA_NUMERIC.find(k => CATA_FIELDS[k] === e.target.id);
  if (key) {
    const cleaned = e.target.value.replace(/\D/g, '');
    if (cleaned !== e.target.value) e.target.value = cleaned;
  }
  if (!$('pe-cata-error').hidden) showCataError('');
}

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
  const error = validateTitle(title);
  if (error) {
    showTitleError(error);
    $('pe-title').focus();
    return;
  }

  const rangeError = validateRanges();
  if (rangeError) {
    showGlobalToast(rangeError);
    return;
  }

  // Заповнену, але не додану форму катаклізму не зберігаємо мовчки разом з паком — автор має спочатку натиснути "Додати" або "Скасувати"
  if (cataDraftPending()) {
    showGlobalToast('У формі катаклізму є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }

  // 3.3: рядки масового вводу → [{ pool_type, category, value, meta: {} }]
  const cards = buildCardRows(form.texts, extraMeta, form.cataclysms);
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
  if (!pack || pack.forbidden || pack.isDefault) {
    // Чужий пак (напр., вручну введений id в URL) — негайно назад у список зі сповіщенням
    showGlobalToast(pack?.forbidden
      ? 'У вас немає прав для редагування цього пака'
      : (pack?.isDefault ? 'Дефолтний пак не можна редагувати' : 'Пак не знайдено'));
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

  // Катаклізми: клік по назві у полі-списку відкриває їх у формі, кнопки форми додають/зберігають/видаляють
  $('pe-cata-list').addEventListener('click', onCataListClick);
  $('pe-cata').addEventListener('click', handleCataClick);
  $('pe-cata').addEventListener('input', handleCataInput);

  $('pe-cards').addEventListener('input', e => {
    if (activeCategory === 'cataclysm') return; // список катаклізмів не редагується текстом (джерело — form.cataclysms)
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

  $('pe-ranges').addEventListener('input', e => {
    const field = e.target.closest('[data-range]');
    if (!field) return;
    form.ranges[field.dataset.range] = field.value;
    updateButtons();
  });

  $('pe-actions').addEventListener('click', handleActionsClick);

  try {
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
