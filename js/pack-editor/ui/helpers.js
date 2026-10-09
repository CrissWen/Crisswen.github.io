import { esc } from '../../utils/escape-html.js';
import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, POOL_TYPE_BY_CATEGORY } from '../categories.js';
import { CATACLYSM_LIMITS, STAGE_KEYS, OBJECT_STAGE_KEYS, parseStageEntry } from '../payload.js';
import { parseLines } from '../parser.js';
import { renderDynamicFormFields } from './dynamic.js';
import { stageRowHtml } from './template.js';

// ===== UI редактора паків: загальні хелпери DOM =====
// Усі функції отримують дані аргументами й нічого не знають про стан сторінки.

export const TITLE_MAX = 100;
export const DESC_MAX = 255;

const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';
const PROFESSION_PLACEHOLDER = 'Введіть професії стовпчиком (через Enter). Щоб додати професійну можливість, напишіть її через тире з пробілами. Наприклад: Лікар-хірург - Може вилікувати одну хворобу';

export const CATACLYSM_LIST_PLACEHOLDER = 'Тут з\'являться додані катаклізми. Заповніть поля нижче й натисніть "Додати". Щоб змінити або видалити катаклізм — натисніть на його назву тут.';

export function placeholderFor(category) {
  if (category === 'profession') return PROFESSION_PLACEHOLDER;
  if (category === 'cataclysm') return CATACLYSM_LIST_PLACEHOLDER;
  return TEXTAREA_PLACEHOLDER;
}

const STAGE_LABELS = { profession: 'Стаж професії', hobby: 'Рівень хобі', health: 'Ступінь хвороби', body_type: 'Дефолтні типи статури' };
export const STAGE_FIELDS = STAGE_KEYS.map(key => ({ key, label: STAGE_LABELS[key] }));

export const RANGE_FIELDS = [
  { key: 'ageMin',    label: 'Мін. вік',    min: 1,  max: 120 },
  { key: 'ageMax',    label: 'Макс. вік',   min: 1,  max: 120 },
  { key: 'heightMin', label: 'Мін. зріст',  min: 50, max: 300 },
  { key: 'heightMax', label: 'Макс. зріст', min: 50, max: 300 }
];

export const CATA_FIELDS = { name: 'pe-cata-name', desc: 'pe-cata-desc', timer: 'pe-cata-timer', stay: 'pe-cata-stay', pop: 'pe-cata-pop' };
export const CATA_NUMERIC = ['timer', 'stay', 'pop'];

export const $ = id => document.getElementById(id);

// ----- Життєвий цикл сторінки -----
export const isEditorMounted = () => Boolean($('pe-root'));
export const markEditorLoaded = () => $('pe-root').classList.remove('is-loading');
export const focusTitle = () => $('pe-title').focus();

// ----- Оновлення елементів -----
export function renderSummary(counts, activeCategory) {
  const categories = ALL_PACK_CATEGORIES.map(c => ({ ...c, count: counts[c.category] || 0 }));
  const charTotal = categories.filter(c => c.poolType === "character").reduce((sum, c) => sum + c.count, 0);
  const bunkerTotal = categories.filter(c => c.poolType === "bunker").reduce((sum, c) => sum + c.count, 0);
  const total = charTotal + bunkerTotal;

  const totalEl = $("pe-summary-total");
  if (totalEl) totalEl.textContent = `Усього: ${total} (П: ${charTotal}, Б: ${bunkerTotal})`;

  const chipsEl = $("pe-chips");
  if (chipsEl) {
    const renderItem = c => `<button type="button" class="pe-char-menu-item${c.category === activeCategory ? " is-active" : ""}" data-chip="${esc(c.category)}">${esc(c.label)} <span>${c.count > 0 ? `(${c.count})` : ""}</span></button>`;
      
    const chars = categories.filter(c => c.poolType === "character").map(renderItem).join("");
    const bunkers = categories.filter(c => c.poolType === "bunker").map(renderItem).join("");

    chipsEl.innerHTML = `
      <div class="pe-char-menu-heading">Персонаж</div>
      ${chars}
      <div class="pe-char-menu-heading">Бункер</div>
      ${bunkers}
    `;
  }
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

// Кнопка копіювання промпту активна лише при ввімкненому режимі LLM.
export function setLlmCopyVisible(on) {
  $('pe-llm-slot')?.classList.toggle('is-active', Boolean(on));
}

// Показує категорію: перемикає textarea / списки / форми залежно від наявності схеми та режиму
export function showCategory({ category, text, viewMode = "visual" }) {
  const mainEl = document.querySelector(".pe-char-main");
  if (mainEl) {
    mainEl.classList.remove("is-updating");
    void mainEl.offsetWidth;
    mainEl.classList.add("is-updating");
  }
  const isCata = category === "cataclysm";
  const schema = CATEGORY_SCHEMAS[category];
  const hasVisualMode = isCata || Boolean(schema);
  
  const categoryLabelStr = ALL_PACK_CATEGORIES.find(c => c.category === category)?.label || category;
  const breadcrumb = $("pe-cat-breadcrumb");
  if (breadcrumb) breadcrumb.textContent = categoryLabelStr;
  const title = $("pe-cat-title");
  if (title) title.textContent = categoryLabelStr;
  const dynLabel = $("pe-dyn-category-label");
  if (dynLabel) dynLabel.textContent = `Створення у категорію "${categoryLabelStr}"`;

  $("pe-cards").value = text;
  $("pe-cards").placeholder = isCata 
    ? CATACLYSM_LIST_PLACEHOLDER 
    : (hasVisualMode && viewMode === "visual") 
      ? "Список карток (додавайте через форму нижче)" 
      : placeholderFor(category);
  
  const llmCheckbox = $("pe-llm-mode");
  const llmToggleWrap = llmCheckbox?.closest(".pe-check");
  if (llmCheckbox && llmToggleWrap) {
    llmToggleWrap.classList.toggle("is-unavailable", !hasVisualMode);
    llmCheckbox.disabled = !hasVisualMode;
    llmCheckbox.checked = hasVisualMode && viewMode === "llm";
  }
  setLlmCopyVisible(Boolean(llmCheckbox?.checked));

  const isVisual = hasVisualMode && (viewMode === "visual");
  
  if (isVisual) {
    $('pe-cards').hidden = true;
    $('pe-cata-list').hidden = false;
    
    if (isCata) {
      $('pe-cata').hidden = false;
      $('pe-dynamic-form').hidden = true;
    } else {
      $('pe-cata').hidden = true;
      $('pe-dynamic-form').hidden = false;
      updateDynamicNameField(category);
      renderDynamicFormFields(schema);
    }
  } else {
    $('pe-cards').hidden = false;
    $('pe-cata-list').hidden = true;
    $('pe-cata').hidden = true;
    $('pe-dynamic-form').hidden = true;
  }
  
  const formCol = $("pe-cata")?.closest(".pe-char-form-col");
  if (formCol) formCol.hidden = !isVisual;
  
  $("pe-cards").scrollTop = 0;
}

const MULTILINE_NAME_CATEGORIES = ['special_ability', 'backpack', 'large_inventory'];

export function updateDynamicNameField(category) {
  const container = $('pe-dyn-name-wrap');
  if (!container) return;
  const currentEl = $('pe-dyn-name');
  const currentValue = currentEl ? currentEl.value : '';
  const isMultiline = POOL_TYPE_BY_CATEGORY[category] === 'bunker' || MULTILINE_NAME_CATEGORIES.includes(category);
  
  if (isMultiline) {
    if (currentEl && currentEl.tagName.toLowerCase() === 'textarea') return;
    container.innerHTML = `
      <label class="pe-label" for="pe-dyn-name">Назва <span class="pe-required" title="Обов'язкове поле">*</span></label>
      <textarea id="pe-dyn-name" class="pe-input pe-desc pe-input--name" rows="3" placeholder="Введіть назву"></textarea>
    `;
  } else {
    if (currentEl && currentEl.tagName.toLowerCase() === 'input') return;
    container.innerHTML = `
      <label class="pe-label" for="pe-dyn-name">Назва <span class="pe-required" title="Обов'язкове поле">*</span></label>
      <input id="pe-dyn-name" class="pe-input" type="text" autocomplete="off" placeholder="Введіть назву">
    `;
  }
  const newEl = $('pe-dyn-name');
  if (newEl && currentValue) newEl.value = currentValue;
}

export function updateStageListVisuals(key) {
  const container = document.querySelector(`[data-stage-list="${key}"]`);
  if (!container) return;
  const rows = [...container.querySelectorAll('.pe-stage-row')];
  if (!rows.length) return;

  const isTime = OBJECT_STAGE_KEYS.includes(key);
  if (!isTime) return;

  let prevMax = 0;

  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    const isFirst = index === 0;
    
    const fromWrap = row.querySelector('.pe-stage-from-wrap');
    const toWrap = row.querySelector('.pe-stage-to-wrap');
    const toText = row.querySelector('.pe-stage-to-text');
    const moreText = row.querySelector('.pe-stage-more-text');
    
    if (fromWrap) {
      if (isFirst) {
        fromWrap.style.display = 'none';
      } else {
        fromWrap.style.display = 'flex';
        const minMonths = prevMax + 1;
        const minY = Math.floor(minMonths / 12);
        const minM = minMonths % 12;
        const minYEl = row.querySelector('[data-type="min-y"]');
        const minMEl = row.querySelector('[data-type="min-m"]');
        if (minYEl) minYEl.value = minY;
        if (minMEl) minMEl.value = minM;
      }
    }
    
    if (toWrap) {
      const timeField = toWrap.querySelector('.pe-time-field');
      if (isLast) {
        if (timeField) timeField.style.display = 'none';
        if (toText) toText.style.display = 'none';
        if (moreText) moreText.style.display = isFirst ? 'none' : 'inline';
        toWrap.style.display = isFirst ? 'none' : 'flex';
      } else {
        if (timeField) timeField.style.display = 'inline-flex';
        if (toText) toText.style.display = 'inline';
        if (moreText) moreText.style.display = 'none';
        toWrap.style.display = 'flex';
      }
    }
    
    if (toWrap && toWrap.style.display !== 'none') {
      const y = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
      const m = parseInt(row.querySelector('[data-type="m"]')?.value, 10) || 0;
      prevMax = y * 12 + m;
    }
  });
}

export function renderStageList(key, textValue) {
  const container = document.querySelector(`[data-stage-list="${key}"]`);
  if (!container) return;
  const lines = parseLines(textValue);
  let html = lines.map(line => {
    const entry = parseStageEntry(key, line);
    return stageRowHtml(key, entry);
  }).join('');
  // Always include one empty row at the bottom (database-like insertion)
  html += stageRowHtml(key, { name: '' });
  container.innerHTML = html;
  updateStageListVisuals(key);
}

export function gatherStageText(key) {
  updateStageListVisuals(key);
  const container = document.querySelector(`[data-stage-list="${key}"]`);
  if (!container) return '';
  const rows = [...container.querySelectorAll('.pe-stage-row')];
  
  // Filter out rows without a name (e.g. the trailing empty database row)
  const validRows = rows.filter(row => row.querySelector('.pe-stage-name')?.value?.trim());

  return validRows.map((row, index) => {
    const isLast = index === validRows.length - 1;
    const name = row.querySelector('.pe-stage-name').value.trim();
    if (OBJECT_STAGE_KEYS.includes(key)) {
      const y = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
      const m = parseInt(row.querySelector('[data-type="m"]')?.value, 10) || 0;
      const total = y * 12 + m;
      if (total > 0 && !isLast) {
        return `${name}: ${total}`;
      }
    }
    return name;
  }).join('\n');
}

export function setStagesViewMode(mode) {
  const isLlm = mode === 'llm';
  const stagesContainer = $('pe-stages');
  if (stagesContainer) {
    stagesContainer.classList.toggle('is-llm-mode', isLlm);
  }
  const llmCheckbox = $('pe-stages-llm');
  if (llmCheckbox) {
    llmCheckbox.checked = isLlm;
  }

  STAGE_KEYS.forEach(key => {
    const list = document.querySelector(`[data-stage-list="${key}"]`);
    const ta = document.querySelector(`[data-stage-ta="${key}"]`);
    const note = list?.parentElement?.querySelector('.pe-stage-note');
    if (list) list.hidden = isLlm;
    if (ta) ta.hidden = !isLlm;
    if (note) note.hidden = isLlm;
  });
}

// Повністю перемальовує значення полів зі стану форми (після "Очистити все" / "Скасувати зміни" / завантаження пака)
export function fillFields(form) {
  $('pe-title').value = form.title;
  $('pe-desc').value = form.description;
  STAGE_KEYS.forEach(key => {
    renderStageList(key, form.stages[key] || '');
    const ta = document.querySelector(`[data-stage-ta="${key}"]`);
    if (ta) ta.value = form.stages[key] || '';
  });
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
  ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return true;
}

// Фокус на сусідню кнопку-рядок у тому самому списку (dir: 1 — нижче, -1 — вище). false — сусіда немає
export function focusSiblingRow(btn, dir) {
  const rows = [...btn.parentElement.querySelectorAll('button')];
  const next = rows[rows.indexOf(btn) + dir];
  if (!next) return false;
  next.focus();
  return true;
}

