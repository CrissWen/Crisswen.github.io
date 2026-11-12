import { supabase } from './supabase.js';

// ===== Підписка на зміни кімнати (Supabase Realtime) =====
// Лише транспорт: відкриває канал і віддає нові дані колбеку. Що робити з оновленням (тости, кубик, перемальовування) —
// вирішує сторінка гри (pages/game.js).

// Зливає зміни поверх попереднього стану кімнати замість повної заміни.
// Supabase Realtime у payload.new НЕ передає великі (TOAST) jsonb-колонки, які не змінювались в цьому UPDATE.
// Тому таймер/голосування (міняють лише bunker_state) приходили б без players_state, і характеристики зникали б.
export function mergeRoomState(prev, patch) {
  return { ...prev, ...patch };
}

// Підписується на UPDATE рядка rooms з цим room_code. onUpdate отримує payload.new (можливо, неповний — див. mergeRoomState).
// Повертає функцію відписки.
export function subscribeToRoom(roomCode, onUpdate) {
  const channel = supabase
    .channel(`room-${roomCode}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'rooms',
      filter: `room_code=eq.${roomCode}`
    }, payload => onUpdate(payload.new))
    .subscribe();

  return () => supabase.removeChannel(channel);
}
