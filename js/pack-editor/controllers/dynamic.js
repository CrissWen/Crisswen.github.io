import { state } from '../state.js';
import { setMobileCardView } from './mobile-nav.js';
import { CATEGORY_SCHEMAS } from '../categories.js';
import { esc } from '../../utils/escape-html.js';
import {
  parseLines, oneLine, parseCards, cardToLine,
  hasExplanationField, joinNameExplanation, splitNameExplanation
} from '../parser.js';
import { OBJECT_STAGE_KEYS, validateStageEntries, parseStageEntry } from '../payload.js';
import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import {
  $, renderDynStageList, gatherDynStageList, initDynStageSortable, destroyDynStageSortable,
  updateStageListVisuals
} from '../ui/helpers.js';

let onDynamicChange = null;

export function setDynamicOrchestrator(fn) {
  onDynamicChange = fn;
}

export function getDynamicCards() {
  if (state.activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[state.activeCategory]) return [];
  if (!state.cardData[state.activeCategory]) {
    state.cardData[state.activeCategory] = parseCards(state.form.texts[state.activeCategory] || '', state.activeCategory, state.extraMeta).map(c => ({
      id: c.id || crypto.randomUUID(),
      value: c.value,
      meta: c.meta || {}
    }));
  }
  return state.cardData[state.activeCategory];
}

export function syncCustomSelect(selectEl) {
  if (!selectEl) return;
  const wrap = selectEl.closest('.pe-select-custom');
  if (!wrap) return;
  const val = selectEl.value;
  const selectedOption = selectEl.querySelector(`option[value="${val}"]`) || selectEl.options[0];
  const label = wrap.querySelector('.pe-select-custom__label');
  if (label && selectedOption) {
    label.textContent = selectedOption.textContent;
  }
  wrap.querySelectorAll('.pe-select-custom__item').forEach(it => {
    const isSel = it.dataset.value === val;
    it.classList.toggle('is-selected', isSel);
    it.setAttribute('aria-selected', String(isSel));
    const check = it.querySelector('.pe-select-custom__check');
    if (check) check.textContent = isSel ? '✓' : '';
  });
}

// ===== Кодеки полів за типом (читання / запис / скидання / порівняння) =====
const FIELD_CODECS = {
  checkbox: {
    read: el => el.checked,
    write: (el, val) => { el.checked = Boolean(val); },
    reset: (el, f) => { el.checked = Boolean(f.default); },
    equals: (a, b) => Boolean(a) === Boolean(b)
  },
  list: {
    read: el => parseLines(el.value),
    write: (el, val) => { el.value = Array.isArray(val) ? val.join('\n') : ''; },
    reset: el => { el.value = ''; },
    equals: (a, b) => (a || []).join('\n') === (b || []).join('\n')
  },
  number: {
    read: el => el.value.trim(),
    write: (el, val) => { el.value = (val !== undefined && val !== null) ? val : ''; },
    reset: (el, f) => { el.value = (f?.default !== undefined && f?.default !== null) ? f.default : ''; },
    equals: (a, b) => String(a ?? '').trim() === String(b ?? '').trim()
  },
  select: {
    read: el => el.value,
    write: (el, val) => {
      el.value = (val !== undefined && val !== null) ? val : '';
      syncCustomSelect(el);
    },
    reset: (el, f) => {
      el.value = f?.default || '';
      syncCustomSelect(el);
    },
    equals: (a, b) => String(a ?? '') === String(b ?? '')
  },
  default: {
    read: el => oneLine(el.value),
    write: (el, val) => { el.value = val || ''; },
    reset: el => { el.value = ''; },
    equals: (a, b) => (a || '') === (b || '')
  }
};

const getFieldCodec = type => FIELD_CODECS[type] || FIELD_CODECS.default;

// ===== Допоміжні функції форми =====
function showFormError(message, focusEl = null) {
  const err = $('pe-dyn-error');
  if (err) {
    err.textContent = message;
    err.hidden = false;
  }
  focusEl?.focus();
}

function clearFormErrors() {
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  document.querySelectorAll('#pe-dynamic-form .is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

function toggleField(key, enabled) {
  const el = $(`pe-dyn-${key}`);
  if (!el) return;
  el.disabled = !enabled;
  el.closest('.pe-field').style.display = enabled ? '' : 'none';
  if (!enabled) {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = '';
  }
}

function applyFieldVisibility(visibilityMap) {
  for (const [key, enabled] of Object.entries(visibilityMap)) {
    toggleField(key, Boolean(enabled));
  }
  const ageRow = $('pe-dyn-age-row');
  if (ageRow) {
    const isAgeVisible = Boolean(visibilityMap.age_min || visibilityMap.age_max);
    ageRow.style.display = isAgeVisible ? '' : 'none';
  }
  const heightRow = $('pe-dyn-height-row');
  if (heightRow) {
    const isHeightVisible = Boolean(visibilityMap.height_min || visibilityMap.height_max);
    heightRow.style.display = isHeightVisible ? '' : 'none';
  }
}

function validatePositiveRange(minRaw, maxRaw, { minKey, maxKey, emptyMsg, orderMsg }) {
  const minNum = parseInt(minRaw, 10);
  const maxNum = parseInt(maxRaw, 10);
  if (!minRaw || !maxRaw || isNaN(minNum) || isNaN(maxNum) || minNum <= 0 || maxNum <= 0) {
    const badMin = !minRaw || isNaN(minNum) || minNum <= 0;
    return { error: emptyMsg, focusEl: $(`pe-dyn-${badMin ? minKey : maxKey}`) };
  }
  if (minNum > maxNum) {
    return { error: orderMsg, focusEl: $(`pe-dyn-${minKey}`) };
  }
  return { range: { min: minNum, max: maxNum } };
}

const getDefaultAgeStages = () =>
  parseLines(state.form.stages['age_categories'] || '').map(line => parseStageEntry('age_categories', line));

// ===== Стратегії списків стадій за категоріями =====
const createToggleableStagesStrategy = category => ({
  read() {
    if (!$('pe-dyn-custom-stages-toggle')?.checked) return undefined;
    const list = gatherDynStageList(category);
    return list.length > 0 ? list : undefined;
  },
  fill(stages) {
    const hasCustom = Array.isArray(stages) && stages.length > 0;
    const toggle = $('pe-dyn-custom-stages-toggle');
    const wrap = $('pe-dyn-stages-wrap');
    if (toggle) toggle.checked = hasCustom;
    if (wrap) wrap.hidden = !hasCustom;
    if (hasCustom) {
      renderDynStageList(category, stages);
      initDynStageSortable(category);
    } else {
      const container = document.querySelector(`[data-dyn-stage-list="${category}"]`);
      if (container) container.innerHTML = '';
      destroyDynStageSortable();
    }
  },
  reset() {
    this.fill([]);
  }
});

const STAGE_STRATEGIES = {
  health: createToggleableStagesStrategy('health'),
  profession: createToggleableStagesStrategy('profession'),
  hobby: createToggleableStagesStrategy('hobby'),
  gender: {
    read() {
      const mode = $('pe-dyn-custom_age_mode')?.value;
      if (mode !== 'range_and_stages') return undefined;
      const list = gatherDynStageList('gender');
      return list.length > 0 ? list : undefined;
    },
    fill(stages) {
      const hasCustom = Array.isArray(stages) && stages.length > 0;
      const wrap = $('pe-dyn-gender-stages-wrap');
      if (wrap) wrap.hidden = !hasCustom;
      renderDynStageList('gender', hasCustom ? stages : getDefaultAgeStages());
      if (hasCustom) initDynStageSortable('gender');
      else destroyDynStageSortable();
    },
    reset() {
      this.fill([]);
    }
  }
};

// ===== Стратегії специфічної поведінки категорій =====
const CATEGORY_STRATEGIES = {
  body_type: {
    metaToForm(meta = {}) {
      const mode = meta.has_no_height ? '' : (meta.range ? 'range' : (meta.exact_height !== undefined ? 'exact' : ''));
      return {
        has_no_height: Boolean(meta.has_no_height),
        custom_height_mode: mode,
        height_min: meta.range?.min !== undefined ? String(meta.range.min) : '',
        height_max: meta.range?.max !== undefined ? String(meta.range.max) : '',
        exact_height: meta.exact_height !== undefined ? String(meta.exact_height) : ''
      };
    },
    syncFormState() {
      const noHeight = $('pe-dyn-has_no_height')?.checked;
      const mode = !noHeight ? $('pe-dyn-custom_height_mode')?.value : '';
      applyFieldVisibility({
        custom_height_mode: !noHeight,
        height_min: mode === 'range',
        height_max: mode === 'range',
        exact_height: mode === 'exact'
      });
    },
    prepareMeta(data, meta) {
      for (const k of ['custom_height_mode', 'height_min', 'height_max', 'exact_height', 'range', 'has_no_height']) {
        delete meta[k];
      }
      if (data.has_no_height) {
        meta.has_no_height = true;
        return null;
      }
      if (data.custom_height_mode === 'range') {
        const res = validatePositiveRange(
          String(data.height_min ?? '').trim(),
          String(data.height_max ?? '').trim(),
          {
            minKey: 'height_min',
            maxKey: 'height_max',
            emptyMsg: 'Вкажіть коректні додатні числа для мінімального та максимального зросту',
            orderMsg: 'Мінімальний зріст не може перевищувати максимальний'
          }
        );
        if (res.error) return res;
        meta.range = res.range;
      } else if (data.custom_height_mode === 'exact') {
        const exactRaw = String(data.exact_height ?? '').trim();
        const exactNum = parseInt(exactRaw, 10);
        if (!exactRaw || isNaN(exactNum) || exactNum <= 0) {
          return { error: 'Вкажіть коректне додатне число для точного зросту', focusEl: $('pe-dyn-exact_height') };
        }
        meta.exact_height = exactNum;
      }
      return null;
    }
  },

  gender: {
    metaToForm(meta = {}) {
      const hasRangeOrStages = Boolean(meta.range || (meta.stages && meta.stages.length > 0));
      const mode = meta.has_no_age ? 'no_age' : (hasRangeOrStages ? 'range_and_stages' : (meta.custom_age ? 'no_age' : ''));
      return {
        custom_age_mode: mode,
        age_min: meta.range?.min !== undefined ? String(meta.range.min) : '',
        age_max: meta.range?.max !== undefined ? String(meta.range.max) : '',
        custom_age: meta.custom_age !== undefined ? String(meta.custom_age) : ''
      };
    },
    syncFormState() {
      const mode = $('pe-dyn-custom_age_mode')?.value || '';
      const isRangeStages = mode === 'range_and_stages';

      applyFieldVisibility({
        custom_age: mode === 'no_age',
        age_min: isRangeStages,
        age_max: isRangeStages
      });

      const stagesWrap = $('pe-dyn-gender-stages-wrap');
      if (stagesWrap) stagesWrap.hidden = !isRangeStages;

      if (isRangeStages) {
        const current = gatherDynStageList('gender');
        if (!current.length) renderDynStageList('gender', getDefaultAgeStages());
        else updateStageListVisuals('gender');
        initDynStageSortable('gender');
      } else {
        destroyDynStageSortable();
      }
    },
    prepareMeta(data, meta, { cards }) {
      for (const k of ['custom_age_mode', 'age_min', 'age_max', 'range', 'has_no_age', 'custom_age']) {
        delete meta[k];
      }
      if (data.custom_age_mode === 'no_age') {
        meta.has_no_age = true;
        meta.custom_age = data.custom_age?.trim() || 'Без віку';
        delete meta.stages;
      } else if (data.custom_age_mode === 'range_and_stages') {
        const minRaw = String(data.age_min ?? '').trim();
        const maxRaw = String(data.age_max ?? '').trim();
        if (minRaw || maxRaw) {
          const res = validatePositiveRange(minRaw, maxRaw, {
            minKey: 'age_min',
            maxKey: 'age_max',
            emptyMsg: 'Вкажіть коректні додатні числа для мінімального та максимального віку',
            orderMsg: 'Мінімальний вік не може перевищувати максимальний'
          });
          if (res.error) return res;
          meta.range = res.range;
        }
      } else {
        delete meta.stages;
      }

      const targetName = meta.opposite;
      const currentName = data.value;
      if (targetName) {
        if (targetName === currentName) {
          return { error: 'Стать не може бути протилежною сама собі.' };
        }
        const targetCard = cards.find(c => c.value === targetName);
        const targetOpposite = targetCard?.meta?.opposite;
        if (targetOpposite && targetOpposite !== currentName) {
          return { error: `Стать "${targetName}" вже має протилежну стать "${targetOpposite}".` };
        }
      }
      return null;
    },
    afterSave({ cards, data, meta, prevCard }) {
      const oldOpposite = prevCard?.meta?.opposite;
      const targetName = meta.opposite;
      const currentName = data.value;

      if (oldOpposite && oldOpposite !== targetName) {
        const oldCard = cards.find(c => c.value === oldOpposite);
        if (oldCard?.meta?.opposite === currentName) {
          delete oldCard.meta.opposite;
        }
      }
      if (targetName) {
        const targetCard = cards.find(c => c.value === targetName);
        if (targetCard) {
          targetCard.meta.opposite = currentName;
        } else {
          cards.push({ value: targetName, meta: { opposite: currentName } });
        }
      }
    }
  },

  special_ability: {
    prepareMeta(data, meta, { prevCard }) {
      // Поле action_type тимчасово приховане з форми (categories.js)
      const prevAction = prevCard?.meta?.action_type;
      if (prevAction !== undefined && prevAction !== null && prevAction !== '') {
        meta.action_type = prevAction;
      }
      return null;
    }
  }
};

// Перетворює збережену картку { value, meta } на плоский об'єкт значень полів форми
function resolveCardFormValues(category, card) {
  const split = hasExplanationField(category) ? splitNameExplanation(card.value) : null;
  const strategy = CATEGORY_STRATEGIES[category];
  const mappedMeta = {
    ...(card.meta || {}),
    ...(strategy?.metaToForm ? strategy.metaToForm(card.meta) : {}),
    ...(split ? { explanation: split.explanation } : {})
  };
  return {
    name: split ? split.name : card.value,
    fields: mappedMeta
  };
}

// ===== Основні контролери динамічної форми =====
export function dynDraftPending() {
  const category = state.activeCategory;
  const schema = CATEGORY_SCHEMAS[category];
  if (category === 'cataclysm' || !schema || state.viewMode !== 'visual') return false;

  const current = readDynRaw();
  if (state.dynEditIndex < 0) {
    return Boolean(current.value && current.value.trim() !== '');
  }

  const item = getDynamicCards()[state.dynEditIndex];
  if (!item) return false;

  const withExplanation = hasExplanationField(category);
  const savedSplit = withExplanation ? splitNameExplanation(item.value) : null;
  const savedValue = withExplanation ? joinNameExplanation(savedSplit.name, savedSplit.explanation) : item.value;
  const currentValue = withExplanation ? joinNameExplanation(current.value, current.explanation) : current.value;
  if (currentValue !== savedValue) return true;

  const { fields: savedFields } = resolveCardFormValues(category, item);

  for (const f of schema.fields) {
    if (withExplanation && f.key === 'explanation') continue;
    const v1 = current[f.key];
    const v2 = savedFields[f.key] !== undefined ? savedFields[f.key] : f.default;

    if (f.key === 'stages') {
      if (JSON.stringify(v1 || null) !== JSON.stringify(v2 || null)) return true;
      continue;
    }
    if (!getFieldCodec(f.type).equals(v1, v2)) return true;
  }
  return false;
}

export function readDynRaw() {
  const category = state.activeCategory;
  const schema = CATEGORY_SCHEMAS[category];
  if (!schema) return {};

  const data = { value: oneLine($('pe-dyn-name').value) };
  for (const f of schema.fields) {
    if (f.key === 'stages') {
      data.stages = STAGE_STRATEGIES[category]?.read();
      continue;
    }
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) data[f.key] = getFieldCodec(f.type).read(el);
  }
  return data;
}

export function fillDynFields(card) {
  const category = state.activeCategory;
  const schema = CATEGORY_SCHEMAS[category];
  if (!schema) return;

  const { name, fields } = resolveCardFormValues(category, card);
  $('pe-dyn-name').value = name;

  for (const f of schema.fields) {
    if (f.key === 'stages') {
      STAGE_STRATEGIES[category]?.fill(card.meta?.stages);
      continue;
    }
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) {
      const val = fields[f.key] !== undefined ? fields[f.key] : f.default;
      getFieldCodec(f.type).write(el, val);
    }
  }
}

export function setDynMode(index) {
  state.dynEditIndex = index;
  const item = index >= 0 ? getDynamicCards()[index] : null;

  const submitBtn = document.querySelector('[data-dyn-action="submit"]');
  if (submitBtn) submitBtn.textContent = item ? 'Зберегти зміни' : 'Додати';

  const cancelBtn = document.querySelector('[data-dyn-action="cancel"]');
  if (cancelBtn) cancelBtn.hidden = !item;

  const deleteBtn = document.querySelector('[data-dyn-action="delete"]');
  if (deleteBtn) deleteBtn.hidden = !item;

  const modeEl = $('pe-dyn-mode');
  if (modeEl) modeEl.textContent = item ? `Редагування: "${oneLine(item.value)}"` : 'Нова картка';

  if (onDynamicChange) onDynamicChange();
}

export function updateDynFormState() {
  CATEGORY_STRATEGIES[state.activeCategory]?.syncFormState?.();
}

export function startDynEdit(index, card) {
  fillDynFields(card);
  clearFormErrors();
  setDynMode(index);
  updateDynFormState();
  $('pe-dynamic-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('pe-dyn-name')?.focus({ preventScroll: true });
}

export function resetDynForm() {
  $('pe-dyn-name').value = '';
  const category = state.activeCategory;
  const schema = CATEGORY_SCHEMAS[category];

  for (const f of schema?.fields || []) {
    if (f.key === 'stages') {
      STAGE_STRATEGIES[category]?.reset();
      continue;
    }
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) getFieldCodec(f.type).reset(el, f);
  }

  clearFormErrors();
  setDynMode(-1);
  updateDynFormState();
}

export function applyDynChange({ scrollToEnd = false } = {}) {
  ui.showCategory({
    category: state.activeCategory,
    text: state.form.texts[state.activeCategory] || '',
    viewMode: state.viewMode
  });
  if (onDynamicChange) onDynamicChange({ scrollToEnd });
}

function validateRequiredFields(category, data) {
  const missing = [];
  if (String(data.value ?? '').trim() === '') {
    missing.push({ el: $('pe-dyn-name'), label: 'Назва' });
  }
  for (const f of CATEGORY_SCHEMAS[category]?.fields || []) {
    if (f.required && String(data[f.key] ?? '').trim() === '') {
      missing.push({ el: document.querySelector(`[data-dyn-key="${f.key}"]`), label: f.label });
    }
  }
  return missing;
}

export function submitDyn() {
  const category = state.activeCategory;
  const data = readDynRaw();
  const isEdit = state.dynEditIndex >= 0;

  clearFormErrors();

  const missing = validateRequiredFields(category, data);
  if (missing.length > 0) {
    missing.forEach(m => m.el?.classList.add('is-invalid'));
    const msg = missing.length === 1
      ? `Поле «${missing[0].label}» обов'язкове`
      : `Заповніть обов'язкові поля: ${missing.map(m => m.label).join(', ')}`;
    showFormError(msg, missing[0].el);
    return;
  }

  if (OBJECT_STAGE_KEYS.includes(category) && data.stages) {
    const stageErr = validateStageEntries(category, data.stages);
    if (stageErr) {
      showFormError(stageErr);
      showGlobalToast(stageErr);
      return;
    }
  }

  const cards = getDynamicCards();
  const prevCard = isEdit ? cards[state.dynEditIndex] : null;
  const meta = { ...data };
  delete meta.value;

  const withExplanation = hasExplanationField(category);
  const storedValue = withExplanation ? joinNameExplanation(data.value, data.explanation) : data.value;
  if (withExplanation) delete meta.explanation;

  const strategy = CATEGORY_STRATEGIES[category];
  if (strategy?.prepareMeta) {
    const errResult = strategy.prepareMeta(data, meta, { cards, prevCard });
    if (errResult?.error) {
      showFormError(errResult.error, errResult.focusEl);
      return;
    }
  }

  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      delete meta[k];
    }
  }

  if (isEdit) {
    const existingId = cards[state.dynEditIndex]?.id || prevCard?.id || crypto.randomUUID();
    cards[state.dynEditIndex] = { id: existingId, value: storedValue, meta };
  } else {
    cards.push({ id: crypto.randomUUID(), value: storedValue, meta });
    state.newDynIndex = cards.length - 1;
  }

  strategy?.afterSave?.({ cards, data, meta, prevCard });

  state.form.texts[category] = cards.map(c => cardToLine(category, c.value, c.meta)).join('\n');

  applyDynChange({ scrollToEnd: state.newDynIndex >= 0 });
  resetDynForm();

  if (state.newDynIndex >= 0) {
    state.newDynIndex = -1;
  }
  showGlobalToast(isEdit ? 'Картку оновлено' : 'Картку додано');
  setMobileCardView('list');
  $('pe-dyn-name')?.focus();
}

export async function deleteDyn(btn) {
  if (state.dynEditIndex < 0 || state.isConfirming) return;
  const cards = getDynamicCards();
  const item = cards[state.dynEditIndex];

  state.isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити картку "${oneLine(item.value)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    state.isConfirming = false;
  }
  if (!confirmed) return;

  if (item?.id) {
    state.markCardDeleted(item.id);
  }
  cards.splice(state.dynEditIndex, 1);
  state.form.texts[state.activeCategory] = cards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');

  applyDynChange();
  resetDynForm();
  showGlobalToast('Картку видалено');
  setMobileCardView('list');
}

const DYN_ACTIONS = {
  submit: () => submitDyn(),
  cancel: () => {
    resetDynForm();
    setMobileCardView('list');
  },
  delete: btn => deleteDyn(btn)
};

export function handleDynClick(e) {
  const btn = e.target.closest('[data-dyn-action]');
  if (!btn || btn.disabled) return;
  DYN_ACTIONS[btn.dataset.dynAction]?.(btn);
}

export function updateComboDropdown(input, forceShowAll = false) {
  const list = input.parentElement.querySelector('.pe-combo__dropdown');
  if (!list) return;
  const currentName = $('pe-dyn-name')?.value || '';
  const filter = forceShowAll ? '' : input.value.toLowerCase();

  const filtered = getDynamicCards()
    .map(c => c.value)
    .filter(o => (!currentName || o !== currentName) && o.toLowerCase().includes(filter));

  const currentVal = (input.value || '').trim();
  list.innerHTML = filtered.length === 0
    ? '<div class="pe-combo__empty">Введіть нове значення</div>'
    : filtered.map(o => {
        const isSel = o === currentVal;
        return `<div class="pe-combo__item${isSel ? ' is-selected' : ''}" data-val="${esc(o)}">
          <span class="pe-combo__check">${isSel ? '✓' : ''}</span>
          <span class="pe-combo__text">${esc(o)}</span>
        </div>`;
      }).join('');
}

