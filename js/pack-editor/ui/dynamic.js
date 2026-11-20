import { esc } from '../../utils/common/escape-html.js';
import { initCustomSelects } from '../../ui/custom-select.js';
import { $ } from './shared.js';

// Червона зірочка для обов'язкових полів схеми
const REQ_STAR = `<span class="pe-required" title="Обов'язкове поле">*</span>`;
const reqMark = f => (f.required ? ` ${REQ_STAR}` : '');
const DEFAULT_PRIMARY = { type: 'text', label: 'Назва', placeholder: 'Введіть назву' };

const PRIMARY_FIELD_RENDERERS = {
  text: ({ label, placeholder }) => `
      <label class="pe-label" for="pe-dyn-name">${esc(label)} ${REQ_STAR}</label>
      <input id="pe-dyn-name" class="pe-input" type="text" autocomplete="off" placeholder="${esc(placeholder)}">`,
  textarea: ({ label, placeholder }) => `
      <label class="pe-label" for="pe-dyn-name">${esc(label)} ${REQ_STAR}</label>
      <textarea id="pe-dyn-name" class="pe-input pe-desc pe-input--name" rows="3" placeholder="${esc(placeholder)}"></textarea>`
};

export function renderPrimaryField(primary) {
  const p = primary || DEFAULT_PRIMARY;
  const renderer = PRIMARY_FIELD_RENDERERS[p.type] || PRIMARY_FIELD_RENDERERS.text;
  return renderer(p);
}

const CONDITIONAL_KEYS = new Set(['custom_age', 'age_min', 'age_max', 'height_min', 'height_max', 'exact_height']);
const MULTILINE_TEXT_KEYS = new Set(['explanation', 'ability', 'description']);

const FIELD_RENDERERS = {
  checkbox: (f, hiddenStyle) => `
      <div class="pe-field pe-dyn-field-checkbox"${hiddenStyle}>
        <label class="pe-check" for="pe-dyn-${f.key}">
          <input id="pe-dyn-${f.key}" class="pe-check__input" type="checkbox" data-dyn-key="${f.key}"${f.default ? ' checked' : ''}>
          <span class="pe-check__box" aria-hidden="true"></span>
          <span class="pe-check__text">${esc(f.label)}</span>
        </label>
      </div>`,

  number: (f, hiddenStyle) => `
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
      </div>`,

  list: (f, hiddenStyle) => `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc" rows="3" data-dyn-key="${f.key}" placeholder="По одній стадії на рядок"></textarea>
      </div>`,

  datalist: (f, hiddenStyle) => `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <div class="pe-combo">
          <input id="pe-dyn-${f.key}" class="pe-input pe-combo__input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Виберіть або введіть нове">
          <button type="button" class="pe-combo__toggle" tabindex="-1" aria-label="Відкрити список">
            <svg class="pe-combo__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div id="pe-dyn-${f.key}-list" class="pe-combo__dropdown" hidden></div>
        </div>
      </div>`,

  select: (f, hiddenStyle) => {
    const defaultVal = f.default || '';
    return `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
        <select id="pe-dyn-${f.key}" class="pe-select-custom" data-dyn-key="${f.key}">
          ${f.options.map(opt => `<option value="${esc(opt.value)}"${opt.value === defaultVal ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}
        </select>
      </div>`;
  },

  textarea: (f, hiddenStyle) => `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}${reqMark(f)}</label>
        <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc pe-input--name" rows="2" data-dyn-key="${f.key}" placeholder="Введіть ${esc(f.label).toLowerCase()}"></textarea>
      </div>`,

  text: (f, hiddenStyle) => `
      <div class="pe-field"${hiddenStyle}>
        <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}${reqMark(f)}</label>
        <input id="pe-dyn-${f.key}" class="pe-input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Введіть ${esc(f.label).toLowerCase()}">
      </div>`
};

const renderToggleableStagesBlock = category => `
          <div class="pe-field pe-dyn-field-checkbox">
            <label class="pe-check" for="pe-dyn-custom-stages-toggle">
              <input id="pe-dyn-custom-stages-toggle" class="pe-check__input" type="checkbox" data-dyn-custom-stages>
              <span class="pe-check__box" aria-hidden="true"></span>
              <span class="pe-check__text">Власні стадії для цієї картки</span>
            </label>
          </div>
          <div id="pe-dyn-stages-wrap" class="pe-dyn-stages-wrap" hidden>
            <div class="pe-stage-list pe-stage-list--dyn pe-input" data-dyn-stage-list="${category}"></div>
            <p class="pe-stage-note">Порожній рядок унизу призначений для додавання нового запису</p>
          </div>`;

const STAGE_FIELD_RENDERERS = {
  profession: () => renderToggleableStagesBlock('profession'),
  hobby:      () => renderToggleableStagesBlock('hobby'),
  health:     () => renderToggleableStagesBlock('health'),
  gender:     () => `
          <div id="pe-dyn-gender-stages-wrap" class="pe-dyn-stages-wrap" hidden>
            <label class="pe-label">Власні вікові стадії (категорії)</label>
            <div class="pe-stage-list pe-stage-list--dyn pe-input" data-dyn-stage-list="gender"></div>
            <p class="pe-stage-note">Порожній рядок унизу призначений для додавання нового запису</p>
          </div>`
};

function renderSingleField(f, isInsideRow = false) {
  const isConditional = !isInsideRow && CONDITIONAL_KEYS.has(f.key);
  const hiddenStyle = isConditional ? ' style="display: none;"' : '';
  const typeKey = MULTILINE_TEXT_KEYS.has(f.key) ? 'textarea' : (FIELD_RENDERERS[f.type] ? f.type : 'text');
  return FIELD_RENDERERS[typeKey](f, hiddenStyle);
}

export function renderDynamicFormFields(schema, activeCategory = '') {
  const container = $('pe-dyn-fields');
  if (!schema || !schema.fields) {
    container.innerHTML = '';
    return;
  }

  const renderedRows = new Set();

  container.innerHTML = schema.fields.map(f => {
    if (f.key === 'stages' && STAGE_FIELD_RENDERERS[activeCategory]) {
      return STAGE_FIELD_RENDERERS[activeCategory]();
    }

    if (f.row) {
      if (renderedRows.has(f.row)) return '';
      renderedRows.add(f.row);
      const rowFields = schema.fields.filter(rf => rf.row === f.row);
      const isConditional = rowFields.some(rf => CONDITIONAL_KEYS.has(rf.key));
      const hiddenStyle = isConditional ? ' style="display: none;"' : '';
      return `
        <div class="pe-field-row" id="pe-dyn-${f.row}-row"${hiddenStyle}>
          ${rowFields.map(rf => renderSingleField(rf, true)).join('')}
        </div>`;
    }

    return renderSingleField(f);
  }).join('');

  initCustomSelects(container);
}
