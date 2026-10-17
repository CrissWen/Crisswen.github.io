import { esc } from '../../utils/escape-html.js';
import { ALL_PACK_CATEGORIES, CATEGORY_SCHEMAS, POOL_TYPE_BY_CATEGORY } from '../categories.js';
import { CATACLYSM_LIMITS, STAGE_KEYS, OBJECT_STAGE_KEYS, parseStageEntry } from '../payload.js';
import { parseLines, formatStageEntry } from '../parser.js';
import { renderDynamicFormFields } from './dynamic.js';
import { stageRowHtml } from './template.js';
import { state } from '../state.js';
import Sortable from '../../vendor/sortable.esm.js';

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

const STAGE_LABELS = { age_categories: 'Вікові категорії', profession: 'Стаж професії', hobby: 'Рівень хобі', health: 'Ступінь хвороби', body_type: 'Типи статури' };
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
// Текст підказки для жовтого кружечка «мало карток». info = { have, need } з findShortByCounts
export function shortageTip({ have, need }) {
  return `Карток: ${have} з рекомендованих ${need}. Краще додати ще ${need - have} — інакше бракуючі картки гра буде брати з базового пака.`;
}

// shortage — { [category]: { have, need } } для категорій, де треба показати жовтий кружечок «i» (порожній об’єкт — іконок немає).
// Хто і коли їх ввімкне — рішає контролер (editor.js); тут лише малюємо.
export function renderSummary(counts, activeCategory, shortage = {}) {
  const categories = ALL_PACK_CATEGORIES.map(c => ({ ...c, count: counts[c.category] || 0 }));
  const charTotal = categories.filter(c => c.poolType === "character").reduce((sum, c) => sum + c.count, 0);
  const bunkerTotal = categories.filter(c => c.poolType === "bunker").reduce((sum, c) => sum + c.count, 0);
  const total = charTotal + bunkerTotal;

  const totalEl = $("pe-summary-total");
  if (totalEl) totalEl.textContent = `Усього: ${total} (П: ${charTotal}, Б: ${bunkerTotal})`;

  const chipsEl = $("pe-chips");
  if (chipsEl) {
    const warnIcon = c => {
      const info = shortage[c.category];
      if (!info) return "";
      const tip = esc(shortageTip(info));
      return `<i class="pe-warn" role="img" data-tip="${tip}" aria-label="${tip}"></i>`;
    };
    const renderItem = c => `<button type="button" class="pe-char-menu-item${c.category === activeCategory ? " is-active" : ""}" data-chip="${esc(c.category)}">${esc(c.label)} <span class="pe-char-menu-item__meta">${c.count > 0 ? `(${c.count})` : ""}${warnIcon(c)}</span></button>`;
      
    const chars = categories.filter(c => c.poolType === "character").map(renderItem).join("");
    const bunkers = categories.filter(c => c.poolType === "bunker").map(renderItem).join("");

    chipsEl.innerHTML = `
      <div class="pe-char-menu-heading">Персонаж</div>
      ${chars}
      <div class="pe-char-menu-heading">Бункер</div>
      ${bunkers}
    `;
  }

  // Такий же кружечок поряд із заголовком відкритої категорії — тут користувач додає картки і бачить стан наживо
  const headWarn = $("pe-cat-warn");
  if (headWarn) {
    const info = shortage[activeCategory];
    headWarn.hidden = !info;
    if (info) {
      const tip = shortageTip(info);
      headWarn.dataset.tip = tip;
      headWarn.setAttribute("aria-label", tip);
    } else {
      delete headWarn.dataset.tip;
      headWarn.removeAttribute("aria-label");
    }
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
      if (category === 'health') {
        renderDynStageList('health', []);
        initDynStageSortable('health');
      } else if (category === 'gender') {
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

export function updateStageListVisuals(key, container = null) {
  if (!container) {
    container = document.querySelector(`[data-stage-list="${key}"]`) ||
                document.querySelector(`[data-dyn-stage-list="${key}"]`);
  }
  if (!container) return;

  const isTime = ['profession', 'hobby'].includes(key);
  const isAge = ['age_categories', 'gender'].includes(key);
  if (!isTime && !isAge) return;

  // Always guarantee at least one empty row at the bottom for adding new entries
  let rows = [...container.querySelectorAll('.pe-stage-row')];
  const lastRow = rows[rows.length - 1];
  if (!lastRow || lastRow.querySelector('.pe-stage-name')?.value?.trim()) {
    container.insertAdjacentHTML('beforeend', stageRowHtml(key, { name: '' }));
    rows = [...container.querySelectorAll('.pe-stage-row')];
  }

  // Remove duplicate trailing empty rows if more than one exists
  const emptyRows = rows.filter(row => !row.querySelector('.pe-stage-name')?.value?.trim());
  while (emptyRows.length > 1) {
    const extra = emptyRows.pop();
    extra.remove();
    rows = [...container.querySelectorAll('.pe-stage-row')];
  }

  const validRows = rows.filter(row => row.querySelector('.pe-stage-name')?.value?.trim());

  let prevMax = 0;

  validRows.forEach((row, index) => {
    const isFirst = index === 0;
    const isLast = index === validRows.length - 1;

    const fromWrap = row.querySelector('.pe-stage-from-wrap');
    const toWrap = row.querySelector('.pe-stage-to-wrap');
    const toText = row.querySelector('.pe-stage-to-text');
    const moreText = row.querySelector('.pe-stage-more-text');
    const timeField = toWrap?.querySelector('.pe-time-field');

    if (fromWrap) {
      if (isFirst) {
        fromWrap.style.display = 'none';
      } else {
        fromWrap.style.display = 'flex';
        const minYEl = row.querySelector('[data-type="min-y"]');
        const minMEl = row.querySelector('[data-type="min-m"]');
        if (isTime) {
          const minY = Math.floor(prevMax / 12);
          const minM = prevMax % 12;
          if (minYEl) minYEl.value = minY;
          if (minMEl) minMEl.value = minM;
        } else if (isAge) {
          if (minYEl) minYEl.value = prevMax;
        }
      }
    }

    if (toWrap) {
      if (isLast) {
        if (timeField) {
          timeField.style.display = 'none';
          timeField.classList.remove('is-warning');
          timeField.removeAttribute('title');
        }
        if (toText) toText.style.display = 'none';
        if (moreText) moreText.style.display = isFirst ? 'none' : 'inline';
        toWrap.style.display = isFirst ? 'none' : 'flex';
        row.classList.remove('is-warning');
      } else {
        if (timeField) timeField.style.display = 'inline-flex';
        if (toText) toText.style.display = 'inline';
        if (moreText) moreText.style.display = 'none';
        toWrap.style.display = 'flex';

        let endLimit = 0;
        if (isTime) {
          const y = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
          const m = parseInt(row.querySelector('[data-type="m"]')?.value, 10) || 0;
          endLimit = y * 12 + m;
        } else if (isAge) {
          endLimit = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
        }

        const isInvalid = endLimit <= prevMax;
        if (isInvalid) {
          row.classList.add('is-warning');
          if (timeField) {
            timeField.classList.add('is-warning');
            timeField.title = 'Вкажіть кінцевий період (має бути більшим за початковий)';
          }
        } else {
          row.classList.remove('is-warning');
          if (timeField) {
            timeField.classList.remove('is-warning');
            timeField.removeAttribute('title');
          }
        }

        prevMax = endLimit > prevMax ? endLimit : prevMax;
      }
    }
  });

  const trailingEmptyRows = rows.filter(row => !row.querySelector('.pe-stage-name')?.value?.trim());
  trailingEmptyRows.forEach(row => {
    row.classList.remove('is-warning');
    const timeField = row.querySelector('.pe-time-field');
    if (timeField) {
      timeField.classList.remove('is-warning');
      timeField.removeAttribute('title');
    }
    const fromWrap = row.querySelector('.pe-stage-from-wrap');
    const toWrap = row.querySelector('.pe-stage-to-wrap');
    if (fromWrap) {
      fromWrap.style.display = 'none';
    }
    if (toWrap) {
      toWrap.style.display = 'none';
    }
  });
}

export function renderStageList(key, textValue) {
  const container = document.querySelector(`[data-stage-list="${key}"]`);
  if (!container) return;
  const entries = parseLines(textValue).map(line => parseStageEntry(key, line));
  renderStageRowsInto(container, key, entries);
}

export function renderDynStageList(key, entries = []) {
  const container = document.querySelector(`[data-dyn-stage-list="${key}"]`);
  if (!container) return;
  renderStageRowsInto(container, key, entries);
}

function renderStageRowsInto(container, key, entries = []) {
  let html = (entries || []).map(entry => stageRowHtml(key, entry)).join('');
  html += stageRowHtml(key, { name: '' });
  container.innerHTML = html;
  updateStageListVisuals(key, container);
}

function gatherStageEntries(container, key) {
  if (!container) return [];
  updateStageListVisuals(key, container);
  const validRows = [...container.querySelectorAll('.pe-stage-row')]
    .filter(row => row.querySelector('.pe-stage-name')?.value?.trim());

  if (!OBJECT_STAGE_KEYS.includes(key)) {
    return validRows.map(row => row.querySelector('.pe-stage-name').value.trim());
  }

  const isAge = ['age_categories', 'gender'].includes(key);
  return validRows.map((row, index) => {
    const isLast = index === validRows.length - 1;
    const name = row.querySelector('.pe-stage-name').value.trim();
    if (isAge) {
      const y = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
      return { name, up_to_age: isLast ? null : y };
    }
    if (!isLast) {
      const y = parseInt(row.querySelector('[data-type="y"]')?.value, 10) || 0;
      const m = parseInt(row.querySelector('[data-type="m"]')?.value, 10) || 0;
      return { name, up_to_months: y * 12 + m };
    }
    return { name };
  });
}

export function gatherDynStageList(key) {
  return gatherStageEntries(document.querySelector(`[data-dyn-stage-list="${key}"]`), key);
}

export function gatherStageText(key) {
  const container = document.querySelector(`[data-stage-list="${key}"]`);
  return gatherStageEntries(container, key).map(formatStageEntry).filter(Boolean).join('\n');
}

export function ensureTrailingEmptyStageRow(container, key) {
  const rows = [...container.querySelectorAll('.pe-stage-row')];
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return;
  const lastName = lastRow.querySelector('.pe-stage-name')?.value?.trim();
  if (lastName) {
    lastRow.classList.remove('pe-stage-row--new');
    const nameInput = lastRow.querySelector('.pe-stage-name');
    if (nameInput) nameInput.placeholder = 'Назва';
    container.insertAdjacentHTML('beforeend', stageRowHtml(key, { name: '' }));
  }
}

export function handleStageTimeFocusIn(e) {
  if (!e.target.classList.contains('pe-time-val')) return;
  if (e.target.value === '0') e.target.value = '';
  else e.target.select();
}

export function normalizeStageRowTimeOnBlur(e, container) {
  if (!e.target.classList.contains('pe-time-val')) return false;
  if (e.target.value.trim() === '') e.target.value = '0';

  const row = e.target.closest('.pe-stage-row');
  if (!container || !row) return false;

  // Якщо фокус перейшов на інше поле часу в межах того ж рядка — не нормалізуємо до повного виходу з рядка
  if (e.relatedTarget && e.relatedTarget.closest('.pe-stage-row') === row && e.relatedTarget.classList.contains('pe-time-val')) {
    return false;
  }

  const yInput = row.querySelector('[data-type="y"]');
  const mInput = row.querySelector('[data-type="m"]');
  const minYInput = row.querySelector('[data-type="min-y"]');
  const minMInput = row.querySelector('[data-type="min-m"]');
  const fromWrap = row.querySelector('.pe-stage-from-wrap');
  const hasMin = Boolean(fromWrap && fromWrap.style.display !== 'none');

  if (yInput && mInput && minYInput && minMInput) {
    const y = parseInt(yInput.value, 10) || 0;
    const m = parseInt(mInput.value, 10) || 0;
    const enteredMonths = y * 12 + m;
    const minMonths = hasMin
      ? ((parseInt(minYInput.value, 10) || 0) * 12 + (parseInt(minMInput.value, 10) || 0))
      : 0;

    const finalMonths = (hasMin && enteredMonths > 0 && enteredMonths <= minMonths)
      ? minMonths + enteredMonths
      : enteredMonths;

    if (finalMonths !== enteredMonths || m >= 12) {
      yInput.value = Math.floor(finalMonths / 12);
      mInput.value = finalMonths % 12;
    }
  } else if (yInput && minYInput && hasMin) {
    const y = parseInt(yInput.value, 10) || 0;
    const minY = parseInt(minYInput.value, 10) || 0;
    if (y > 0 && y <= minY) {
      yInput.value = minY + y;
    }
  }

  return true;
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
    if (list && ta) {
      if (isLlm && list.style.height) {
        ta.style.height = list.style.height;
      } else if (!isLlm && ta.style.height) {
        list.style.height = ta.style.height;
      }
    }
    if (list) list.hidden = isLlm;
    if (ta) ta.hidden = !isLlm;
    if (note) note.hidden = isLlm;
  });
}

let sortableInstances = {};
let stageReorderCallback = null;
let activeDragContainer = null;
let activeDragSens = 140;
let lastPointerEvent = null;
let autoScrollRafId = null;
let lastScrollTimestamp = 0;

function startAutoScroll() {
  if (autoScrollRafId) return;
  lastScrollTimestamp = performance.now();

  const step = (now) => {
    if (!activeDragContainer) {
      autoScrollRafId = null;
      return;
    }

    const dt = Math.min((now - lastScrollTimestamp) / 1000, 0.05);
    lastScrollTimestamp = now;

    if (lastPointerEvent && dt > 0) {
      const rect = activeDragContainer.getBoundingClientRect();
      const clientY = lastPointerEvent.clientY;
      const clientX = lastPointerEvent.clientX;

      if (clientX >= rect.left - 50 && clientX <= rect.right + 50 &&
          clientY >= rect.top - 70 && clientY <= rect.bottom + 70) {
        let dir = 0;
        let ratio = 0;

        if (clientY < rect.top + activeDragSens) {
          const dist = Math.max(0, clientY - rect.top);
          ratio = Math.max(0, Math.min(1, 1 - dist / activeDragSens));
          dir = -1;
        } else if (clientY > rect.bottom - activeDragSens) {
          const dist = Math.max(0, rect.bottom - clientY);
          ratio = Math.max(0, Math.min(1, 1 - dist / activeDragSens));
          dir = 1;
        }

        if (dir !== 0 && ratio > 0) {
          // Плавне наростання: від 100px/с до 550px/с біля самого краю
          const speed = 100 + Math.pow(ratio, 2) * 450;
          activeDragContainer.scrollTop += dir * speed * dt;

          if (Sortable.active && typeof Sortable.active._onTouchMove === 'function') {
            try {
              Sortable.active._onTouchMove(lastPointerEvent);
            } catch (_) {}
          }
        }
      }
    }

    autoScrollRafId = requestAnimationFrame(step);
  };

  autoScrollRafId = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRafId) {
    cancelAnimationFrame(autoScrollRafId);
    autoScrollRafId = null;
  }
}

function onDragPointerMove(e) {
  lastPointerEvent = e;
}

function handleWheelDuringDrag(e) {
  if (!activeDragContainer) return;
  const rect = activeDragContainer.getBoundingClientRect();
  if (e.clientX >= rect.left - 50 && e.clientX <= rect.right + 50 &&
      e.clientY >= rect.top - 50 && e.clientY <= rect.bottom + 50) {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY;
    activeDragContainer.scrollTop += dy;

    const moveEvt = lastPointerEvent || e;
    if (Sortable.active && typeof Sortable.active._onTouchMove === 'function') {
      try {
        Sortable.active._onTouchMove(moveEvt);
      } catch (_) {}
    }
  }
}

function cleanupDragListeners() {
  document.body.classList.remove('is-stage-dragging');
  stopAutoScroll();
  window.removeEventListener('pointermove', onDragPointerMove, { capture: true });
  window.removeEventListener('mousemove', onDragPointerMove, { capture: true });
  window.removeEventListener('wheel', handleWheelDuringDrag, { capture: true });
  activeDragContainer = null;
  lastPointerEvent = null;
}

function createStageSortable(container, key, { dragSens, onReorder }) {
  const isObjectStage = OBJECT_STAGE_KEYS.includes(key);
  let savedSlotTimes = [];

  return new Sortable(container, {
    animation: 150,
    handle: '.pe-stage-handle',
    filter: '.pe-stage-row--new',
    preventOnFilter: false,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackClass: 'sortable-fallback',
    fallbackTolerance: 2,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    scroll: false,
    swapThreshold: isObjectStage ? 0.55 : 0.7,
    invertSwap: isObjectStage,
    direction: 'vertical',
    onMove(evt) {
      if (evt.related && evt.related.classList.contains('pe-stage-row--new')) {
        return -1;
      }
      return true;
    },
    onStart() {
      document.body.classList.add('is-stage-dragging');
      activeDragContainer = container;
      activeDragSens = dragSens;
      lastPointerEvent = null;
      window.addEventListener('pointermove', onDragPointerMove, { capture: true, passive: true });
      window.addEventListener('mousemove', onDragPointerMove, { capture: true, passive: true });
      window.addEventListener('wheel', handleWheelDuringDrag, { passive: false, capture: true });
      startAutoScroll();

      if (isObjectStage) {
        const validRows = [...container.querySelectorAll('.pe-stage-row:not(.pe-stage-row--new)')];
        savedSlotTimes = validRows.map(row => ({
          y: row.querySelector('[data-type="y"]')?.value ?? '0',
          m: row.querySelector('[data-type="m"]')?.value ?? '0'
        }));
      }
    },
    onEnd() {
      cleanupDragListeners();

      const newRow = container.querySelector('.pe-stage-row--new');
      if (newRow && container.lastElementChild !== newRow) {
        container.appendChild(newRow);
      }

      if (isObjectStage && savedSlotTimes.length) {
        const validRows = [...container.querySelectorAll('.pe-stage-row:not(.pe-stage-row--new)')];
        validRows.forEach((row, idx) => {
          if (savedSlotTimes[idx]) {
            const yInput = row.querySelector('[data-type="y"]');
            const mInput = row.querySelector('[data-type="m"]');
            if (yInput) yInput.value = savedSlotTimes[idx].y;
            if (mInput) mInput.value = savedSlotTimes[idx].m;
          }
        });
      }

      updateStageListVisuals(key, container);
      if (typeof onReorder === 'function') {
        onReorder(key);
      }
    }
  });
}

export function setStageReorderCallback(cb) {
  stageReorderCallback = cb;
}

export function destroyStageSortables() {
  cleanupDragListeners();
  Object.values(sortableInstances).forEach(s => {
    try { s.destroy(); } catch (_) {}
  });
  sortableInstances = {};
  destroyDynStageSortable();
}

export function initStageSortables(onStageReordered) {
  if (typeof onStageReordered === 'function') {
    stageReorderCallback = onStageReordered;
  }

  STAGE_KEYS.forEach(key => {
    const container = document.querySelector(`[data-stage-list="${key}"]`);
    if (!container) return;

    if (sortableInstances[key]) {
      try { sortableInstances[key].destroy(); } catch (_) {}
      delete sortableInstances[key];
    }

    const isObjectStage = OBJECT_STAGE_KEYS.includes(key);
    sortableInstances[key] = createStageSortable(container, key, {
      dragSens: isObjectStage ? 220 : 140,
      onReorder: k => stageReorderCallback?.(k)
    });
  });
}

let dynSortableInstance = null;

export function destroyDynStageSortable() {
  if (dynSortableInstance) {
    try { dynSortableInstance.destroy(); } catch (_) {}
    dynSortableInstance = null;
  }
}

export function initDynStageSortable(key, onReordered = null) {
  const container = document.querySelector(`[data-dyn-stage-list="${key}"]`);
  if (!container) return;

  destroyDynStageSortable();
  dynSortableInstance = createStageSortable(container, key, {
    dragSens: 140,
    onReorder: onReordered
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

  if (bulkBtn) {
    bulkBtn.classList.toggle('is-active', isDeleteMode);
    bulkBtn.title = isDeleteMode ? 'Вийти з режиму вибору (Esc)' : 'Режим вибору карток';
    bulkBtn.setAttribute('aria-pressed', isDeleteMode);
    const span = bulkBtn.querySelector('span');
    if (span) span.textContent = 'Вибір';
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

