import { state } from '../state.js';
import { cataclysmNamesText, cataFieldStrings, hasCataDraft, validateCataclysmInput } from '../payload.js';
import { oneLine } from '../parser.js';
import { showPackConfirm } from '../../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import * as ui from '../ui/ui.js';
import { $ } from '../ui/helpers.js';

// Коллбек оновлення зовнішнього UI (renderList, renderSearch, лічильники)
let onCataChange = null;

export function setCataChangeHandler(fn) {
  onCataChange = fn;
}

// Текст списку (назви по одній на рядок) усередині state.form.texts.cataclysm: з нього читаються лічильники, підсумок і трекінг змін
export function syncCataText(f = state.form) {
  f.texts.cataclysm = cataclysmNamesText(f.cataclysms);
}

// Чи є у формі дані, які ще не потрапили в список (новий катаклізм або незбережені правки існуючого)
export const cataDraftPending = () => hasCataDraft(ui.readCataRaw(), state.form.cataclysms[state.cataEditIndex], state.cataEditIndex >= 0);

export function renderCataList(tokens = []) {
  ui.renderCataList({
    cataclysms: state.form.cataclysms,
    editIndex: state.cataEditIndex,
    newIndex: state.newCataIndex,
    tokens
  });
}

// Режим форми: -1 — додавання нового, ≥ 0 — редагування існуючого
export function setCataMode(index) {
  state.cataEditIndex = index;
  ui.paintCataMode(index >= 0 ? state.form.cataclysms[index] : null);
  if (onCataChange) onCataChange();
  else renderCataList();
}

// Очищає поля і повертає форму в режим "додати"
export function resetCataForm() {
  ui.clearCataFields();
  ui.showCataError('');
  setCataMode(-1);
}

// Після будь-якої зміни списку: перемальовуємо поле-список, лічильники, підсумок і стан кнопок
export function applyCataChange({ scrollToEnd = false } = {}) {
  syncCataText();
  if (onCataChange) {
    onCataChange({ scrollToEnd });
  } else {
    renderCataList();
    if (scrollToEnd) ui.scrollCataListToEnd();
  }
}

// "Додати" / "Зберегти зміни" — залежно від режиму форми. Після успіху дані з’являються в полі-списку, а поля форми очищаються.
export function submitCata() {
  const result = validateCataclysmInput(ui.readCataRaw(), { cataclysms: state.form.cataclysms, editIndex: state.cataEditIndex });
  if (result.error) {
    ui.showCataError(result.error, result.field);
    return;
  }

  const existing = state.cataEditIndex >= 0 ? state.form.cataclysms[state.cataEditIndex] : null;
  if (existing) {
    // Додаткова meta цього катаклізму, якої форма не показує, лишається правою
    state.form.cataclysms[state.cataEditIndex] = { ...result.item, extra: existing.extra || {} };
  } else {
    state.form.cataclysms.push(result.item);
  }

  applyCataChange();
  resetCataForm();

  // Новий рядок з’являється з анімацією: клас is-new діє лише на цей рендер
  if (!existing) {
    state.newCataIndex = state.form.cataclysms.length - 1;
    if (onCataChange) onCataChange();
    state.newCataIndex = -1;
    ui.scrollCataListToEnd();
  }
  showGlobalToast(existing ? 'Катаклізм оновлено' : 'Катаклізм додано');
  $(ui.CATA_FIELDS.name)?.focus();
}

// Клік по назві у списку → поля форми заповнюються даними цього катаклізму
export function startCataEdit(index) {
  const item = state.form.cataclysms[index];
  if (!item) return;
  ui.fillCataFields(cataFieldStrings(item));
  ui.showCataError('');
  setCataMode(index);
  $(ui.CATA_FIELDS.name)?.focus({ preventScroll: true });
}

export async function deleteCata(btn) {
  const item = state.cataEditIndex >= 0 ? state.form.cataclysms[state.cataEditIndex] : null;
  if (!item || state.isConfirming) return;

  state.isConfirming = true;
  let confirmed = false;
  try {
    confirmed = await showPackConfirm(`Чи точно хочете видалити катаклізм "${oneLine(item.name)}"?`, btn, { confirmLabel: 'Видалити' });
  } finally {
    state.isConfirming = false;
  }
  if (!confirmed) return;

  // Після await індекс міг змінитися (наприклад, "Очистити все"), тому шукаємо запис за посиланням
  const index = state.form.cataclysms.indexOf(item);
  if (index < 0) return;
  state.form.cataclysms.splice(index, 1);

  applyCataChange();
  resetCataForm();
  showGlobalToast('Катаклізм видалено');
}

export function handleCataClick(e) {
  const btn = e.target.closest('[data-cata-action]');
  if (!btn || btn.disabled) return;

  switch (btn.dataset.cataAction) {
    case 'submit': submitCata(); break;
    case 'cancel': resetCataForm(); break;
    case 'delete': deleteCata(btn); break;
  }
}

// Числові поля приймають лише цифри; правка поля прибирає попередню помилку
export function handleCataInput(e) {
  ui.sanitizeCataNumericInput(e.target);
  if (ui.isCataErrorVisible()) ui.showCataError('');
}

