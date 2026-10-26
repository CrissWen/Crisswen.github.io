import { supabase } from './supabase.js';

const STORAGE_PREFIX = 'bunker_user_history:';
const MAX_HISTORY_ITEMS = 5;
const CACHE_TTL_MS = 60 * 1000; // 1 хвилина

function getStorageKey(userId) {
  return `${STORAGE_PREFIX}${userId}`;
}

/**
 * Читає локально збережену історію для миттєвого відображення (0 мс).
 * @param {string} userId
 * @returns {Array|null}
 */
export function getCachedUserHistory(userId) {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch (e) {
    return null;
  }
}

/**
 * Зберігає знімок історії в локальному сховищі.
 * @param {string} userId
 * @param {Array} items
 */
function saveHistoryCache(userId, items) {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify({
      ts: Date.now(),
      items: (items || []).slice(0, MAX_HISTORY_ITEMS)
    }));
  } catch (e) {
    // ігноруємо помилки квоти localStorage
  }
}

/**
 * Завантажує останні 5 ігор користувача.
 * Викликається ВИКЛЮЧНО коли користувач переходить на вкладку «Історія ігор».
 * @param {string} userId
 * @param {object} options
 * @returns {Promise<Array>}
 */
export async function fetchUserGameHistory(userId, { force = false } = {}) {
  if (!userId) return [];

  // Перевірка свіжості локального кешу
  if (!force && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(getStorageKey(userId));
      if (raw) {
        const { ts, items } = JSON.parse(raw);
        if (Array.isArray(items) && (Date.now() - (ts || 0) < CACHE_TTL_MS)) {
          return items;
        }
      }
    } catch (e) {
      // при помилці парсингу йдемо в мережу
    }
  }

  try {
    const { data, error } = await supabase
      .from('user_game_history')
      .select('id, room_code, cataclysm_title, profession_title, survived, played_at')
      .eq('user_id', userId)
      .order('played_at', { ascending: false })
      .limit(MAX_HISTORY_ITEMS);

    if (error) {
      console.warn('Не вдалося завантажити історію ігор:', error);
      // Якщо в мережі збій, повертаємо те, що є в кеші
      return getCachedUserHistory(userId) || [];
    }

    const items = data || [];
    saveHistoryCache(userId, items);
    return items;
  } catch (err) {
    console.error('Помилка запиту історії:', err);
    return getCachedUserHistory(userId) || [];
  }
}

/**
 * Перевіряє, чи кімната досі існує в базі даних (не видалена за часом).
 * @param {string} roomCode
 * @returns {Promise<boolean>}
 */
export async function checkRoomExists(roomCode) {
  if (!roomCode) return false;
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('room_code')
      .eq('room_code', roomCode.toUpperCase())
      .maybeSingle();

    return !error && !!data;
  } catch (err) {
    return false;
  }
}

/**
 * Завантажує повні дані кімнати для збереження у локальний файл реплею (.bunker).
 * @param {string} roomCode
 * @returns {Promise<object|null>}
 */
export async function fetchRoomDataForExport(roomCode) {
  if (!roomCode) return null;
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_code', roomCode.toUpperCase())
      .maybeSingle();

    if (error || !data) return null;
    return data;
  } catch (err) {
    console.error('Не вдалося отримати дані кімнати для експорту:', err);
    return null;
  }
}

