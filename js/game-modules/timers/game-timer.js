import { getGlobalTime } from '../../services/server-time.js';
import { soundManager, SOUND_IDS } from '../../services/sound-manager.js';

// Плаваючий таймер внизу екрана. Живе поза #game-board (як і панель ведучого),
// тож перемальовування дошки його не зачіпає.
// Час закінчення береться зі стану кімнати: bunker_state.global_timer_end (timestamp у мс).


const TIMER_ID = 'game-timer-root';
const HIDE_AFTER_EXPIRED_MS = 10000; // скільки показувати 00 після завершення

const TICK_SOUND_FROM_SEC = 10; // цокання лунає в останні N секунд (збігається з жовтою підсвіткою game-timer--warn)

let intervalId = null;
let lastTickSecond = null; // для якого значення залишку тік уже зіграно: tick() викликається і при монтуванні, і щосекунди

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

  const bState = getBunkerState() || {};
  const end = Number(bState.global_timer_end) || 0;
  const hasPause = bState.timer_paused_left !== null && bState.timer_paused_left !== undefined;

  // Обидва порожні — таймер ніколи не запускали або його зупинили кнопкою "Стоп"
  if (!end && !hasPause) {
    root.hidden = true;
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

  if (remaining <= -Math.ceil(HIDE_AFTER_EXPIRED_MS / 1000)) {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  root.classList.toggle('game-timer--done', remaining <= 0);
  root.classList.toggle('game-timer--warn', remaining > 0 && remaining <= 10);
  root.querySelector('[data-timer-time]').textContent = formatTime(remaining);

  // Цокання в кожного клієнта локально, за серверним часом; на паузі (return вище) і після нуля тиші
  if (remaining > 0 && remaining <= TICK_SOUND_FROM_SEC) {
    if (remaining !== lastTickSecond) {
      lastTickSecond = remaining;
      soundManager.play(SOUND_IDS.TIMER_TICK);
    }
  } else if (remaining > TICK_SOUND_FROM_SEC) {
    lastTickSecond = null; // новий таймер: наступний відлік знову дасть звук
  }
}

// getBunkerState — функція, що повертає актуальний bunker_state (щоб таймер бачив свіжі дані)
export function mountGameTimer(getBunkerState) {
  unmountGameTimer();
  lastTickSecond = null;
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
