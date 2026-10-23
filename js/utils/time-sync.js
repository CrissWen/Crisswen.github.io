import { supabase } from '../services/supabase.js';

let timeOffset = 0;
let isSynced = false;

/**
 * Отримує час із сервера Supabase та розраховує зміщення відносно локального пристрою.
 * Зміщення — це різниця між серверним і локальним часом, що дозволяє нам 
 * дізнатися поточний глобальний час на будь-якому пристрої, не роблячи зайвих запитів.
 */
export async function syncTime() {
  if (isSynced) return;
  
  try {
    const { data, error } = await supabase.rpc('get_server_time');
    if (error) throw error;
    
    // RPC повертає ISO 8601 рядок, наприклад '2023-10-02T12:00:00Z'
    const serverTime = new Date(data).getTime();
    const localTime = Date.now();
    timeOffset = serverTime - localTime;
    isSynced = true;
    
    console.log('[TimeSync] Час синхронізовано. Зміщення:', timeOffset, 'мс');
  } catch (err) {
    console.warn('[TimeSync] Не вдалося синхронізувати час сервера. Використовується локальний час.', err);
    timeOffset = 0; // fallback на локальний час, якщо RPC недоступна
  }
}

/**
 * Повертає поточний "глобальний" час у мілісекундах (відповідає серверному Date.now())
 */
export function getGlobalTime() {
  return Date.now() + timeOffset;
}
