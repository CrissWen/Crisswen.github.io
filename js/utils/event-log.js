import { supabase } from '../services/supabase.js';

// Лог подій зберігається в bunker_state.logs — масиві записів { id, t, text }:
//   id   — унікальний номер запису (за замовчуванням Date.now(); для кидка кубика збігається з latest_dice.id)
//   t    — час події (мс), показується як ГГ:ХХ
//   text — готовий текст повідомлення
// За замовчуванням масив порожній (відсутній, доки не відбулась перша подія).

export const MAX_LOGS = 100; // старші записи відкидаються, щоб база не розросталась

// Додає запис у bState.logs НА МІСЦІ (без звернення до БД) і обрізає масив до MAX_LOGS.
// Використовується діями ведучого: запис іде в тому ж UPDATE, що й сама зміна стану, тож лог не може «відстати» від дії.
export function pushLog(bState, text, id = Date.now()) {
  const clean = String(text ?? '').trim();
  if (!bState || !clean) return;
  const logs = Array.isArray(bState.logs) ? bState.logs : [];
  logs.push({ id, t: Date.now(), text: clean });
  bState.logs = logs.slice(-MAX_LOGS);
}

// Загальна функція-реєстратор для дій, які не проходять через host-actions (наприклад, гравець відкрив/приховав картку):
// читає СВІЖИЙ bunker_state, додає запис і відправляє оновлення в Supabase.
// До початку гри (порожній bunker_state) нічого не пише — інакше це «запустило» б гру передчасно.
export async function addLog(roomCode, text) {
  const { data: room, error } = await supabase
    .from('rooms').select('bunker_state').eq('room_code', roomCode).single();
  if (error || !room) throw new Error(error?.message || 'Кімнату не знайдено');

  const bState = room.bunker_state || {};
  if (Object.keys(bState).length === 0) return;

  pushLog(bState, text);
  const { error: saveError } = await supabase
    .from('rooms').update({ bunker_state: bState }).eq('room_code', roomCode);
  if (saveError) throw new Error(saveError.message || 'Не вдалося зберегти лог');
}
