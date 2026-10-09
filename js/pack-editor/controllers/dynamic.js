import { state } from '../state.js';
import { CATEGORY_SCHEMAS } from '../categories.js';
import {
  parseLines, oneLine, parseCards, cardToLine,
  hasExplanationField, joinNameExplanation, splitNameExplanation
} from '../parser.js';
import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/index.js';
import { $ } from '../ui/helpers.js';

let onDynamicChange = null;

export function setDynamicOrchestrator(fn) {
  onDynamicChange = fn;
}

export function getDynamicCards() {
  if (state.activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[state.activeCategory]) return [];
  return parseCards(state.form.texts[state.activeCategory] || '', state.activeCategory, state.extraMeta);
}

export function dynDraftPending() {
  if (state.activeCategory === 'cataclysm' || !CATEGORY_SCHEMAS[state.activeCategory] || state.viewMode !== 'visual') return false;
  const current = readDynRaw();
  if (!current.value && Object.values(current).every(v => !v || (Array.isArray(v) && !v.length))) return false;
  
  if (state.dynEditIndex < 0) return true;
  
  const cards = getDynamicCards();
  const item = cards[state.dynEditIndex];
  if (!item) return false;
  
  // Фобія: порівнюємо зклеєне "Назва - Пояснення" з збереженим value (обидва нормалізуємо), інакше картка завжди виглядала б "зміненою"
  const withExplanation = hasExplanationField(state.activeCategory);
  const savedValue = withExplanation
    ? (s => joinNameExplanation(s.name, s.explanation))(splitNameExplanation(item.value))
    : item.value;
  const currentValue = withExplanation ? joinNameExplanation(current.value, current.explanation) : current.value;
  if (currentValue !== savedValue) return true;
  for (const f of CATEGORY_SCHEMAS[state.activeCategory].fields) {
    if (withExplanation && f.key === 'explanation') continue; // вже враховано в currentValue вище
    const v1 = current[f.key];
    const v2 = item.meta[f.key];
    if (f.type === 'checkbox') {
      if (Boolean(v1) !== Boolean(v2)) return true;
    } else if (f.type === 'list') {
      if ((v1 || []).join('\n') !== (v2 || []).join('\n')) return true;
    } else {
      if ((v1 || '') !== (v2 || '')) return true;
    }
  }
  return false;
}

export function readDynRaw() {
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (!schema) return {};
  const data = {};
  data.value = $('pe-dyn-name').value.trim();
  for (const f of schema.fields) {
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) {
      if (f.type === 'checkbox') data[f.key] = el.checked;
      else if (f.type === 'list') data[f.key] = parseLines(el.value);
      else data[f.key] = el.value.trim();
    }
  }
  return data;
}

export function fillDynFields(card) {
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (!schema) return;
  const split = hasExplanationField(state.activeCategory) ? splitNameExplanation(card.value) : null;
  $('pe-dyn-name').value = split ? split.name : card.value;
  for (const f of schema.fields) {
    const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
    if (el) {
      const val = split && f.key === 'explanation' ? split.explanation : card.meta[f.key];
      if (f.type === 'checkbox') el.checked = Boolean(val);
      else if (f.type === 'list') el.value = Array.isArray(val) ? val.join('\n') : '';
      else el.value = val || '';
    }
  }
}

export function setDynMode(index) {
  state.dynEditIndex = index;
  const cards = getDynamicCards();
  const item = index >= 0 ? cards[index] : null;
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
  if (state.activeCategory !== 'body_type') return;
  const noHeight = $('pe-dyn-has_no_height')?.checked;
  const mode = $('pe-dyn-custom_height_mode')?.value;
  
  const toggleField = (key, enabled) => {
    const el = $(`pe-dyn-${key}`);
    if (el) {
      el.disabled = !enabled;
      el.closest('.pe-field').style.display = enabled ? '' : 'none';
      if (!enabled) {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
      }
    }
  };

  if (noHeight) {
    toggleField('custom_height_mode', false);
    toggleField('height_min', false);
    toggleField('height_max', false);
    toggleField('exact_height', false);
  } else {
    toggleField('custom_height_mode', true);
    if (mode === 'range') {
      toggleField('height_min', true);
      toggleField('height_max', true);
      toggleField('exact_height', false);
    } else if (mode === 'exact') {
      toggleField('height_min', false);
      toggleField('height_max', false);
      toggleField('exact_height', true);
    } else {
      toggleField('height_min', false);
      toggleField('height_max', false);
      toggleField('exact_height', false);
    }
  }
}

export function startDynEdit(index, card) {
  fillDynFields(card);
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  setDynMode(index);
  updateDynFormState();
  $('pe-dynamic-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('pe-dyn-name')?.focus({ preventScroll: true });
}

export function resetDynForm() {
  $('pe-dyn-name').value = '';
  const schema = CATEGORY_SCHEMAS[state.activeCategory];
  if (schema) {
    for (const f of schema.fields) {
      const el = document.querySelector(`[data-dyn-key="${f.key}"]`);
      if (el) {
        if (f.type === 'checkbox') el.checked = false;
        else el.value = '';
      }
    }
  }
  const err = $('pe-dyn-error');
  if (err) err.hidden = true;
  setDynMode(-1);
  updateDynFormState();
}

export function applyDynChange({ scrollToEnd = false } = {}) {
  ui.showCategory({ category: state.activeCategory, text: state.form.texts[state.activeCategory] || '', viewMode: state.viewMode });
  if (onDynamicChange) {
    onDynamicChange({ scrollToEnd });
  }
}

export function submitDyn() {
  const data = readDynRaw();
  const isEdit = state.dynEditIndex >= 0;
  if (!data.value) {
    const err = $('pe-dyn-error');
    err.textContent = 'Назва обов\'язкова';
    err.hidden = false;
    $('pe-dyn-name').focus();
    return;
  }
  
  const cards = getDynamicCards();
  const meta = { ...data };
  delete meta.value;

  // Фобія: "Назва" + "Пояснення" → один рядок "Назва - Пояснення" (це й йде в value у Supabase).
  const withExplanation = hasExplanationField(state.activeCategory);
  const storedValue = withExplanation ? joinNameExplanation(data.value, data.explanation) : data.value;
  if (withExplanation) delete meta.explanation;
  
  for (const k of Object.keys(meta)) {
    if (meta[k] === '' || (Array.isArray(meta[k]) && meta[k].length === 0)) {
      delete meta[k];
    }
  }

  // Поле action_type тимчасово приховане з форми (categories.js)
  if (state.dynEditIndex >= 0 && state.activeCategory === 'special_ability') {
    const prevAction = cards[state.dynEditIndex]?.meta?.action_type;
    if (prevAction !== undefined && prevAction !== null && prevAction !== '') meta.action_type = prevAction;
  }

  let oldOpposite = null;
  if (state.activeCategory === 'gender') {
    if (state.dynEditIndex >= 0) oldOpposite = cards[state.dynEditIndex].meta.opposite;
    const targetName = meta.opposite;
    const currentName = data.value;
    if (targetName) {
      if (targetName === currentName) {
        const err = document.getElementById('pe-dyn-error');
        err.textContent = "Стать не може бути протилежною сама собі.";
        err.hidden = false;
        return;
      }
      let targetIndex = cards.findIndex(c => c.value === targetName);
      if (targetIndex >= 0) {
        const targetOpposite = cards[targetIndex].meta.opposite;
        if (targetOpposite && targetOpposite !== currentName) {
          const err = document.getElementById('pe-dyn-error');
          err.textContent = `Стать "${targetName}" вже має протилежну стать "${targetOpposite}".`;
          err.hidden = false;
          return;
        }
      }
    }
  }

  if (state.dynEditIndex >= 0) {
    cards[state.dynEditIndex] = { value: storedValue, meta };
  } else {
    cards.push({ value: storedValue, meta });
    state.newDynIndex = cards.length - 1;
  }

  if (state.activeCategory === 'gender') {
    const targetName = meta.opposite;
    const currentName = data.value;
    if (oldOpposite && oldOpposite !== targetName) {
      let oldIndex = cards.findIndex(c => c.value === oldOpposite);
      if (oldIndex >= 0 && cards[oldIndex].meta.opposite === currentName) {
        delete cards[oldIndex].meta.opposite;
      }
    }
    if (targetName) {
      let targetIndex = cards.findIndex(c => c.value === targetName);
      if (targetIndex >= 0) {
        cards[targetIndex].meta.opposite = currentName;
      } else {
        cards.push({ value: targetName, meta: { opposite: currentName } });
      }
    }
  }

  state.form.texts[state.activeCategory] = cards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');
  
  applyDynChange({ scrollToEnd: state.newDynIndex >= 0 });
  resetDynForm();
  
  if (state.newDynIndex >= 0) {
    state.newDynIndex = -1;
  }
  showGlobalToast(isEdit ? 'Картку оновлено' : 'Картку додано');
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

  cards.splice(state.dynEditIndex, 1);
  state.form.texts[state.activeCategory] = cards.map(c => cardToLine(state.activeCategory, c.value, c.meta)).join('\n');
  
  applyDynChange();
  resetDynForm();
  showGlobalToast('Картку видалено');
}

export function handleDynClick(e) {
  const btn = e.target.closest('[data-dyn-action]');
  if (!btn || btn.disabled) return;
  switch (btn.dataset.dynAction) {
    case 'submit': submitDyn(); break;
    case 'cancel': resetDynForm(); break;
    case 'delete': deleteDyn(btn); break;
  }
}

export function updateComboDropdown(input, forceShowAll = false) {
  const list = input.parentElement.querySelector('.pe-combo__dropdown');
  if (!list) return;
  const cards = getDynamicCards();
  const nameEl = document.getElementById('pe-dyn-name');
  const currentName = nameEl ? nameEl.value : '';
  let options = cards.map(c => c.value);
  if (currentName) options = options.filter(o => o !== currentName);
  
  const filter = forceShowAll ? '' : input.value.toLowerCase();
  const filtered = options.filter(o => o.toLowerCase().includes(filter));
  
  if (filtered.length === 0) {
    list.innerHTML = '<div class="pe-combo__empty">Введіть нове значення</div>';
  } else {
    list.innerHTML = filtered.map(o => `<div class="pe-combo__item" data-val="${o.replace(/"/g, '&quot;')}">${o.replace(/</g, '&lt;')}</div>`).join('');
  }
}

