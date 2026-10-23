import { syncServerTime, getGlobalTime } from '../services/server-time.js';

/**
 * Отримує час із сервера Supabase та розраховує зміщення відносно локального пристрою.
 * Делегує до services/server-time.js для єдиного джерела точного серверного часу.
 */
export async function syncTime() {
  return syncServerTime();
}

/**
 * Повертає поточний "глобальний" час у мілісекундах (відповідає серверному Date.now())
 */
export { getGlobalTime };
