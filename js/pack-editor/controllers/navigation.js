import { state } from './state.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { normalizeForm } from './payload.js';

const UNSAVED_NOTE = 'Усі незбережені зміни будуть втрачені';

export function getPackIdFromHash() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('id');
}

// Зайві пробіли та порожні рядки змінами не вважаються (нормалізація — pack-payload.js)
export const isDirty = (blankFormFn) => normalizeForm(state.form) !== normalizeForm(state.initialForm);

export function goToList() {
  state.allowLeave = true;
  window.location.hash = '#/packs';
}

export async function confirmAction(actionLabel, anchor) {
  if (state.isConfirming) return false;
  state.isConfirming = true;
  try {
    return await showPackConfirm(`Чи точно хочете ${actionLabel}? ${UNSAVED_NOTE}`, anchor, { confirmLabel: 'Підтвердити' });
  } finally {
    state.isConfirming = false;
  }
}

export function onBeforeUnload(e) {
  if (!state.allowLeave && isDirty()) {
    e.preventDefault();
    e.returnValue = ''; // потрібно для Chrome
  }
}
