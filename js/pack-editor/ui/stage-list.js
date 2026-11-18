import { OBJECT_STAGE_KEYS, STAGE_KEYS, parseStageEntry } from '../payload.js';
import { parseLines, formatStageEntry } from '../parser.js';
import { stageRowHtml } from './template.js';
import { $ } from './shared.js';

// ===== Список стадій: рендер рядків, збір значень, режим LLM/візуальний =====

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
