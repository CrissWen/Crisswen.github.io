import { supabase } from '../../services/supabase.js';
import { pushLog } from '../log-writer.js';
import { isCataclysmSpinActive } from '../cataclysm-spin.js';
import { getGlobalTime } from '../../services/server-time.js';

// ===== Доступ до кімнати в БД + знімок для «Скасувати» =====
// lastSnapshot — стан модуля: живе лише тут, інші модулі працюють через snapshot() / clearSnapshot().

let lastSnapshot = null; // { room_code, players_state, bunker_state } — host_id свідомо не зберігаємо: «Скасувати» не змінює ведучого

export async function getRoom(roomCode) {
  const { data, error } = await supabase.from('rooms').select('*').eq('room_code', roomCode).single();
  if (error || !data) throw new Error(error?.message || 'Кімнату не знайдено');
  return data;
}

// Єдина точка запису: UPDATE у БД з опціональною CAS-перевіркою expectedVersion (оптимістичне блокування).
// Помилки (наприклад, RLS або VERSION_CONFLICT) не ковтаються, а піднімаються до UI / withRoomAction.
export async function saveRoom(roomCode, patch, expectedVersion = null) {
  let query = supabase.from('rooms').update(patch).eq('room_code', roomCode);
  if (typeof expectedVersion === 'number') {
    const { data, error } = await query.eq('version', expectedVersion).select('version');
    if (error) throw new Error(error.message || 'Не вдалося зберегти зміни');
    if (!data || data.length === 0) {
      const conflictErr = new Error('Стан кімнати щойно оновився. Спробуйте ще раз.');
      conflictErr.code = 'VERSION_CONFLICT';
      throw conflictErr;
    }
    return data[0];
  }
  const { error } = await query;
  if (error) throw new Error(error.message || 'Не вдалося зберегти зміни');
  return null;
}

// Виконує дію ведучого з автоматичним CAS-повтором при конкурентному оновленні рядка кімнати (напр. голос або лог гравця).
export async function withRoomAction(roomCode, mutator, { takeSnapshot = true, maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const room = await getRoom(roomCode);
    const preRoom = takeSnapshot ? structuredClone(room) : null;
    const patch = await mutator(room);
    if (!patch) return null;
    try {
      const expectedVersion = typeof room.version === 'number' ? room.version : null;
      const res = await saveRoom(roomCode, patch, expectedVersion);
      if (takeSnapshot && preRoom) snapshot(preRoom);
      return res;
    } catch (err) {
      if (err?.code === 'VERSION_CONFLICT' && attempt < maxRetries - 1) continue;
      throw err;
    }
  }
  return null;
}

export function snapshot(room) {
  lastSnapshot = {
    room_code: room.room_code,
    players_state: JSON.parse(JSON.stringify(room.players_state || {})),
    bunker_state: JSON.parse(JSON.stringify(room.bunker_state || {}))
  };
}

// Скидає знімок (закриття кімнати: скасовувати вже нічого)
export function clearSnapshot() {
  lastSnapshot = null;
}

export function canUndo() {
  return !!lastSnapshot;
}

export async function undoLastAction(roomCode) {
  if (!lastSnapshot || lastSnapshot.room_code !== roomCode) {
    throw new Error('Немає дії для скасування');
  }
  const room = await getRoom(roomCode);
  // Відкат посеред рулетки підмінив би катаклізм, поки стрічка ще крутиться до іншого результату
  if (isCataclysmSpinActive(room.bunker_state, getGlobalTime())) {
    throw new Error('Рулетка катаклізму ще крутиться — дочекайтесь результату');
  }
  const restoredPState = JSON.parse(JSON.stringify(lastSnapshot.players_state || {}));
  const bunker_state = JSON.parse(JSON.stringify(lastSnapshot.bunker_state || {}));

  // Переносимо стан відкритості карток та використання здібностей з поточного стану,
  // щоб "Скасувати" не закривало те, що гравці встигли відкрити або використати
  const currentPState = room.players_state || {};
  for (const pid in currentPState) {
    if (!restoredPState[pid]) continue;
    for (const charKey in currentPState[pid]) {
      const currVal = currentPState[pid][charKey];
      const restVal = restoredPState[pid][charKey];
      if (!currVal || !restVal) continue;

      if (Array.isArray(currVal) && Array.isArray(restVal)) {
        for (let i = 0; i < currVal.length; i++) {
          if (restVal[i] && currVal[i]) {
            if ('is_revealed' in currVal[i]) restVal[i].is_revealed = currVal[i].is_revealed;
            if ('is_used' in currVal[i]) restVal[i].is_used = currVal[i].is_used;
          }
        }
      } else if (typeof currVal === 'object' && typeof restVal === 'object') {
        if ('is_revealed' in currVal) restVal.is_revealed = currVal.is_revealed;
        if ('is_used' in currVal) restVal.is_used = currVal.is_used;
      }
    }
  }

  // Знімок старший за дії, що були після нього, тому з поточного стану переносимо те, що не належить скасованій дії:
  // лог (він — історія, тож скасована дія і сам запис про скасування лишаються в ньому) і latest_dice
  // (інакше повернувся б старий id кидка, і в усіх гравців заново програвся б попередній кидок).
  const current = room.bunker_state || {};
  const restored = { ...bunker_state };
  if (Array.isArray(current.logs)) restored.logs = current.logs;
  if (current.latest_dice) restored.latest_dice = current.latest_dice;
  // Якщо під час дії, що скасовується, вже тривало голосування і гравці встигли проголосувати (або воно автозавершилось),
  // зберігаємо актуальні голоси замість відкату до порожнього списку голосів на момент snapshot (I3).
  if (restored.voting?.isActive && current.voting) {
    restored.voting = current.voting;
  }
  // cataclysm_spin — той самий випадок: зі знімка повернувся б старий спін з іншим id, і рулетка програлась би вдруге
  if (current.cataclysm_spin) restored.cataclysm_spin = current.cataclysm_spin;
  else delete restored.cataclysm_spin;
  pushLog(restored, 'Ведучий скасував попередню дію');
  // host_id в патчі немає навмисно: скасування не повертає колишнього ведучого, навіть якщо застарілий знімок якось уцілів
  const expectedVersion = typeof room.version === 'number' ? room.version : null;
  await saveRoom(roomCode, { players_state: restoredPState, bunker_state: restored }, expectedVersion);
  lastSnapshot = null;
}
