// Хедер сторінки тесту (survival-test.html). Розмітка хедера в HTML — копія розмітки з index.html
// (#global-header), стилі — ті самі css/header.css. Тут лише підставляємо ім'я/аватар із поточної сесії,
// так само, як це робить router() у js/app.js. Сесія лише читається — нічого не записується.
//
// ПІСЛЯ МЕРДЖУ РЕДАКТОРА ПАКІВ: кнопку/посилання на паки в index.html додати і в хедер survival-test.html —
// у обох файлах хедер має лишатися однаковим (за потреби посилання треба вести на index.html#/..., бо
// ця сторінка не є частиною SPA-роутера).
import { supabase } from '../services/supabase.js';

const profileLink = document.getElementById('header-profile-link');
const nameEl = document.getElementById('header-user-name');
const avatarEl = document.getElementById('header-user-avatar');

async function initHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // без сесії лишається лише логотип — профілю показувати нема що

    const username = session.user?.user_metadata?.username || 'Гравець';
    const firstLetter = username.charAt(0);

    nameEl.textContent = username;
    avatarEl.textContent = firstLetter;
    avatarEl.style.paddingBottom = /^[gjpqyуфщц]/i.test(firstLetter) ? '3px' : '0'; // як в app.js
    profileLink.style.display = 'flex';
  } catch (err) {
    console.error('Не вдалося завантажити профіль для хедера:', err);
  }
}

initHeader();
