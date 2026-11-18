import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, POOL_TYPE_BY_CATEGORY } from '../categories.js';
import { TITLE_MAX, DESC_MAX } from '../constants.js';
import { STAGE_KEYS, parseStageEntry } from '../payload.js';
import { parseLines } from '../parser.js';
import { $ } from './shared.js';
import { CATACLYSM_LIST_PLACEHOLDER, TEXTAREA_PLACEHOLDER, PROFESSION_PLACEHOLDER, MULTILINE_NAME_CATEGORIES } from './constants.js';
import { renderDynamicFormFields } from './dynamic.js';
import { renderStageList, renderDynStageList } from './stage-list.js';
import { initStageSortables } from './stage-sortable.js';
import { state } from '../state.js';

// ===== UI редактора паків: загальні хелпери DOM =====
// Усі функції отримують дані аргументами й нічого не знають про стан сторінки.
// Тут лишилися хелпери форми й категорії; решта винесена в constants / stage-list / stage-sortable / summary,
// а публічні експорти реекспортуються звідси, щоб імпортери (ui.js, editor.js, bindings) не змінювались.

export { TITLE_MAX, DESC_MAX };
export { CATACLYSM_LIST_PLACEHOLDER, STAGE_FIELDS, RANGE_FIELDS, CATA_FIELDS, CATA_NUMERIC } from './constants.js';
export { $ } from './shared.js';
export * from './stage-list.js';
export * from './stage-sortable.js';
export * from './summary.js';

export function placeholderFor(category) {
  if (category === 'profession') return PROFESSION_PLACEHOLDER;
  if (category === 'cataclysm') return CATACLYSM_LIST_PLACEHOLDER;
  return TEXTAREA_PLACEHOLDER;
}





// ----- Життєвий цикл сторінки -----
export const isEditorMounted = () => Boolean($('pe-root'));
export const markEditorLoaded = () => $('pe-root').classList.remove('is-loading');
export const focusTitle = () => $('pe-title').focus();

export function showTitleError(message) {
  const el = $('pe-title-error');
  el.textContent = message || '';
  el.hidden = !message;
  $('pe-title').classList.toggle('is-invalid', Boolean(message));
}

// ----- Поля форми -----
export const getCardsText = () => $('pe-cards').value;

// Кнопка копіювання промпту активна лише при ввімкненому режимі LLM.
export function setLlmCopyVisible(on) {
  $('pe-llm-slot')?.classList.toggle('is-active', Boolean(on));
}

// Показує категорію: перемикає textarea / списки / форми залежно від наявності схеми та режиму
export function showCategory({ category, text, viewMode = "visual" }) {
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
  
  const listWrap = $('pe-cata-list-wrap');
  if (isVisual) {
    $('pe-cards').hidden = true;
    if (listWrap) listWrap.hidden = false;
    $('pe-cata-list').hidden = false;
    
    if (isCata) {
      $('pe-cata').hidden = false;
      $('pe-dynamic-form').hidden = true;
    } else {
      $('pe-cata').hidden = true;
      $('pe-dynamic-form').hidden = false;
      updateDynamicNameField(category);
      renderDynamicFormFields(schema);
      if (category === 'gender') {
        const rawText = state.form?.stages?.['age_categories'] || '';
        const lines = parseLines(rawText);
        const entries = lines.map(line => parseStageEntry('age_categories', line));
        renderDynStageList('gender', entries);
      }
    }
  } else {
    $('pe-cards').hidden = false;
    if (listWrap) listWrap.hidden = true;
    $('pe-cata-list').hidden = true;
    $('pe-cata').hidden = true;
    $('pe-dynamic-form').hidden = true;
  }
  
  const formCol = $("pe-cata")?.closest(".pe-char-form-col");
  if (formCol) formCol.hidden = !isVisual;
  
  const bulkBtn = $('pe-bulk-delete-btn');
  if (bulkBtn) bulkBtn.hidden = !isVisual;
  const sortWrap = $('pe-sort-wrap');
  if (sortWrap) sortWrap.hidden = !isVisual;

  $("pe-cards").scrollTop = 0;
}

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
  initStageSortables();
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

// Керування виглядом панелі видалення та блокуванням форми.
// totalCount — скільки рядків зараз видно; allSelected — чи вибрані усі видимі (без нього порівнюємо лічильники).
export function setDeleteModeUi({ isDeleteMode, selectedCount = 0, totalCount = 0, allSelected = null }) {
  const deleteToolbar = $('pe-delete-toolbar');
  const bulkBtn = $('pe-bulk-delete-btn');
  const deleteOverlay = $('pe-delete-overlay');
  const listWrap = $('pe-cata-list-wrap');
  const isCata = state.activeCategory === 'cataclysm';
  const activeForm = isCata ? $('pe-cata') : $('pe-dynamic-form');

  if (listWrap) listWrap.classList.toggle('is-delete-mode', isDeleteMode);
  if (deleteToolbar) deleteToolbar.hidden = !isDeleteMode;
  const charBlock = document.querySelector('.pe-char-block');
  if (charBlock) charBlock.classList.toggle('is-delete-mode', isDeleteMode);
  const fab = $('pe-fab-back');
  if (fab) fab.hidden = isDeleteMode;

  if (bulkBtn) {
    bulkBtn.classList.toggle('is-active', isDeleteMode);
    bulkBtn.title = isDeleteMode ? 'Вийти з режиму вибору (Esc)' : 'Режим вибору карток';
    bulkBtn.setAttribute('aria-pressed', isDeleteMode);
    bulkBtn.setAttribute('aria-label', isDeleteMode ? 'Вийти з режиму вибору (Esc)' : 'Режим вибору карток');
  }

  const sortBtn = $('pe-sort-btn');
  if (sortBtn) sortBtn.disabled = isDeleteMode;
  const sortMenu = $('pe-sort-menu');
  if (isDeleteMode && sortMenu) {
    sortMenu.hidden = true;
    sortBtn?.setAttribute('aria-expanded', 'false');
  }

  // Блокування форми: оверлей-наліпка прикріплюється до активної форми і покриває її повністю
  if (deleteOverlay && activeForm) {
    if (isDeleteMode) {
      if (deleteOverlay.parentElement !== activeForm) {
        activeForm.appendChild(deleteOverlay);
      }
      activeForm.classList.add('is-delete-disabled');
      deleteOverlay.hidden = false;
    } else {
      activeForm.classList.remove('is-delete-disabled');
      deleteOverlay.hidden = true;
    }
  }

  const countEl = $('pe-delete-count');
  if (countEl) countEl.textContent = `Обрано: ${selectedCount}`;

  const submitBtn = $('pe-delete-submit-btn');
  if (submitBtn) {
    const textSpan = submitBtn.querySelector('span');
    if (textSpan) {
      textSpan.textContent = `Видалити (${selectedCount})`;
    } else {
      submitBtn.textContent = `Видалити (${selectedCount})`;
    }
    submitBtn.disabled = selectedCount === 0;
  }

  const selectAllBtn = $('pe-delete-select-all-btn');
  if (selectAllBtn) {
    const everySelected = allSelected ?? (totalCount > 0 && selectedCount === totalCount);
    selectAllBtn.textContent = everySelected ? 'Зняти всі' : 'Вибрати всі';
  }
}

