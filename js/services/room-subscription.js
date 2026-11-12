import { supabase } from './supabase.js';
import { getRoomView } from './room-access.js';

export function mergeRoomState(prev, patch) {
  return { ...prev, ...patch };
}

// Realtime carries only room_code/version; card filtering always happens on the server.
export function subscribeToRoom(roomCode, onUpdate, onError = () => {}) {
  let stopped = false;
  let running = false;
  let pending = false;
  let version;
  async function refresh() {
    if (stopped) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      const room = await getRoomView(roomCode);
      if (!stopped && (room.version == null || room.version !== version)) {
        version = room.version;
        onUpdate(room);
      }
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      running = false;
      if (pending && !stopped) { pending = false; void refresh(); }
    }
  }
  const channel = supabase.channel(`room-events-${roomCode}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'room_events', filter: `room_code=eq.${roomCode}`
    }, () => { void refresh(); })
    .subscribe(() => { void refresh(); });
  // Recover missed events and reconnects without requesting unfiltered state.
  const timer = setInterval(() => { void refresh(); }, 5000);
  void refresh();
  return () => {
    stopped = true;
    clearInterval(timer);
    supabase.removeChannel(channel);
  };
}
