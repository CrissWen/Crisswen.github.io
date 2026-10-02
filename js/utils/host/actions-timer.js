import { pushLog } from '../log-writer.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { getGlobalTime } from '../time-sync.js';

// ===== Глобальний таймер ведучого =====
// Кнопки таймера НІКОЛИ не пишуть latest_host_event — таймер працює автономно і не повинен спамити Toast'ами.
// У «Лог подій» вони пишуть напряму через pushLog (без Toast).

// 15 -> "15 с", 60 -> "1 хв", 90 -> "1 хв 30 с"
function formatTimerSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return [m ? `${m} хв` : '', s ? `${s} с` : ''].filter(Boolean).join(' ');
}

export async function setGlobalTimer(roomCode, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Некоректний час таймера');
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  bState.global_timer_seconds = seconds;
  bState.global_timer_end = getGlobalTime() + seconds * 1000;
  bState.timer_paused_left = null; // новий запуск скасовує попередню паузу, якщо вона була
  pushLog(bState, `Ведучий запустив таймер на ${formatTimerSeconds(seconds)}`); // лише запис у лог, без latest_host_event (без Toast)
  await saveRoom(roomCode, { bunker_state: bState });
}

// Повністю зупиняє таймер (ховає віджет): і активний відлік, і збережену паузу.
export async function stopGlobalTimer(roomCode, isAuto = false) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  bState.global_timer_end = null;
  bState.timer_paused_left = null;
  pushLog(bState, isAuto ? 'Час таймера вийшов' : 'Ведучий зупинив таймер');
  await saveRoom(roomCode, { bunker_state: bState });
}

// Перемикач паузи: якщо таймер іде — заморожує залишок у timer_paused_left;
// якщо вже на паузі — відновлює відлік від збереженого залишку.
// Повертає 'paused' або 'resumed', щоб UI показав відповідний тост.
export async function pauseGlobalTimer(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};

  if (bState.global_timer_end) {
    const left = Math.max(0, bState.global_timer_end - getGlobalTime());
    bState.timer_paused_left = left;
    bState.global_timer_end = null;
    pushLog(bState, 'Ведучий призупинив таймер');
    await saveRoom(roomCode, { bunker_state: bState });
    return 'paused';
  }

  if (bState.timer_paused_left != null) {
    bState.global_timer_end = getGlobalTime() + bState.timer_paused_left;
    bState.timer_paused_left = null;
    pushLog(bState, 'Ведучий запустив таймер');
    await saveRoom(roomCode, { bunker_state: bState });
    return 'resumed';
  }

  throw new Error('Таймер не запущено');
}
