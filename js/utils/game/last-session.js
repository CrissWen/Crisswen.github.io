import { supabase } from '../../services/supabase.js';

// ===== «Остання активна сесія» для вкладки «Гра» в хедері =====
// Код останньої кімнати, в яку гравець заходив на сторінці гри, зберігається в localStorage ПЕР-КОРИСТУВАЧА
// (ключ містить user id — щоб при зміні акаунта на одному браузері не підхопити чужу кімнату).
// Вкладка видима, лише поки ця кімната існує, не закрита і гра в ній не завершена (status finished); інакше вона прихована.

const KEY_PREFIX = 'bunker-last-room:';
let syncToken = 0; // відсікає застарілі відповіді БД, якщо під час запиту гравець уже перейшов далі

function storageKey(userId) {
  return KEY_PREFIX + userId;
}

export function getLastRoom(userId) {
  if (!userId) return null;
  try {
    return localStorage.getItem(storageKey(userId)) || null;
  } catch (e) {
    return null; // localStorage недоступний (приватний режим тощо)
  }
}

// Оновлює вкладку: code є → показуємо посилання на кімнату; немає → ховаємо вкладку.
// base — префікс href для сторінок поза SPA (survival-test.html передає 'index.html')
export function applyGameTab(code, base = '') {
  const link = document.getElementById('header-game-link');
  if (!link) return;

  if (code) {
    link.setAttribute('href', base + '#/game?room=' + encodeURIComponent(code));
    link.title = 'Повернутися до кімнати ' + code;
    link.hidden = false;
  } else {
    link.removeAttribute('href');
    link.removeAttribute('title');
    link.hidden = true;
  }
}

export function setLastRoom(userId, code) {
  if (!userId || !code) return;
  try {
    localStorage.setItem(storageKey(userId), code);
  } catch (e) { /* не критично: вкладка просто не запам'ятає кімнату */ }
  syncToken++; // будь-яка відповідь БД, що вже летить, застаріла
  applyGameTab(code);
}

export function clearLastRoom(userId) {
  if (userId) {
    try {
      localStorage.removeItem(storageKey(userId));
    } catch (e) { /* ігноруємо */ }
  }
  syncToken++;
  applyGameTab(null);
}

// Викликається роутером на кожній навігації: одразу показує стан за localStorage (без миготіння),
// потім перевіряє в БД, що кімната досі існує і не закрита. Помилка мережі стан не міняє —
// ховати вкладку лише через збій з'єднання ми не стаємо.
export async function syncGameTab(userId, base = '') {
  const code = getLastRoom(userId);
  applyGameTab(code, base);
  if (!code) return;

  const token = ++syncToken;
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('room_code, status, room_closed:bunker_state->room_closed')
      .eq('room_code', code)
      .maybeSingle();

    if (error) throw error;
    if (token !== syncToken) return;

    const isActive = data && data.status !== 'closed' && data.status !== 'finished' && data.room_closed !== true; // завершена гра теж не «активна»
    if (!isActive) clearLastRoom(userId);
  } catch (err) {
    console.error('Не вдалося перевірити останню сесію:', err);
  }
}
