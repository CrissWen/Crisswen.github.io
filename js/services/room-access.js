import { supabase } from './supabase.js';

// Never fall back to raw rooms: only the server knows which cards this user may see.
export async function getRoomView(roomCode) {
  const { data, error } = await supabase.rpc('get_room_view', { p_room: roomCode });
  if (error) throw Object.assign(new Error(error.message || 'Немає доступу до кімнати'), { code: error.code });
  if (!data) throw Object.assign(new Error('Кімнату не знайдено або немає доступу'), { code: '42501' });
  return data;
}

export async function enterRoom(roomCode, name = '') {
  const { error } = await supabase.rpc('join_room', { p_room: roomCode, p_name: name });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
}

export async function listMyRooms() {
  const { data, error } = await supabase.rpc('list_my_rooms');
  if (error) throw new Error(error.message);
  return data || [];
}
