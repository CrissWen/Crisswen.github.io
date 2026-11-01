import { pushLog } from '../log-writer.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { getGlobalTime } from '../../services/server-time.js';

// ===== Глобальний таймер ведучого =====
// Кнопки таймера НІКОЛИ не пишуть latest_host_event — таймер працює автономно і не повинен спамити Toast'ами.
// У «Лог подій» вони пишуть напряму через pushLog (без Toast).

// 15 -> "15 с", 60 -> "1 хв", 90 -> "1 хв 30 с"
function formatTimerSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return [m ? `${m} хв` : '', s ? `${s} с` : ''].filter(Boolean).join(' ');
}

let autoStopTimeoutId = null;

export function clearTimerAutoStop() {
  if (autoStopTimeoutId) {
    clearTimeout(autoStopTimeoutId);
    autoStopTimeoutId = null;
  }
}

// Запускає таймер авто-зупинки на час залишку + 1 секунда, щоб на екрані висіло "00".
// Прив'язується до expectedEnd (global_timer_end конкретного запуску), щоб запізнілий колбек
// ніколи не погасив новий таймер, якщо ведучий встиг перезапустити його (виправляє C3).
function scheduleAutoStop(roomCode, delayMs, expectedEnd = null) {
  clearTimerAutoStop();
  const safeDelay = Math.max(0, delayMs);
  autoStopTimeoutId = setTimeout(async () => {
    autoStopTimeoutId = null;
    try {
      await stopGlobalTimer(roomCode, true, expectedEnd);
    } catch (err) {
      console.error('Не вдалося автоматично завершити таймер:', err);
    }
  }, safeDelay);
}

// Синхронізує авто-зупинку (наприклад, при переході або оновленні сторінки ведучого)
export function syncTimerAutoStop(roomCode, bunkerState) {
  const end = Number(bunkerState?.global_timer_end) || 0;
  if (!end) {
    clearTimerAutoStop();
    return;
  }
  if (autoStopTimeoutId) return; // вже заплановано
  const remainingMs = (end - getGlobalTime()) + 1000;
  scheduleAutoStop(roomCode, remainingMs, end);
}

export async function setGlobalTimer(roomCode, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Некоректний час таймера');
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  const end = getGlobalTime() + seconds * 1000;
  bState.global_timer_seconds = seconds;
  bState.global_timer_end = end;
  bState.timer_paused_left = null; // новий запуск скасовує попередню паузу, якщо вона була
  pushLog(bState, `Ведучий запустив таймер на ${formatTimerSeconds(seconds)}`); // лише запис у лог, без latest_host_event (без Toast)
  await saveRoom(roomCode, { bunker_state: bState }, room.version);

  // Таймер рахує seconds секунд + 1 секунду тримає "00", після чого завершує роботу
  scheduleAutoStop(roomCode, (seconds + 1) * 1000, end);
}

// Повністю зупиняє таймер (ховає віджет): і активний відлік, і збережену паузу.
// При isAuto = true перевіряє, чи bState.global_timer_end досі збігається з expectedEnd,
// щоб застарілий auto-stop не погасив перезапущений таймер (C3).
export async function stopGlobalTimer(roomCode, isAuto = false, expectedEnd = null) {
  if (!isAuto) clearTimerAutoStop();
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};

  if (isAuto) {
    if (!bState.global_timer_end) return;
    if (expectedEnd !== null && bState.global_timer_end !== expectedEnd) return;
  } else {
    snapshot(room);
  }

  bState.global_timer_end = null;
  bState.timer_paused_left = null;
  pushLog(bState, isAuto ? 'Час таймера вийшов' : 'Ведучий зупинив таймер');
  await saveRoom(roomCode, { bunker_state: bState }, room.version);
}

// Перемикач паузи: якщо таймер іде — заморожує залишок у timer_paused_left;
// якщо вже на паузі — відновлює відлік від збереженого залишку.
// Повертає 'paused' або 'resumed', щоб UI показав відповідний тост.
export async function pauseGlobalTimer(roomCode) {
  clearTimerAutoStop();
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};

  if (bState.global_timer_end) {
    const left = Math.max(0, bState.global_timer_end - getGlobalTime());
    bState.timer_paused_left = left;
    bState.global_timer_end = null;
    pushLog(bState, 'Ведучий призупинив таймер');
    await saveRoom(roomCode, { bunker_state: bState }, room.version);
    return 'paused';
  }

  if (bState.timer_paused_left != null) {
    const left = bState.timer_paused_left;
    const end = getGlobalTime() + left;
    bState.global_timer_end = end;
    bState.timer_paused_left = null;
    pushLog(bState, 'Ведучий запустив таймер');
    await saveRoom(roomCode, { bunker_state: bState }, room.version);

    // Відновлення таймера: залишок + 1 секунда на показ "00"
    scheduleAutoStop(roomCode, left + 1000, end);
    return 'resumed';
  }

  throw new Error('Таймер не запущено');
}
