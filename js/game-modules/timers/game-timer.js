// Плаваючий таймер внизу екрана. Живе поза #game-board (як і панель ведучого),
// тож перемальовування дошки його не зачіпає.
// Час закінчення береться зі стану кімнати: bunker_state.global_timer_end (timestamp у мс).

import { getGlobalTime } from '../../utils/time-sync.js';

const TIMER_ID = 'game-timer-root';

let intervalId = null;

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  return pad(s); // лише секунди у форматі СС (60, 59, 15, 09)
}

function timerHtml() {
  return `
    <div id="${TIMER_ID}" class="game-timer" hidden aria-live="off">
      <div class="game-timer__time" data-timer-time>00</div>
      <!-- TODO: Voting UI — відображення голосування поки не реалізоване -->
      <div class="game-timer__voting" data-timer-voting hidden></div>
    </div>
  `;
}

function tick(getBunkerState, onExpire) {
  const root = document.getElementById(TIMER_ID);
  if (!root) return;

  const bState = getBunkerState() || {};
  const end = Number(bState.global_timer_end) || 0;
  const hasPause = bState.timer_paused_left !== null && bState.timer_paused_left !== undefined;

  // Обидва порожні — таймер ніколи не запускали або його зупинили кнопкою "Стоп"
  if (!end && !hasPause) {
    root.hidden = true;
    delete root.dataset.expiredTriggered;
    return;
  }

  root.classList.remove('game-timer--paused');

  // На паузі: показуємо заморожений залишок (без відліку), доки ведучий не відновить таймер
  if (hasPause && !end) {
    const pausedSeconds = Math.ceil(Number(bState.timer_paused_left) / 1000);
    root.hidden = false;
    root.classList.remove('game-timer--done', 'game-timer--warn');
    root.classList.add('game-timer--paused');
    root.querySelector('[data-timer-time]').textContent = formatTime(pausedSeconds);
    return;
  }

  const now = getGlobalTime();
  const remaining = Math.ceil((end - now) / 1000);

  // Коли час вийшов і 00 провисіло 1 секунду — ховаємо і викликаємо onExpire
  if (remaining <= -1) {
    root.hidden = true;
    if (onExpire && !root.dataset.expiredTriggered) {
      root.dataset.expiredTriggered = 'true';
      onExpire();
    }
    return;
  }

  // Якщо час є — знімаємо прапорець (на випадок, якщо таймер запустили заново)
  delete root.dataset.expiredTriggered;

  root.hidden = false;
  root.classList.toggle('game-timer--done', remaining <= 0);
  root.classList.toggle('game-timer--warn', remaining > 0 && remaining <= 10);
  root.querySelector('[data-timer-time]').textContent = formatTime(remaining);
}

// getBunkerState — функція, що повертає актуальний bunker_state
// onExpire — колбек, який викликається при досягненні 00
export function mountGameTimer(getBunkerState, onExpire) {
  unmountGameTimer();
  document.body.insertAdjacentHTML('beforeend', timerHtml());
  tick(getBunkerState, onExpire);
  intervalId = setInterval(() => tick(getBunkerState, onExpire), 1000);
}

export function unmountGameTimer() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  document.getElementById(TIMER_ID)?.remove();
}
