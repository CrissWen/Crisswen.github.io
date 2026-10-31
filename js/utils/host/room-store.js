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

// Єдина точка запису: UPDATE у БД, а WebSocket (postgres_changes) розішле зміни всім.
// Помилки (наприклад, RLS) більше не ковтаються, а піднімаються до UI.
export async function saveRoom(roomCode, patch) {
  const { error } = await supabase.from('rooms').update(patch).eq('room_code', roomCode);
  if (error) throw new Error(error.message || 'Не вдалося зберегти зміни');
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
  const { players_state: restoredPState, bunker_state } = lastSnapshot;

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
  // cataclysm_spin — той самий випадок: зі знімка повернувся б старий спін з іншим id, і рулетка програлась би вдруге
  if (current.cataclysm_spin) restored.cataclysm_spin = current.cataclysm_spin;
  else delete restored.cataclysm_spin;
  pushLog(restored, 'Ведучий скасував попередню дію');
  // host_id в патчі немає навмисно: скасування не повертає колишнього ведучого, навіть якщо застарілий знімок якось уцілів
  await saveRoom(roomCode, { players_state: restoredPState, bunker_state: restored });
  lastSnapshot = null;
}
