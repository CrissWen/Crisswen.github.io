import { supabase } from './supabase.js';

// ===== Серверний час =====
// Мітки кінця таймерів (bunker_state.global_timer_end / cataclysm_timer_end) — це абсолютні мс. Їх пише годинник ведучого,
// а читають годинники всіх гравців: якщо вони розходяться, відлік на екранах різний. Тому всі такі мітки рахуємо
// не за Date.now(), а за getGlobalTime() — локальним часом зі зміщенням відносно сервера.
//
// Потрібна RPC-функція в БД (створюється один раз у Supabase SQL Editor):
//   CREATE OR REPLACE FUNCTION get_server_time() RETURNS timestamptz LANGUAGE sql AS $$ SELECT clock_timestamp(); $$;
//   GRANT EXECUTE ON FUNCTION get_server_time() TO authenticated, anon;
// Без неї (або без мережі) getGlobalTime() просто віддає локальний час, як було раніше: гра не ламається.

const SAMPLES = 3;                      // скільки разів міряємо; беремо замір з найменшим RTT (він найточніший)
const RESYNC_AFTER_MS = 10 * 60 * 1000; // повторний syncServerTime() у межах цього часу нічого не робить

let timeOffset = 0; // серверний час мінус локальний, мс (додатний, якщо локальний годинник відстає)
let lastSyncAt = 0; // performance.now() останньої вдалої синхронізації; 0 — ще не синхронізовано

// Один замір: сервер зчитав час приблизно посередині запиту, тож локальний момент цього зчитування = початок + RTT/2
async function measureOffset() {
  const clientStart = Date.now();
  const t0 = performance.now();

  const { data, error } = await supabase.rpc('get_server_time');
  if (error) throw error;

  const rtt = performance.now() - t0;
  const serverMs = new Date(data).getTime();
  if (!Number.isFinite(serverMs)) throw new Error('get_server_time повернула некоректне значення');

  return { rtt, offset: serverMs - (clientStart + rtt / 2) };
}

// Ніколи не кидає помилку: при невдачі лишається попереднє зміщення (спочатку 0 — локальний час).
// force: true — синхронізувати навіть якщо остання синхронізація свіжа.
export async function syncServerTime({ force = false } = {}) {
  if (!force && lastSyncAt && performance.now() - lastSyncAt < RESYNC_AFTER_MS) return;

  let best = null;
  try {
    for (let i = 0; i < SAMPLES; i++) {
      const sample = await measureOffset();
      if (!best || sample.rtt < best.rtt) best = sample;
    }
  } catch (err) {
    if (err?.code === 'PGRST202') {
      console.warn('[TimeSync] У базі немає функції get_server_time — таймери йдуть за локальним годинником. Створіть її в Supabase SQL Editor.');
    } else {
      console.warn('[TimeSync] Не вдалося отримати час сервера:', err);
    }
  }

  if (best) {
    timeOffset = best.offset;
    lastSyncAt = performance.now();
  }
}

// Поточний час за годинником сервера (мс, як Date.now())
export function getGlobalTime() {
  return Date.now() + timeOffset;
}
