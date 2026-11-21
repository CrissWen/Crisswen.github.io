import { parseLines } from '../parser.js';
import { parseStageEntry } from '../payload.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/shared.js';
import { state } from '../state.js';
import { handleDynClick, updateDynFormState, updateComboDropdown, submitDyn } from '../controllers/controllers.js';
import { handleStageKeydown } from './shared.js';

// Динамічна форма картки: комбобокси, рядки стадій, клавіші.
export function bindDynamicForm(ctx) {
  const { signal } = ctx;
  const form = $('pe-dynamic-form');

  form.addEventListener('click', e => {
    handleDynClick(e);

    const comboInput = e.target.closest('.pe-combo__input');
    if (comboInput) {
      const list = comboInput.parentElement.querySelector('.pe-combo__dropdown');
      const toggle = comboInput.parentElement.querySelector('.pe-combo__toggle');
      if (list && list.hidden) {
        list.hidden = false;
        if (toggle) toggle.classList.add('is-open');
        updateComboDropdown(comboInput, true);
      }
      return;
    }

    const toggle = e.target.closest('.pe-combo__toggle');
    if (toggle) {
      const input = toggle.parentElement.querySelector('.pe-combo__input');
      const list = toggle.parentElement.querySelector('.pe-combo__dropdown');
      const isOpening = list.hidden;
      list.hidden = !isOpening;
      toggle.classList.toggle('is-open', isOpening);
      if (isOpening) {
        updateComboDropdown(input, true);
        input.focus();
      }
      return;
    }

    const item = e.target.closest('.pe-combo__item');
    if (item) {
      const combo = item.closest('.pe-combo');
      const input = combo.querySelector('.pe-combo__input');
      const toggleBtn = combo.querySelector('.pe-combo__toggle');
      input.value = item.dataset.val;
      item.closest('.pe-combo__dropdown').hidden = true;
      if (toggleBtn) toggleBtn.classList.remove('is-open');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const delBtn = e.target.closest('.pe-stage-del');
    if (delBtn) {
      const row = delBtn.closest('.pe-stage-row');
      const container = row?.closest('[data-dyn-stage-list]');
      if (container && row) {
        const key = container.dataset.dynStageList;
        const rows = [...container.querySelectorAll('.pe-stage-row')];
        const isLastRow = row === rows[rows.length - 1];
        if (isLastRow) {
          const nameInput = row.querySelector('.pe-stage-name');
          if (nameInput) nameInput.value = '';
        } else {
          row.remove();
        }
        ui.updateStageListVisuals(key, container);
      }
    }
  }, { signal });

  form.addEventListener('input', e => {
    // Почали вводити в підсвічене поле — прибираємо червону рамку; коли не лишилося незаповнених — ховаємо помилку.
    if (e.target.classList?.contains('is-invalid') && e.target.value.trim() !== '') {
      e.target.classList.remove('is-invalid');
      if (!$('pe-dynamic-form').querySelector('.is-invalid')) {
        const dynErr = $('pe-dyn-error');
        if (dynErr) dynErr.hidden = true;
      }
    }

    if (e.target.classList.contains('pe-combo__input')) {
      const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
      const toggle = e.target.parentElement.querySelector('.pe-combo__toggle');
      if (list) list.hidden = false;
      if (toggle) toggle.classList.add('is-open');
      updateComboDropdown(e.target);
    }

    const stageContainer = e.target.closest('[data-dyn-stage-list]');
    if (stageContainer) {
      const key = stageContainer.dataset.dynStageList;
      ui.ensureTrailingEmptyStageRow(stageContainer, key);
      ui.updateStageListVisuals(key, stageContainer);
    }
  }, { signal });

  form.addEventListener('change', e => {
    updateDynFormState();

    if (e.target.matches('[data-dyn-custom-stages]')) {
      const isCustom = e.target.checked;
      const wrap = $('pe-dyn-stages-wrap');
      if (wrap) wrap.hidden = !isCustom;
      if (isCustom) {
        const current = ui.gatherDynStageList(state.activeCategory);
        if (!current.length) {
          const rawText = state.form.stages[state.activeCategory] || '';
          const entries = parseLines(rawText).map(line => parseStageEntry(state.activeCategory, line));
          ui.renderDynStageList(state.activeCategory, entries);
        }
        ui.initDynStageSortable(state.activeCategory);
      } else {
        ui.destroyDynStageSortable();
      }
    }
  }, { signal });

  form.addEventListener('keydown', e => {
    if (e.target.closest('[data-dyn-stage-list]')) {
      handleStageKeydown(e);
      return;
    }

    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || (e.target.id === 'pe-dyn-name' && !e.shiftKey))) {
      e.preventDefault();
      submitDyn();
    }
  }, { signal });

  form.addEventListener('focusin', e => {
    ui.handleStageTimeFocusIn(e);
    if (e.target.classList.contains('pe-combo__input')) {
      const list = e.target.parentElement.querySelector('.pe-combo__dropdown');
      const toggle = e.target.parentElement.querySelector('.pe-combo__toggle');
      if (list) list.hidden = false;
      if (toggle) toggle.classList.add('is-open');
      updateComboDropdown(e.target);
    }
  }, { signal });

  form.addEventListener('focusout', e => {
    const stageContainer = e.target.closest('[data-dyn-stage-list]');
    if (ui.normalizeStageRowTimeOnBlur(e, stageContainer)) {
      ui.updateStageListVisuals(stageContainer.dataset.dynStageList, stageContainer);
    }
  }, { signal });
}
