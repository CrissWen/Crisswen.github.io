import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';

// Помічники, спільні для кількох зон редактора (динамічна форма карток і блок стадій).

export async function copyPromptToClipboard(prompt, emptyMsg) {
  if (!prompt) {
    showGlobalToast(emptyMsg);
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
    showGlobalToast('Промпт для LLM скопійовано');
  } catch {
    showGlobalToast('Не вдалося скопіювати промпт');
  }
}

// Клавіатура в рядку стадії: рік → місяць → наступний рядок (Пробіл / Enter)
export function handleStageKeydown(e) {
  const row = e.target.closest('.pe-stage-row');
  if (!row) return;

  const isY = e.target.dataset.type === 'y';
  const isM = e.target.dataset.type === 'm';
  const isName = e.target.classList.contains('pe-stage-name');
  const isSpace = e.key === ' ' || e.code === 'Space';
  const isEnter = e.key === 'Enter';

  const focusInput = el => {
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  };

  const focusRowTimeOrName = targetRow => {
    if (!targetRow || !targetRow.classList.contains('pe-stage-row')) return false;
    const timeField = targetRow.querySelector('.pe-stage-to-wrap .pe-time-field');
    const yInput = targetRow.querySelector('[data-type="y"]');
    if (timeField && timeField.style.display !== 'none' && yInput) {
      return focusInput(yInput);
    }
    return focusInput(targetRow.querySelector('.pe-stage-name'));
  };

  // У полі року: Пробіл або Enter перескакує на місяць
  if (isY && (isSpace || isEnter)) {
    e.preventDefault();
    focusInput(row.querySelector('[data-type="m"]'));
    return;
  }

  // У полі місяця: Пробіл або Enter перескакує на наступне поле цифр або назву наступної стадії
  if (isM && (isSpace || isEnter)) {
    e.preventDefault();
    if (!focusRowTimeOrName(row.nextElementSibling)) e.target.blur();
    return;
  }

  // У назві стадії: Enter переходить до цифр цього рядка (якщо є) або до наступної стадії
  if (isName && isEnter) {
    e.preventDefault();
    const timeField = row.querySelector('.pe-stage-to-wrap .pe-time-field');
    const yInput = row.querySelector('[data-type="y"]');
    if (timeField && timeField.style.display !== 'none' && yInput) {
      focusInput(yInput);
    } else {
      const nextRow = row.nextElementSibling;
      if (!focusInput(nextRow?.querySelector('.pe-stage-name'))) e.target.blur();
    }
  }
}
