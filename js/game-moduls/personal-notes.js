// БЛОК 6 — «ОСОБИСТІ ЗАМІТКИ» (тимчасові). Стоїть між блоком голосування та «Лог подій».
// Текст ніде не зберігається (ні в БД, ні в localStorage): він живе лише в змінній цього модуля,
// тож після перезавантаження сторінки зникає. Змінна потрібна тому, що дошка перемальовується через innerHTML
// на кожне оновлення кімнати (Realtime) — без неї текст у textarea щоразу стирався б.

let notesText = '';
let focusState = null; // { start, end, scrollTop } — щоб набір тексту не переривався перемальовуванням

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

const getTextarea = () => document.getElementById('personal-notes-input');

export function personalNotes() {
  return `
    <section class="block personal-notes" id="block-personal-notes">
      <div class="block-head">
        <h2>Особисті замітки</h2>
      </div>
      <div class="block-body">
        <p class="personal-notes__warning">Увага: після перезавантаження сайту дані зітруться!</p>
        <textarea id="personal-notes-input" class="personal-notes__input" rows="5"
          placeholder="Ваші записи, бачите тільки ви..." aria-label="Особисті замітки">${esc(notesText)}</textarea>
      </div>
    </section>
  `;
}

// Викликати ПЕРЕД перемальовуванням дошки: запам'ятовує, чи стояв курсор у полі, і де саме
export function captureNotesFocus() {
  const ta = getTextarea();
  focusState = ta && document.activeElement === ta
    ? { start: ta.selectionStart, end: ta.selectionEnd, scrollTop: ta.scrollTop }
    : null;
}

// Викликати ПІСЛЯ перемальовування: повертає фокус, виділення й прокрутку
export function restoreNotesFocus() {
  if (!focusState) return;
  const ta = getTextarea();
  if (ta) {
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(focusState.start, focusState.end);
    ta.scrollTop = focusState.scrollTop;
  }
  focusState = null;
}

// Один делегований слухач на весь документ: textarea щоразу створюється заново, тож вішати подію на неї напряму не можна
document.addEventListener('input', (e) => {
  if (e.target?.id === 'personal-notes-input') notesText = e.target.value;
});
