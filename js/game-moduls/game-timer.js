// Плаваючий таймер внизу екрана. Живе поза #game-board (як і панель ведучого),
// тож перемальовування дошки його не зачіпає.
// Час закінчення береться зі стану кімнати: bunker_state.global_timer_end (timestamp у мс).

const TIMER_ID = 'game-timer-root';
const HIDE_AFTER_EXPIRED_MS = 10000; // скільки показувати 00 після завершення

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

function tick(getBunkerState) {
  const root = document.getElementById(TIMER_ID);
  if (!root) return;

  const end = Number(getBunkerState()?.global_timer_end);
  if (!end) {
    root.hidden = true;
    return;
  }

  const now = Date.now();
  const remaining = Math.ceil((end - now) / 1000);

  if (remaining <= -Math.ceil(HIDE_AFTER_EXPIRED_MS / 1000)) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  root.classList.toggle('game-timer--done', remaining <= 0);
  root.classList.toggle('game-timer--warn', remaining > 0 && remaining <= 10);
  root.querySelector('[data-timer-time]').textContent = formatTime(remaining);
}

// getBunkerState — функція, що повертає актуальний bunker_state (щоб таймер бачив свіжі дані)
export function mountGameTimer(getBunkerState) {
  unmountGameTimer();
  document.body.insertAdjacentHTML('beforeend', timerHtml());
  tick(getBunkerState);
  intervalId = setInterval(() => tick(getBunkerState), 1000);
}

export function unmountGameTimer() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  document.getElementById(TIMER_ID)?.remove();
}
