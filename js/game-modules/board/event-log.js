// БЛОК 6 — «ЛОГ ПОДІЙ» (історія дій). Розташований одразу під таблицею «Спец можливості».
// Дані беремо з bunker_state.logs (записи { id, t, text }), спільні для всіх гравців, ведучого і глядачів.
// Дошка перемальовується на кожне оновлення кімнати, тому стан «розгорнуто/згорнуто» тримаємо тут, у пам'яті вкладки.

let isOpen = false;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function timeLabel(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// logs — масив із bunker_state.logs; hiddenIds — id записів, які поки що не можна показувати
// (запис про кидок кубика ховається до зупинки кубика, щоб лог не видав результат раніше анімації).
export function eventLog(logs, hiddenIds = []) {
  const hidden = new Set(hiddenIds);
  const entries = (Array.isArray(logs) ? logs : [])
    .filter(l => l && !hidden.has(l.id)); // хронологічно: старі зверху, нові знизу (автоскрол веде до останнього)

  const items = entries.length
    ? entries.map(l => `
        <li class="event-log__item">
          <span class="event-log__time">${esc(timeLabel(l.t))}</span>
          <span class="event-log__text">${esc(l.text)}</span>
        </li>`).join('')
    : '<li class="event-log__empty">Поки що подій немає</li>';

  return `
    <section class="block event-log" id="block-event-log">
      <button type="button" class="event-log__toggle" data-log-toggle aria-expanded="${isOpen}" aria-controls="event-log-list">
        <span>Лог подій</span>
        <span class="event-log__arrow${isOpen ? ' is-open' : ''}" aria-hidden="true">▼</span>
      </button>
      <ul class="event-log__list${isOpen ? '' : ' is-collapsed'}" id="event-log-list">${items}</ul>
    </section>
  `;
}

// Прокручує список у самий низ, до найсвіжішої події. У згорнутому стані (display: none) скрол не має сенсу, тому пропускаємо.
export function scrollEventLogToBottom() {
  if (!isOpen) return;
  const list = document.getElementById('event-log-list');
  if (list) list.scrollTop = list.scrollHeight;
}

// Перемикає список без перемальовування всієї дошки
export function toggleEventLog() {
  isOpen = !isOpen;
  const section = document.getElementById('block-event-log');
  if (!section) return;
  section.querySelector('#event-log-list')?.classList.toggle('is-collapsed', !isOpen);
  section.querySelector('.event-log__arrow')?.classList.toggle('is-open', isOpen);
  section.querySelector('[data-log-toggle]')?.setAttribute('aria-expanded', String(isOpen));
  scrollEventLogToBottom(); // при кожному розгортанні — одразу до найсвіжішого запису
}
