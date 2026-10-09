import { esc } from '../../utils/escape-html.js';
import { $ } from './helpers.js';

export function renderDynamicFormFields(schema) {
  const container = $('pe-dyn-fields');
  if (!schema || !schema.fields) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = schema.fields.map(f => {
    if (f.type === 'checkbox') {
      return `
        <div class="pe-field pe-dyn-field-checkbox">
          <label class="pe-check" for="pe-dyn-${f.key}">
            <input id="pe-dyn-${f.key}" class="pe-check__input" type="checkbox" data-dyn-key="${f.key}">
            <span class="pe-check__box" aria-hidden="true"></span>
            <span class="pe-check__text">${esc(f.label)}</span>
          </label>
        </div>`;
    } else if (f.type === 'list') {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc" rows="3" data-dyn-key="${f.key}" placeholder="По одній стадії на рядок"></textarea>
        </div>`;
    } else if (f.type === 'datalist') {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <div class="pe-combo">
            <input id="pe-dyn-${f.key}" class="pe-input pe-combo__input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Виберіть або введіть нове">
            <button type="button" class="pe-combo__toggle" tabindex="-1" aria-label="Відкрити список">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div id="pe-dyn-${f.key}-list" class="pe-combo__dropdown" hidden></div>
          </div>
        </div>`;
    } else if (f.type === 'select') {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <select id="pe-dyn-${f.key}" class="pe-input" data-dyn-key="${f.key}">
            ${f.options.map(opt => `<option value="${esc(opt.value)}">${esc(opt.label)}</option>`).join('')}
          </select>
        </div>`;
    } else if (f.type === 'textarea' || f.key === 'explanation' || f.key === 'ability' || f.key === 'description') {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <textarea id="pe-dyn-${f.key}" class="pe-input pe-desc pe-input--name" rows="2" data-dyn-key="${f.key}" placeholder="Введіть ${esc(f.label).toLowerCase()}"></textarea>
        </div>`;
    } else {
      return `
        <div class="pe-field">
          <label class="pe-label" for="pe-dyn-${f.key}">${esc(f.label)}</label>
          <input id="pe-dyn-${f.key}" class="pe-input" type="text" data-dyn-key="${f.key}" autocomplete="off" placeholder="Введіть ${esc(f.label).toLowerCase()}">
        </div>`;
    }
  }).join('');
}

