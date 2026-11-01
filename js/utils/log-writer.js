import { supabase } from '../services/supabase.js';
import { getGameConfigSync } from '../config/config-manager.js';

// Лог подій зберігається в bunker_state.logs — масиві записів { id, t, text }:
//   id   — унікальний монотонно зростаючий номер запису (для кидка кубика збігається з latest_dice.id)
//   t    — час події (мс), показується як ГГ:ХХ
//   text — готовий текст повідомлення
// За замовчуванням масив порожній (відсутній, доки не відбулась перша подія).

// Ліміт записів — maxLogEntries з конфігу балансу (js/config/game-config.base.js); старші записи відкидаються, щоб база не розросталась

let lastGeneratedId = 0;

// Гарантує строго монотонно зростаючий id навіть коли дві події (або setHostEvent + pushLog)
// відбуваються в межах однієї мілісекунди (виправляє I5).
export function nextEventId() {
  const now = Date.now();
  lastGeneratedId = now > lastGeneratedId ? now : lastGeneratedId + 1;
  return lastGeneratedId;
}

// Додає запис у bState.logs НА МІСЦІ (без звернення до БД) і обрізає масив до maxLogEntries.
// Використовується діями ведучого: запис іде в тому ж UPDATE, що й сама зміна стану, тож лог не може «відстати» від дії.
export function pushLog(bState, text, id) {
  const clean = String(text ?? '').trim();
  if (!bState || !clean) return;
  const logs = Array.isArray(bState.logs) ? bState.logs : [];
  const lastLogId = logs.length > 0 ? Number(logs[logs.length - 1]?.id) || 0 : 0;
  const safeId = id !== undefined && id !== null ? id : Math.max(nextEventId(), lastLogId + 1);
  logs.push({ id: safeId, t: Date.now(), text: clean });
  bState.logs = logs.slice(-getGameConfigSync().maxLogEntries);
}

// Атомарно додає запис у лог кімнати на сервері через SECURITY DEFINER RPC append_log(p_room, p_text, p_max).
// До початку гри (порожній bunker_state) RPC нічого не пише — інакше це «запустило» б гру передчасно.
export async function addLog(roomCode, text) {
  const clean = String(text ?? '').trim();
  if (!clean) return;
  const { error } = await supabase.rpc('append_log', {
    p_room: roomCode,
    p_text: clean,
    p_max: getGameConfigSync().maxLogEntries
  });
  if (error) throw new Error(error.message || 'Не вдалося зберегти лог');
}
