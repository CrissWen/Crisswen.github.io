import { state } from '../state.js';
import { DEFAULT_PACK_ID, savePack } from '../../services/packs-store.js';
import {
  validateTitle, validateRanges, buildCardRows, buildPackConfig,
  MAX_PACK_CARDS, normalizeForm, STAGE_KEYS, OBJECT_STAGE_KEYS,
  validateStageText, validateStageEntries
} from '../payload.js';
import { parseCards } from '../parser.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import { cataDraftPending } from './cataclysm.js';
import { dynDraftPending } from './dynamic.js';
import { isDirty, confirmAction, goToList } from './navigation.js';

let orchestrator = {
  blankForm: () => ({}),
  cloneForm: (f) => f,
  syncFieldsFromForm: () => {}
};

export function setSaveOrchestrator(handlers) {
  orchestrator = { ...orchestrator, ...handlers };
}

export const isFormEmpty = () => normalizeForm(state.form) === normalizeForm(orchestrator.blankForm());

export const buildConfig = () => buildPackConfig({
  defaultConfig: state.defaultConfig,
  packConfig: state.packConfig,
  stages: state.form.stages,
  ranges: state.form.ranges
});

export async function handleSave(btn) {
  if (state.isSaving) return;

  const title = state.form.title.trim();
  const error = validateTitle(title, { isDefaultPack: state.packId === DEFAULT_PACK_ID });
  if (error) {
    ui.showTitleError(error);
    ui.focusTitle();
    return;
  }

  const rangeError = validateRanges(state.form.ranges);
  if (rangeError) {
    showGlobalToast(rangeError);
    return;
  }

  // Заповнену, але не додану форму катаклізму не зберігаємо мовчки разом з паком
  if (cataDraftPending()) {
    showGlobalToast('У формі катаклізму є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }
  
  if (dynDraftPending()) {
    showGlobalToast('У формі характеристики є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }

  // Синхронізуємо стадії перед збереженням
  if (state.stagesViewMode === 'llm') {
    STAGE_KEYS.forEach(k => {
      const ta = document.querySelector(`[data-stage-ta="${k}"]`);
      if (ta) state.form.stages[k] = ta.value;
    });
  } else {
    STAGE_KEYS.forEach(k => {
      state.form.stages[k] = ui.gatherStageText(k);
    });
  }

  // Перевірка коректності проміжних стадій у глобальних налаштуваннях
  for (const k of OBJECT_STAGE_KEYS) {
    const stageErr = validateStageText(k, state.form.stages[k] || '');
    if (stageErr) {
      showGlobalToast(stageErr);
      return;
    }
  }

  // Якщо ми в LLM-режимі на вкладці Катаклізмів, треба синхронізувати текст у масив перед збереженням
  if (state.viewMode === 'llm' && state.activeCategory === 'cataclysm') {
    const parsed = parseCards(state.form.texts.cataclysm, 'cataclysm');
    state.form.cataclysms = parsed.map(c => ({
      name: c.value,
      description: c.meta.description || '',
      timer_minutes: c.meta.timer_minutes || 0,
      stay_time_months: c.meta.stay_time_months || null,
      population: c.meta.population || null,
      extra: c.meta.extra || {}
    })).filter(c => c.name);
  }

  const cards = buildCardRows(state.form.texts, state.extraMeta, state.form.cataclysms);
  for (const c of cards) {
    if (OBJECT_STAGE_KEYS.includes(c.category) && Array.isArray(c.meta?.stages)) {
      const cardStageErr = validateStageEntries(c.category, c.meta.stages);
      if (cardStageErr) {
        showGlobalToast(`У картці "${c.value}": ${cardStageErr}`);
        return;
      }
    }
  }

  if (cards.length > MAX_PACK_CARDS) {
    showGlobalToast(`Забагато характеристик: ${cards.length}. Максимум — ${MAX_PACK_CARDS}`);
    return;
  }

  const isEdit = Boolean(state.packId);
  const originalLabel = btn.textContent;
  state.isSaving = true;
  ui.setButtonState(btn, { disabled: true, text: 'Збереження...' });

  try {
    await savePack({
      id: state.packId,
      title,
      description: state.form.description.trim(),
      config: buildConfig(),
      cards
    });
    showGlobalToast(isEdit ? 'Пак оновлено' : 'Пак створено');
    goToList();
  } catch (err) {
    console.error('Не вдалося зберегти пак:', err);
    showGlobalToast(err.message || 'Не вдалося зберегти пак');
    ui.setButtonState(btn, { disabled: false, text: originalLabel });
  } finally {
    state.isSaving = false;
  }
}

export async function handleClear(btn) {
  if (!(await confirmAction('очистити все', btn))) return;
  state.form = orchestrator.blankForm();
  state.extraMeta = {};
  orchestrator.syncFieldsFromForm();
  showGlobalToast('Форму очищено');
}

export async function handleReset(btn) {
  if (!(await confirmAction('скасувати зміни', btn))) return;
  state.form = orchestrator.cloneForm(state.initialForm);
  orchestrator.syncFieldsFromForm();
  showGlobalToast('Зміни скасовано');
}

export async function handleExit(btn) {
  if (isDirty() && !(await confirmAction(btn.textContent.trim().toLowerCase(), btn))) return;
  goToList();
}

export function handleActionsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;

  switch (btn.dataset.action) {
    case 'save':  handleSave(btn); break;
    case 'clear': handleClear(btn); break;
    case 'reset': handleReset(btn); break;
    case 'exit':  handleExit(btn); break;
  }
}

