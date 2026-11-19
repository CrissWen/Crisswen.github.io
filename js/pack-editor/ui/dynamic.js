import { esc } from '../../utils/common/escape-html.js';
import { initCustomSelects } from '../../ui/custom-select.js';
import { $ } from './shared.js';

// Червона зірочка для обов'язкових полів схеми (той самий вигляд, що й біля "Назва")
const reqMark = f => (f.required ? ` <span class="pe-required" title="Обов'язкове поле">*</span>` : '');

function renderSingleField(f, schema, isInsideRow = false) {
  const isConditional = !isInsideRow && ['custom_age', 'age_min', 'age_max', 'height_min', 'height_max', 'exact_height'].includes(f.key);
  const hiddenStyle = isConditional ? ' style="display: none;"' : '';

  if (f.type === 'checkbox') {
    const isChecked = f.default ? ' checked' : '';
    return `
      <div class="pe-field pe-dyn-field-checkbox"${hiddenStyle}>
        <label class="pe-check" for="pe-dyn-${f.key}">
          <input id="pe-dyn-${f.key}" class="pe-check__input" type="checkbox" data-dyn-key="${f.key}"${isChecked}>
          <span class="pe-check__box" aria-hidden="true"></span>
          <span class="pe-check__text">${esc(f.label)}</span>
        </label>
      </div>`;
  } else if (f.type === 'number') {
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}${reqMark(f)}</label>
        <div class="pe-stepper">
          <button type="button" class="pe-stepper__btn pe-stepper__btn--minus" data-step="down" tabindex="-1" aria-label="Зменшити">−</button>
          <input id="pe-dyn-${f.key}" class="pe-input pe-stepper__input" type="number" min="${f.min ?? 1}" max="${f.max ?? 120}" step="${f.step ?? 1}" data-dyn-key="${f.key}" autocomplete="off" placeholder="${esc(f.placeholder || '')}">
          <div class="pe-stepper__controls">
            <button type="button" class="pe-stepper__btn pe-stepper__btn--up" data-step="up" tabindex="-1" aria-label="Збільшити">
              <svg class="pe-stepper__chevron" viewBox="0 0 12 8" aria-hidden="true"><polyline points="2 6 6 2 10 6"></polyline></svg>
            </button>
            <button type="button" class="pe-stepper__btn pe-stepper__btn--down" data-step="down" tabindex="-1" aria-label="Зменшити">
              <svg class="pe-stepper__chevron" viewBox="0 0 12 8" aria-hidden="true"><polyline points="2 2 6 6 10 2"></polyline></svg>
            </button>
          </div>
          <button type="button" class="pe-stepper__btn pe-stepper__btn--plus" data-step="up" tabindex="-1" aria-label="Збільшити">+</button>
        </div>
      </div>`;
  } else if (f.type === 'list') {
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc" rows="3" data-dyn-key="${f.key}" placeholder="По одній стадії на рядок"></textarea>
      </div>`;
  } else if (f.type === 'datalist') {
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <div class="pe-combo">
          <input id="pe-dyn-${f.key}" class="pe-input pe-combo__input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Виберіть або введіть нове">
          <button type="button" class="pe-combo__toggle" tabindex="-1" aria-label="Відкрити список">
            <svg class="pe-combo__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div id="pe-dyn-${f.key}-list" class="pe-combo__dropdown" hidden></div>
        </div>
      </div>`;
  } else if (f.type === 'select') {
    const defaultVal = f.default || '';
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <select id="pe-dyn-${f.key}" class="pe-select-custom" data-dyn-key="${f.key}">
          ${f.options.map(opt => `<option value="${esc(opt.value)}"${opt.value === defaultVal ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
        </select>
      </div>`;
  } else if (f.type === 'textarea' || f.key === 'explanation' || f.key === 'ability' || f.key === 'description') {
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}${reqMark(f)}</label>
        <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc pe-input--name" rows="2" data-dyn-key="${f.key}" placeholder="Введіть ${esc(f.label).toLowerCase()}"></textarea>
      </div>`;
  } else {
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}${reqMark(f)}</label>
        <input id="pe-dyn-${f.key}" class="pe-input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Введіть ${esc(f.label).toLowerCase()}">
      </div>`;
  }
}

export function renderDynamicFormFields(schema, activeCategory = '') {
  const container = $('pe-dyn-fields');
  if (!schema || !schema.fields) {
    container.innerHTML = '';
    return;
  }
  
  const renderedRows = new Set();

  container.innerHTML = schema.fields.map(f => {
    if (f.key === 'stages') {
      if (['profession', 'hobby', 'health'].includes(activeCategory)) {
        return `
          <div class="pe-field pe-dyn-field-checkbox">
            <label class="pe-check" for="pe-dyn-custom-stages-toggle">
              <input id="pe-dyn-custom-stages-toggle" class="pe-check__input" type="checkbox" data-dyn-custom-stages>
              <span class="pe-check__box" aria-hidden="true"></span>
              <span class="pe-check__text">Власні стадії для цієї картки</span>
            </label>
          </div>
          <div id="pe-dyn-stages-wrap" class="pe-dyn-stages-wrap" hidden>
            <div class="pe-stage-list pe-stage-list--dyn pe-input" data-dyn-stage-list="${activeCategory}"></div>
            <p class="pe-stage-note">Порожній рядок унизу призначений для додавання нового запису</p>
          </div>`;
      } else if (activeCategory === 'gender') {
        return `
          <div id="pe-dyn-gender-stages-wrap" class="pe-dyn-stages-wrap" hidden>
            <label class="pe-label">Власні вікові стадії (категорії)</label>
            <div class="pe-stage-list pe-stage-list--dyn pe-input" data-dyn-stage-list="gender"></div>
            <p class="pe-stage-note">Порожній рядок унизу призначений для додавання нового запису</p>
          </div>`;
      }
    }

    if (f.row) {
      if (renderedRows.has(f.row)) return '';
      renderedRows.add(f.row);
      const rowFields = schema.fields.filter(rf => rf.row === f.row);
      const isConditional = rowFields.some(rf => ['custom_age', 'age_min', 'age_max', 'height_min', 'height_max', 'exact_height'].includes(rf.key));
      const hiddenStyle = isConditional ? ' style="display: none;"' : '';
      return `
        <div class="pe-field-row" id="pe-dyn-${f.row}-row"${hiddenStyle}>
          ${rowFields.map(rf => renderSingleField(rf, schema, true)).join('')}
        </div>`;
    }

    return renderSingleField(f, schema);
  }).join('');

  initCustomSelects(container);
}
