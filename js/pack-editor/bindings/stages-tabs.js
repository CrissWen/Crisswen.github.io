import { STAGE_KEYS } from '../payload.js';
import { oneLine, deduplicateStageLines } from '../parser.js';
import { getStagePrompt } from '../prompts/stage-prompts.js';
import { processDroppedLlmFiles } from '../llm-file-import.js';
import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/shared.js';
import { state } from '../state.js';
import { copyPromptToClipboard, handleStageKeydown } from './shared.js';

// Блок стадій (вкладки на мобільних, режим LLM, введення/додавання/видалення рядків) і діапазони значень
export function bindStagesTabs(ctx) {
  const { signal } = ctx;

  ui.setStageReorderCallback(key => {
    const text = ui.gatherStageText(key);
    state.form.stages[key] = text;
    const ta = document.querySelector(`[data-stage-ta="${key}"]`);
    if (ta) ta.value = text;
    ctx.updateButtons();
  });

  $('pe-stages-nav')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-stage-tab]');
    if (!btn) return;
    const key = btn.dataset.stageTab;
    document.querySelectorAll('#pe-stages-nav [data-stage-tab]').forEach(b => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('#pe-stages [data-stage-group]').forEach(group => {
      group.classList.toggle('is-active-mobile', group.dataset.stageGroup === key);
    });
  }, { signal });

  $('pe-stages-llm')?.addEventListener('change', e => {
    const isLlm = e.target.checked;
    state.stagesViewMode = isLlm ? 'llm' : 'visual';

    STAGE_KEYS.forEach(key => {
      const ta = document.querySelector(`[data-stage-ta="${key}"]`);
      if (isLlm) {
        const text = ui.gatherStageText(key);
        state.form.stages[key] = text;
        if (ta) ta.value = text;
      } else {
        if (ta) {
          const cleaned = deduplicateStageLines(key, ta.value);
          ta.value = cleaned;
          state.form.stages[key] = cleaned;
        }
        ui.renderStageList(key, state.form.stages[key] || '');
      }
    });
    ui.setStagesViewMode(state.stagesViewMode);
    ctx.updateButtons();
  }, { signal });

  $('pe-stages').addEventListener('input', e => {
    const ta = e.target.closest('[data-stage-ta]');
    if (ta) {
      state.form.stages[ta.dataset.stageTa] = ta.value;
      ctx.updateButtons();
      return;
    }

    const stageGroup = e.target.closest('[data-stage-list]');
    if (stageGroup) {
      const key = stageGroup.dataset.stageList;
      ui.ensureTrailingEmptyStageRow(stageGroup, key);
      state.form.stages[key] = ui.gatherStageText(key);
      ctx.updateButtons();
    }
  }, { signal });

  $('pe-stages').addEventListener('keydown', e => {
    if (e.target.closest('[data-stage-list]')) {
      handleStageKeydown(e);
    }
  }, { signal });

  $('pe-stages').addEventListener('focusin', ui.handleStageTimeFocusIn, { signal });

  $('pe-stages').addEventListener('focusout', e => {
    const stageGroup = e.target.closest('[data-stage-list]');
    if (ui.normalizeStageRowTimeOnBlur(e, stageGroup)) {
      const key = stageGroup.dataset.stageList;
      state.form.stages[key] = ui.gatherStageText(key);
      ctx.updateButtons();
    }
  }, { signal });

  $('pe-stages').addEventListener('change', e => {
    const stageGroup = e.target.closest('[data-stage-list]');
    if (stageGroup) {
      const key = stageGroup.dataset.stageList;
      const rows = [...stageGroup.querySelectorAll('.pe-stage-row')];
      let i = rows.length - 1;
      while (i > 0 && !rows[i].querySelector('.pe-stage-name')?.value?.trim() && !rows[i - 1].querySelector('.pe-stage-name')?.value?.trim()) {
        rows[i].remove();
        i--;
      }
      state.form.stages[key] = ui.gatherStageText(key);
      ctx.updateButtons();
    }
  }, { signal });

  $('pe-stages').addEventListener('click', async e => {
    const copyBtn = e.target.closest('[data-stage-copy]');
    if (copyBtn) {
      await copyPromptToClipboard(getStagePrompt(copyBtn.dataset.stageCopy), 'Промпт для цієї стадії відсутній');
      return;
    }

    const addBtn = e.target.closest('[data-stage-add]');
    if (addBtn) {
      const key = addBtn.dataset.stageAdd;
      const list = document.querySelector(`[data-stage-list="${key}"]`);
      if (list) {
        list.insertAdjacentHTML('beforeend', ui.stageRowHtml(key, { name: '' }));
        state.form.stages[key] = ui.gatherStageText(key);
        ctx.updateButtons();
      }
    }

    const delBtn = e.target.closest('.pe-stage-del');
    if (delBtn) {
      const row = delBtn.closest('.pe-stage-row');
      const list = row?.closest('[data-stage-list]');
      if (list && row) {
        const key = list.dataset.stageList;
        const rows = [...list.querySelectorAll('.pe-stage-row')];
        const isLastRow = row === rows[rows.length - 1];
        const name = row.querySelector('.pe-stage-name')?.value?.trim();
        if (isLastRow && !name) return;

        if (name) {
          const confirmed = await showPackConfirm(`Чи точно хочете видалити стадію "${oneLine(name)}"?`, delBtn, { confirmLabel: 'Видалити' });
          if (!confirmed || signal?.aborted) return;
        }

        row.remove();
        state.form.stages[key] = ui.gatherStageText(key);
        ctx.updateButtons();
      }
    }
  }, { signal });

  $('pe-ranges').addEventListener('input', e => {
    const field = e.target.closest('[data-range]');
    if (!field) return;
    state.form.ranges[field.dataset.range] = field.value;
    ctx.updateButtons();
  }, { signal });

  $('pe-stages').addEventListener('dragover', e => {
    const ta = e.target.closest?.('[data-stage-ta]');
    if (!ta || ta.hidden) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    ta.classList.add('is-dragover');
  }, { signal });

  $('pe-stages').addEventListener('dragleave', e => {
    const ta = e.target.closest?.('[data-stage-ta]');
    if (!ta) return;
    if (!ta.contains(e.relatedTarget)) ta.classList.remove('is-dragover');
  }, { signal });

  $('pe-stages').addEventListener('drop', async e => {
    const ta = e.target.closest?.('[data-stage-ta]');
    if (!ta || ta.hidden) return;
    e.preventDefault();
    ta.classList.remove('is-dragover');
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    const sessionId = state.sessionId;
    const stageKey = ta.dataset.stageTa;
    const res = await processDroppedLlmFiles(files, {
      mode: 'stages',
      targetKey: stageKey,
      existingText: ta.value
    });
    if (signal?.aborted || state.sessionId !== sessionId) return;

    if (res.ok) {
      ta.value = res.nextText;
      state.form.stages[stageKey] = res.nextText;
      ctx.updateButtons();
    }
    if (res.message) showGlobalToast(res.message);
  }, { signal });
}
