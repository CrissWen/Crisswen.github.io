// Таймер катаклізму — окремий від таймера обговорень (game-timer.js), синхронізований через
// bunker_state.cataclysm_timer_end. Живе поза #game-board (як і game-timer/host-panel), у лівому
// верхньому куті екрана, тож перемальовування дошки його не зачіпає.

const WIDGET_ID = 'cataclysm-timer-root';

let intervalId = null;
let trackedEnd = null; // яке значення cataclysm_timer_end зараз рахує активний інтервал
let isFrozen = false; // кімнату закрито: показ зафіксований, syncCataclysmTimer() більше нічого не змінює й не перезапускає

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ГГ:ММ:СС — катаклізм може тривати години (до 180 хв), тому самих секунд/хвилин замало
function formatHMS(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function widgetHtml() {
  return `
    <div id="${WIDGET_ID}" class="cataclysm-timer" hidden aria-live="off">
      <span class="cataclysm-timer__icon" aria-hidden="true">☢</span>
      <span class="cataclysm-timer__time" data-cata-time>00:00:00</span>
    </div>
  `;
}

function stopInterval() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Викликається ровно один раз на той тік, коли відлік для цього end вперше досягає нуля (завдяки stopInterval() в tick()).
// game.js використовує цей колбек, щоб показати модалку "Час сплив"; власний захист від повторного показу (hasSeenCataclysmEnd) живе там.
let onExpireCallback = null;

// Повертає залишок у секундах (для перевірки на завершення) і одразу малює його в DOM
function renderRemaining(end) {
  const root = document.getElementById(WIDGET_ID);
  if (!root) return 0;
  const remaining = Math.ceil((Number(end) - Date.now()) / 1000);
  const timeEl = root.querySelector('[data-cata-time]');
  if (timeEl) timeEl.textContent = formatHMS(remaining);
  return remaining;
}

function tick(end) {
  const remaining = renderRemaining(end);
  if (remaining <= 0) {
    // Досягли нуля — фіксуємо 00:00:00 (без від'ємних значень) і зупиняємо інтервал,
    // щоб не рахувати далі в мінус. syncCataclysmTimer() перезапустить його, якщо
    // ведучий поставить новий катаклізм з власним таймером.
    stopInterval();
    onExpireCallback?.();
  }
}

// Вставляє (порожній, прихований) контейнер віджета в DOM. Викликати один раз при вході в гру.
// onExpire (необов'язково) — колбек, що спрацьовує РІВНО ОДИН РАЗ на кожен новий кінцевий час,
// коли відлік вперше досягає нуля (game.js використовує його, щоб показати модалку "Час сплив").
export function mountCataclysmTimer(onExpire) {
  unmountCataclysmTimer();
  document.body.insertAdjacentHTML('beforeend', widgetHtml());
  trackedEnd = null;
  isFrozen = false;
  onExpireCallback = typeof onExpire === 'function' ? onExpire : null;
}

export function unmountCataclysmTimer() {
  stopInterval();
  document.getElementById(WIDGET_ID)?.remove();
  trackedEnd = null;
  isFrozen = false;
  onExpireCallback = null;
}

// Заморожує таймер на поточному значенні (викликається, коли кімната стає closed): зупиняє інтервал
// і блокує подальші оновлення. Текст у DOM не чіпаємо — на екрані лишається останній показаний час.
export function freezeCataclysmTimer() {
  isFrozen = true;
  stopInterval();
}

// Повертає текст, який зараз показано на екрані (напр. "01:25:30"), або null, якщо таймера немає/він прихований.
// Використовується при закритті кімнати ведучим: цей рядок йде в bunker_state.stopped_timer.
export function getCataclysmTimerText() {
  const root = document.getElementById(WIDGET_ID);
  if (!root || root.hidden) return null;
  const text = root.querySelector('[data-cata-time]')?.textContent?.trim();
  return text || null;
}

// Викликати при КОЖНОМУ оновленні стану кімнати (initGame + кожен WebSocket UPDATE),
// передаючи актуальний bunker_state і roomStatus (rooms.status). Якщо roomStatus === 'closed' — відлік не запускається,
// у віджет вставляється готовий рядок bunker_state.stopped_timer. В іншому разі рендериться лише якщо в bunker_state є cataclysm_timer_end;
// якщо ведучий поставив НОВИЙ катаклізм (інше значення поля) — перезапускає відлік
// навіть якщо попередній уже зупинився на нулі.
export function syncCataclysmTimer(bunkerState, roomStatus) {
  const root = document.getElementById(WIDGET_ID);
  if (!root || isFrozen) return; // заморожений таймер не ховаємо, не перезапускаємо і не перемальовуємо

  // Закрита кімната: ніякого відліку. Беремо готовий рядок з bunker_state.stopped_timer, вставляємо в контейнер
  // і одразу виходимо: setInterval не створюється, onExpire (модалка "Час сплив") не спрацює.
  if (roomStatus === 'closed') {
    stopInterval();
    const stopped = bunkerState?.stopped_timer;
    const timeEl = root.querySelector('[data-cata-time]');
    if (stopped && timeEl) {
      timeEl.textContent = stopped;
      root.hidden = false;
    } else {
      root.hidden = true; // час не збережено (кімнату закрито до цієї функції або таймера не було) — ховаємо, щоб не показувати вигаданий час
    }
    return;
  }

  const end = bunkerState?.cataclysm_timer_end;

  if (end === undefined || end === null) {
    root.hidden = true;
    stopInterval();
    trackedEnd = null;
    return;
  }

  root.hidden = false;

  if (end !== trackedEnd) {
    trackedEnd = end;
    stopInterval();
    tick(end);
    intervalId = setInterval(() => tick(end), 1000);
  }
}
