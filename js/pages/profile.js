import { supabase } from '../services/supabase.js';

export function renderProfile() {
    return `
    <section class="block layout-small-centered">
      <div class="block-head">
        <h2>Мій профіль</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 16px;">
        
        <div style="display: flex; align-items: center; gap: 12px;">
          <!-- Inline-стилі змінено на outline: transparent фон, border, колір тексту -->
        <div id="profile-page-avatar" style="width: 48px; height: 48px; border-radius: 50%; background: transparent; border: 2px solid var(--text-mute); color: var(--text-mute); font-family: var(--mono); display: flex; align-items: center; justify-content: center; font-size: 24px; padding-bottom: 5px;">
            ?
        </div>
          <div>
            <p style="margin: 0; font-size: 13px; color: var(--text-mute);">Ім'я гравця</p>
            <p id="profile-page-name" style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text);">Завантаження...</p>
          </div>
        </div>

        <hr style="width: 100%; border-color: var(--metal-lt); margin: 8px 0;">
        
        <button id="profile-logout-btn" style="padding: 10px; border-radius: 6px; background: var(--danger); color: #1a0806; font-weight: bold; cursor: pointer; border: none; transition: filter 0.2s ease;">
          Вийти з акаунта
        </button>
      </div>
    </section>
  `;
}

export async function initProfile() {
    const nameEl = document.getElementById('profile-page-name');
    const avatarEl = document.getElementById('profile-page-avatar');
    const logoutBtn = document.getElementById('profile-logout-btn');

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.hash = '#/login';
        return;
    }

    const username = session.user?.user_metadata?.username || 'Гравець';
    nameEl.textContent = username;

    const firstLetter = username.charAt(0);
    avatarEl.textContent = firstLetter;

    if (/^[gjpqyуфщц]/i.test(firstLetter)) {
        avatarEl.style.paddingBottom = '5px'; // Тут зсув трохи більший, бо аватарка 48px
    } else {
        avatarEl.style.paddingBottom = '0';
    }

    logoutBtn.addEventListener('mouseover', () => logoutBtn.style.filter = 'brightness(1.1)');
    logoutBtn.addEventListener('mouseout', () => logoutBtn.style.filter = 'none');

    logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'Вихід...';
        try {
            await supabase.auth.signOut();
            window.location.hash = '#/login';
        } catch (err) {
            console.error('Помилка виходу:', err);
            logoutBtn.disabled = false;
            logoutBtn.textContent = 'Вийти з акаунта';
        }
    });
}