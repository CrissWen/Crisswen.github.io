import { esc } from '../utils/escape-html.js';
import { CHARACTER_CATEGORIES, BUNKER_CATEGORIES, ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS } from './categories.js';
import { CATACLYSM_LIMITS, STAGE_KEYS } from './payload.js';
import { oneLine } from './parser.js';
import { normalizeSearch, cataMatches } from './search.js';

// ===== UI редактора паків: розмітка і робота з DOM =====
// Усі функції отримують дані аргументами й нічого не знають про стан сторінки (form, activeCategory, пошуковий запит...):
// стан, валідація, збереження і обробники подій — у pages/pack-editor.js. Тут лише "намалювати" і "прочитати/записати поле".

export const TITLE_MAX = 100;
export const DESC_MAX = 255;
const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';
// Спеціальний плейсхолдер: підказує синтаксис "Професія - Можливість", який parseCards (pack-parser.js) розбирає саме для цієї категорії.
const PROFESSION_PLACEHOLDER = 'Введіть професії стовпчиком (через Enter). Щоб додати професійну можливість, напишіть її через тире з пробілами. Наприклад: Лікар-хірург - Може вилікувати одну хворобу';

// Катаклізми редагуються не текстом, а формою під списком (блок "Катаклізми" нижче): у полі лише відображаються назви доданих катаклізмів.
export const CATACLYSM_LIST_PLACEHOLDER = 'Тут з’являться додані катаклізми. Заповніть поля нижче й натисніть "Додати". Щоб змінити або видалити катаклізм — натисніть на його назву тут.';

export function placeholderFor(category) {
  if (category === 'profession') return PROFESSION_PLACEHOLDER;
  if (category === 'cataclysm') return CATACLYSM_LIST_PLACEHOLDER;
  return TEXTAREA_PLACEHOLDER;
}

// Ключі (STAGE_KEYS у pack-payload.js) збігаються з packs.config.default_stages, які читає ігровий рушій (game-generator.js, characteristics.js); тут лише підписи
const STAGE_LABELS = { profession: 'Стаж професії', hobby: 'Рівень хобі', health: 'Ступінь хвороби' };
export const STAGE_FIELDS = STAGE_KEYS.map(key => ({ key, label: STAGE_LABELS[key] }));

// Діапазони віку/зросту, які читає ігровий рушій з packs.config.age_range / height_range
// (game-generator.js при старті гри, host/characteristics.js при переролі статі/статури ведучим).
export const RANGE_FIELDS = [
  { key: 'ageMin',    label: 'Мін. вік',    min: 1,  max: 120 },
  { key: 'ageMax',    label: 'Макс. вік',   min: 1,  max: 120 },
  { key: 'heightMin', label: 'Мін. зріст',  min: 50, max: 300 },
  { key: 'heightMax', label: 'Макс. зріст', min: 50, max: 300 }
];

// id полів форми катаклізму
export const CATA_FIELDS = { name: 'pe-cata-name', desc: 'pe-cata-desc', timer: 'pe-cata-timer', stay: 'pe-cata-stay', pop: 'pe-cata-pop' };
export const CATA_NUMERIC = ['timer', 'stay', 'pop'];

export const $ = id => document.getElementById(id);

// ----- Розмітка -----
// counts — { [category]: кількість рядків }; без нього підписи без лічильників
function categoryLabel(c, counts = {}) {
  const count = counts[c.category] || 0;
  return count ? `${c.label} (${count})` : c.label;
}

function optionsHtml(list, counts) {
  return list.map(c => `<option value="${esc(c.category)}">${esc(categoryLabel(c, counts))}</option>`).join('');
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

// Розмітка всієї сторінки. isEdit — редагування існуючого пака, isDefaultEdit — редагування базового пака (лише адмін)
export function packEditorTemplate({ isEdit, isDefaultEdit }) {
  let saveLabel;
  if (isDefaultEdit) saveLabel = 'Оновити базовий пак';
  else if (isEdit) saveLabel = 'Оновити особистий пак';
  else saveLabel = 'Створити особистий пак';

  // У базовому паку кнопки "Очистити все" немає: його не можна залишити порожнім (на ньому базується гра)
  const clearButton = isDefaultEdit
    ? ''
    : '<button type="button" class="pk-btn pk-btn--ghost" data-action="clear">Очистити все</button>';

  const buttons = isEdit
    ? `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="reset">Скасувати зміни</button>
      ${clearButton}
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
          <div class="pe-field pe-view-toggle" id="pe-view-toggle-wrap" hidden>
            <label class="pe-label" for="pe-view-toggle">Режим вводу</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <select id="pe-view-toggle" class="pe-input pe-select" style="max-width: 250px;">
                <option value="visual">Візуальний список (картки)</option>
                <option value="llm">Режим LLM (Текст)</option>
              </select>
              <button type="button" id="pe-llm-copy" class="pk-btn pk-btn--ghost" title="Скопіювати промпт для LLM" style="padding: 0 12px; height: 38px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
          </div>
          <div class="pe-field">
            <textarea id="pe-cards" class="pe-input pe-cards" placeholder="${esc(TEXTAREA_PLACEHOLDER)}" spellcheck="false"></textarea>
            <div id="pe-cata-list" class="pe-cata-list" role="group" aria-label="Додані катаклізми" hidden></div>
            <span id="pe-lines-count" class="pe-counter">Рядків: 0</span>
          </div>

          <!-- Форма катаклізму: видна лише для категорії "Катаклізм" (перемикає showCategory) -->
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

          <!-- Форма для динамічних категорій -->
          <div id="pe-dynamic-form" class="pe-cata" hidden>
            <h3 id="pe-dyn-mode" class="pe-cata__title">Нова картка</h3>
            <p class="pe-hint">Список вище лише для перегляду. Щоб змінити або видалити картку, натисніть на її назву у списку.</p>
            <div class="pe-field">
              <label class="pe-label" for="pe-dyn-name">Назва <span class="pe-required" title="Обов'язкове поле">*</span></label>
              <input id="pe-dyn-name" class="pe-input" type="text" autocomplete="off" placeholder="Введіть назву">
            </div>
            <div id="pe-dyn-fields"></div>
            <p id="pe-dyn-error" class="pe-error" role="alert" hidden></p>
            <div class="pe-cata__actions">
              <button type="button" class="pk-btn pk-btn--primary" data-dyn-action="submit">Додати</button>
              <button type="button" class="pk-btn pk-btn--ghost" data-dyn-action="cancel" hidden>Скасувати</button>
              <button type="button" class="pk-btn pk-btn--danger" data-dyn-action="delete" hidden>Видалити</button>
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

// ----- Життєвий цикл сторінки -----
// Користувач міг устигнути піти зі сторінки, поки вантажились дані — тоді DOM уже інший
export const isEditorMounted = () => Boolean($('pe-root'));
export const markEditorLoaded = () => $('pe-root').classList.remove('is-loading');
export const focusTitle = () => $('pe-title').focus();

// ----- Оновлення елементів -----
// counts — { [category]: кількість рядків }
export function renderSummary(counts, activeCategory) {
  const filled = ALL_PACK_CATEGORIES
    .map(c => ({ ...c, count: counts[c.category] || 0 }))
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

export function updateCategoryOptionLabels(counts) {
  $('pe-category').querySelectorAll('option').forEach(option => {
    const c = ALL_PACK_CATEGORIES.find(x => x.category === option.value);
    if (c) option.textContent = categoryLabel(c, counts); // змінюємо лише текст, щоб select не втрачав фокус
  });
}

// dirty — є незбережені зміни (вмикає "Скасувати зміни"), empty — форма порожня (вимикає "Очистити все")
export function updateButtons({ dirty, empty }) {
  const reset = document.querySelector('[data-action="reset"]');
  const clear = document.querySelector('[data-action="clear"]');
  if (reset) reset.disabled = !dirty;
  if (clear) clear.disabled = empty;
}

export function updateCardsMeta(isCata, count) {
  $('pe-lines-count').textContent = isCata ? `Катаклізмів: ${count}` : `Рядків: ${count}`;
}

export function updateDescCounter() {
  $('pe-desc-counter').textContent = `${$('pe-desc').value.length}/${DESC_MAX}`;
}

export function showTitleError(message) {
  const el = $('pe-title-error');
  el.textContent = message || '';
  el.hidden = !message;
  $('pe-title').classList.toggle('is-invalid', Boolean(message));
}

// Стан кнопки (наприклад, "Збереження..." на час запиту)
export function setButtonState(btn, { disabled, text }) {
  btn.disabled = disabled;
  btn.textContent = text;
}

// ----- Поля форми -----
export const getCardsText = () => $('pe-cards').value;

// Показує категорію: перемикає textarea / списки / форми залежно від наявності схеми та режиму
export function showCategory({ category, text, viewMode = 'visual' }) {
  const isCata = category === 'cataclysm';
  const schema = CATEGORY_SCHEMAS[category];
  const hasVisualMode = isCata || Boolean(schema);
  
  $('pe-category').value = category;
  $('pe-cards').value = text;
  $('pe-cards').placeholder = isCata ? CATACLYSM_LIST_PLACEHOLDER : (hasVisualMode && viewMode === 'visual') ? 'Список карток (додавайте через форму нижче)' : placeholderFor(category);
  
  const toggleWrap = $('pe-view-toggle-wrap');
  if (schema && !isCata) {
    toggleWrap.hidden = false;
    $('pe-view-toggle').value = viewMode;
    $('pe-llm-copy').hidden = (viewMode !== 'llm');
  } else {
    toggleWrap.hidden = true;
    $('pe-llm-copy').hidden = true;
  }

  const isVisual = viewMode === 'visual' || isCata;
  
  if (hasVisualMode && isVisual) {
    $('pe-cards').hidden = true;
    $('pe-cata-list').hidden = false;
    
    if (isCata) {
      $('pe-cata').hidden = false;
      $('pe-dynamic-form').hidden = true;
    } else {
      $('pe-cata').hidden = true;
      $('pe-dynamic-form').hidden = false;
      renderDynamicFormFields(schema);
    }
  } else {
    $('pe-cards').hidden = false;
    $('pe-cata-list').hidden = true;
    $('pe-cata').hidden = true;
    $('pe-dynamic-form').hidden = true;
  }
  
  $('pe-cards').scrollTop = 0;
}

export function renderDynamicFormFields(schema) {
  const container = $('pe-dyn-fields');
  if (!schema || !schema.fields) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = schema.fields.map(f => {
    if (f.type === 'checkbox') {
      return `
        <div class="pe-field" style="flex-direction: row; align-items: center; gap: 8px;">
          <input id="pe-dyn-${f.key}" type="checkbox" data-dyn-key="${f.key}">
          <label class="pe-label" for="pe-dyn-${f.key}" style="margin: 0; padding-bottom: 0;">${esc(f.label)}</label>
        </div>`;
    } else if (f.type === 'list') {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc" rows="3" data-dyn-key="${f.key}"></textarea>
        </div>`;
    } else {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <input id="pe-dyn-${f.key}" class="pe-input" type="text" data-dyn-key="${f.key}" autocomplete="off">
        </div>`;
    }
  }).join('');
}

// Повністю перемальовує значення полів зі стану форми (після "Очистити все" / "Скасувати зміни" / завантаження пака)
export function fillFields(form) {
  $('pe-title').value = form.title;
  $('pe-desc').value = form.description;
  document.querySelectorAll('[data-stage]').forEach(el => { el.value = form.stages[el.dataset.stage] || ''; });
  document.querySelectorAll('[data-range]').forEach(el => { el.value = form.ranges[el.dataset.range] ?? ''; });
}

// Вертикальна позиція символа в textarea (з урахуванням переносів): рахуємо у прихованому дзеркалі з тими самими шрифтом і шириною
function textareaOffsetTop(ta, offset) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
    mirror.style[prop] = cs[prop];
  }
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0',
    boxSizing: 'border-box', width: `${ta.clientWidth}px`, border: '0',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word'
  });
  mirror.textContent = ta.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

// Виділяє рядок lineIndex у textarea й прокручує до нього. false — рядка вже немає (текст змінився)
export function selectCardsLine(lineIndex) {
  const ta = $('pe-cards');
  const lines = ta.value.split('\n');
  const line = lines[lineIndex];
  if (line === undefined || !line.trim()) return false;

  let start = 0;
  for (let i = 0; i < lineIndex; i++) start += lines[i].length + 1;
  start += line.search(/\S/);
  const end = start + line.trim().length;

  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  ta.scrollTop = Math.max(0, textareaOffsetTop(ta, start) - ta.clientHeight / 3);
  ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return true;
}

// ----- Пошук: рендер -----
// Екранований HTML з підсвіченими збігами (<mark>). Якщо нормалізація змінила довжину рядка, позиції б зсунулись — тоді без підсвітки.
function highlightHtml(text, tokens) {
  const src = String(text ?? '');
  if (!tokens || !tokens.length) return esc(src);
  const normalized = normalizeSearch(src);
  if (normalized.length !== src.length) return esc(src);

  const ranges = [];
  for (const token of tokens) {
    let from = 0;
    let at;
    while ((at = normalized.indexOf(token, from)) !== -1) {
      ranges.push([at, at + token.length]);
      from = at + token.length;
    }
  }
  if (!ranges.length) return esc(src);

  ranges.sort((a, b) => a[0] - b[0]);
  let html = '';
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue; // діапазон повністю всередині вже підсвіченого
    const start = Math.max(s, pos);
    html += esc(src.slice(pos, start)) + `<mark class="pe-mark">${esc(src.slice(start, e))}</mark>`;
    pos = e;
  }
  return html + esc(src.slice(pos));
}

// Уривок опису катаклізму навколо першого збігу (порожній рядок, якщо в описі збігів немає)
function snippetHtml(text, tokens) {
  const src = oneLine(text);
  const normalized = normalizeSearch(src);
  if (!src || normalized.length !== src.length) return '';
  const hits = tokens.map(t => normalized.indexOf(t)).filter(i => i >= 0);
  if (!hits.length) return '';
  const from = Math.max(0, Math.min(...hits) - 30);
  const part = src.slice(from, from + 90);
  return `<small class="pe-result__snippet">${from > 0 ? '…' : ''}${highlightHtml(part, tokens)}${from + 90 < src.length ? '…' : ''}</small>`;
}

function resultRowHtml(r, tokens, searchAll) {
  if (r.type === 'cata') {
    return `
      <button type="button" class="added-item-row pe-result" data-res-cat="${esc(r.category)}" data-res-cata="${r.index}">
        <span class="added-item-row__name">${highlightHtml(oneLine(r.item.name), tokens)}${snippetHtml(r.item.description, tokens)}</span>
        <span class="pe-result__meta">${esc(r.label)}</span>
      </button>`;
  }
  const where = `${searchAll ? `${esc(r.label)} · ` : ''}рядок ${r.line + 1}`;
  return `
    <button type="button" class="added-item-row pe-result" data-res-cat="${esc(r.category)}" data-res-line="${r.line}">
      <span class="added-item-row__name">${highlightHtml(r.text, tokens)}</span>
      <span class="pe-result__meta">${where}</span>
    </button>`;
}

// Перемальовує панель результатів, лічильник і кнопку "×".
// view: { query, tokens, searchAll, mode } і залежно від mode:
//   'idle'        — запиту немає: панель прихована;
//   'cata-filter' — фільтрується сам список катаклізмів (cataCount — скільки збігів), окрема панель не потрібна;
//   'results'     — список знайдених рядків (results, total з collectSearchResults).
export function paintSearch(view) {
  const panel = $('pe-search-results');
  if (!panel) return;
  const count = $('pe-search-count');
  $('pe-search-clear').hidden = !view.query;

  if (view.mode === 'idle') {
    panel.hidden = true;
    panel.innerHTML = '';
    count.textContent = '';
    return;
  }

  if (view.mode === 'cata-filter') {
    panel.hidden = true;
    panel.innerHTML = '';
    count.textContent = view.cataCount ? `Знайдено: ${view.cataCount}` : 'Нічого не знайдено';
    return;
  }

  const { results, total, tokens, query, searchAll } = view;
  panel.hidden = false;
  if (!total) {
    count.textContent = 'Нічого не знайдено';
    panel.innerHTML = `<p class="pe-cata-list__empty">Нічого не знайдено за запитом "${esc(query.trim())}"${searchAll ? '' : '. Спробуйте увімкнути "У всіх категоріях"'}</p>`;
    return;
  }
  count.textContent = total > results.length ? `Знайдено: ${total} (показано ${results.length})` : `Знайдено: ${total}`;
  panel.innerHTML = results.map(r => resultRowHtml(r, tokens, searchAll)).join('');
}

// Початкові значення елементів пошуку (на старті сторінки)
export function initSearchControls({ query, all }) {
  $('pe-search').value = query;
  $('pe-search-all').checked = all;
}

export function setSearchInput(value) {
  const input = $('pe-search');
  if (input.value !== value) input.value = value;
}

export const focusSearchInput = () => $('pe-search').focus();

// Перший елемент, на який можна перейти з поля пошуку (результат або відфільтрований катаклізм)
export function firstSearchTargetEl(cataFilterActive) {
  const panel = $('pe-search-results');
  if (!panel.hidden) return panel.querySelector('.pe-result');
  if (cataFilterActive) return $('pe-cata-list').querySelector('[data-cata-index]');
  return null;
}

// ----- Катаклізми: форма і список -----
export function readCataRaw() {
  const get = key => $(CATA_FIELDS[key]).value.trim();
  return { name: get('name'), desc: get('desc'), timer: get('timer'), stay: get('stay'), pop: get('pop') };
}

export const isCataErrorVisible = () => !$('pe-cata-error').hidden;

// Числові поля форми катаклізму приймають лише цифри (при вставці "50 000" → 50000); для решти полів нічого не робить
export function sanitizeCataNumericInput(target) {
  const key = CATA_NUMERIC.find(k => CATA_FIELDS[k] === target.id);
  if (!key) return;
  const cleaned = target.value.replace(/\D/g, '');
  if (cleaned !== target.value) target.value = cleaned;
}

// Фокус на сусідню кнопку-рядок у тому самому списку (dir: 1 — нижче, -1 — вище). false — сусіда немає
export function focusSiblingRow(btn, dir) {
  const rows = [...btn.parentElement.querySelectorAll('button')];
  const next = rows[rows.indexOf(btn) + dir];
  if (!next) return false;
  next.focus();
  return true;
}

export function showCataError(message, key) {
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

// Режим форми: item — катаклізм, що редагується (змінює заголовок, підпис кнопки і показує "Скасувати"/"Видалити"), null — додавання нового
export function paintCataMode(item) {
  $('pe-cata-mode').textContent = item ? `Редагування: "${oneLine(item.name)}"` : 'Новий катаклізм';
  document.querySelector('[data-cata-action="submit"]').textContent = item ? 'Зберегти зміни' : 'Додати';
  document.querySelector('[data-cata-action="cancel"]').hidden = !item;
  document.querySelector('[data-cata-action="delete"]').hidden = !item;
}

// Таймер лишається порожнім, щоб було видно підказку в полі; порожнє = 0 (без таймера)
export function clearCataFields() {
  Object.values(CATA_FIELDS).forEach(id => { $(id).value = ''; });
}

// values — { name, desc, timer, stay, pop } рядками
export function fillCataFields(values) {
  for (const key of Object.keys(CATA_FIELDS)) $(CATA_FIELDS[key]).value = values[key];
}

export const scrollCataFormIntoView = () => $('pe-cata').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
export const scrollCataListToEnd = () => $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'nearest' });

// Список доданих катаклізмів — справжні рядки (кнопки .added-item-row), а не текст у textarea: підсвічування при наведенні,
// "протискання" й виділення обраного рядка робить CSS (packs.css), без вимірювань геометрії та JS-анімацій.
// view: { cataclysms, editIndex, newIndex, tokens }; tokens — слова пошуку, якщо список зараз фільтрується (інакше порожній масив).
export function renderCataList({ cataclysms, editIndex, newIndex, tokens }) {
  const list = $('pe-cata-list');
  // Перемальовка замінює кнопки, тож клавіатурний фокус треба повернути на рядок з тим самим індексом
  const focusedIndex = document.activeElement?.closest?.('[data-cata-index]')?.dataset.cataIndex;

  if (!cataclysms.length) {
    list.innerHTML = `<p class="pe-cata-list__empty">${esc(CATACLYSM_LIST_PLACEHOLDER)}</p>`;
    return;
  }

  // Пошук по катаклізмах фільтрує сам список; рядок, що зараз відкритий у формі, лишається видимим, навіть якщо не збігається
  const rows = cataclysms
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => !tokens.length || i === editIndex || cataMatches(c, tokens));
  if (!rows.length) {
    list.innerHTML = '<p class="pe-cata-list__empty">Нічого не знайдено за запитом</p>';
    return;
  }

  list.innerHTML = rows.map(({ c, i }) => {
    const selected = i === editIndex;
    const isNew = i === newIndex;
    return `
      <button type="button" class="added-item-row${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}" data-cata-index="${i}" aria-pressed="${selected}">
        <span class="added-item-row__name">${highlightHtml(oneLine(c.name), tokens)}</span>
        <span class="added-item-row__hint">${selected ? 'редагується' : 'змінити'}</span>
      </button>`;
  }).join('');

  if (focusedIndex !== undefined) list.querySelector(`[data-cata-index="${focusedIndex}"]`)?.focus();
}
