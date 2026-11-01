// Хедер сторінки тесту (survival-test.html). Розмітка хедера в HTML — копія розмітки з index.html
// (#global-header), стилі — ті самі css/header.css. Тут лише підставляємо ім'я/аватар із поточної сесії,
// так само, як це робить router() у js/app.js. Сесія лише читається — нічого не записується.
//
// Навігація «Паки» / «Гра» — як в index.html, але посилання ведуть на index.html#/..., бо ця сторінка не є частиною SPA-роутера.
// У обох файлах хедер має лишатися однаковим.
import { supabase } from '../../services/supabase.js';
import { syncGameTab } from '../../utils/game/last-session.js';
import { showUserAvatar, applyAvatarLetterPadding } from '../../utils/auth/avatar.js';
import { firstChar } from '../../utils/auth/initial.js';

const navEl = document.getElementById('header-nav');
const profileLink = document.getElementById('header-profile-link');
const nameEl = document.getElementById('header-user-name');
const avatarEl = document.getElementById('header-user-avatar');

async function initHeader() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // без сесії лишається лише логотип — профілю показувати нема що

    const username = session.user?.user_metadata?.username || 'Гравець';
    const firstLetter = firstChar(username);

    nameEl.textContent = username;
    avatarEl.textContent = firstLetter;
    applyAvatarLetterPadding(avatarEl, firstLetter, 3);
    profileLink.style.display = 'flex';
    navEl.style.display = ''; // «Паки» і «Гра»: як в index.html, лише для залогіненого
    syncGameTab(session.user.id, 'index.html'); // «Гра» з'являється, лише якщо є активна кімната
    showUserAvatar(avatarEl, session.user.id, firstLetter); // фото аватарки поверх літери
  } catch (err) {
    console.error('Не вдалося завантажити профіль для хедера:', err);
  }
}

initHeader();
