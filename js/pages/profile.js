import { supabase } from '../services/supabase.js';
import { THEMES, getCurrentTheme, setTheme } from '../utils/theme-manager.js';
import { fetchAvatars, getCachedAvatar, uploadAvatar, removeAvatar } from '../services/avatar-service.js';
import { setAvatarEl } from '../utils/avatar.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function renderProfile() {
    const themeOptionsHtml = THEMES.map(t => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('');

    return `
    <section class="block layout-small-centered">
      <div class="block-head">
        <h2>Мій профіль</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 16px;">
        
        <div class="profile-avatar-row">
          <!-- Inline-стилі змінено на outline: transparent фон, border, колір тексту -->
        <!-- Велика аватарка = кнопка: при наведенні з'являється рамка з олівцем, клік відкриває вибір файла -->
        <button type="button" id="avatar-change-btn" class="profile-avatar-edit" aria-label="Змінити аватарку" title="Змінити аватарку">
          <span id="profile-page-avatar" class="profile-avatar">?</span>
          <span class="profile-avatar-overlay" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </span>
        </button>
        <div class="profile-avatar-actions">
          <button type="button" id="avatar-remove-btn" class="avatar-action avatar-action--danger" style="display: none;">Видалити</button>
          <input type="file" id="avatar-file-input" accept="image/*" hidden>
        </div>
          <div>
            <p style="margin: 0; font-size: 13px; color: var(--text-mute);">Ім'я гравця</p>
            <p id="profile-page-name" style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text);">Завантаження...</p>
            <p id="avatar-status" role="status" aria-live="polite" style="margin: 6px 0 0; font-size: 12px; min-height: 16px; color: var(--text-mute);"></p>
          </div>
        </div>

        <hr style="width: 100%; border-color: var(--metal-lt); margin: 8px 0;">

        <div>
          <p style="margin: 0 0 6px; font-size: 13px; color: var(--text-mute);">Тема інтерфейсу</p>
          <select id="theme-selector" class="hp-select" style="width: 100%;">
            ${themeOptionsHtml}
          </select>
        </div>

        <hr style="width: 100%; border-color: var(--metal-lt); margin: 8px 0;">
        
        <button id="profile-logout-btn" style="padding: 10px; border-radius: var(--radius-sm); background: var(--danger); color: #1a0806; font-weight: bold; cursor: pointer; border: none; transition: filter 0.2s ease;">
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
    const themeSelect = document.getElementById('theme-selector');

    // Тему можна перемкнути незалежно від сесії (хоча на цю сторінку і так не пускає неавторизованих —
    // перевірка нижче), тож вішаємо обробник одразу, до await supabase.auth.getSession()
    if (themeSelect) {
        themeSelect.value = getCurrentTheme();
        themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
    }

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
        avatarEl.style.paddingBottom = '9px'; // Тут зсув більший, бо аватарка велика (96px)
    } else {
        avatarEl.style.paddingBottom = '0';
    }

    // ===== Аватарка: вибір файла → стиснення → Storage → users.avatar_url (див. services/avatar-service.js) =====
    const userId = session.user.id;
    const fileInput = document.getElementById('avatar-file-input');
    const changeBtn = document.getElementById('avatar-change-btn');
    const removeBtn = document.getElementById('avatar-remove-btn');
    const avatarStatus = document.getElementById('avatar-status');
    const headerAvatarEl = document.getElementById('header-user-avatar');

    const paintAvatar = (url) => {
        setAvatarEl(avatarEl, firstLetter, url);
        setAvatarEl(headerAvatarEl, firstLetter, url);
        removeBtn.style.display = url ? '' : 'none';
    };
    const setAvatarStatus = (text, isError = false) => {
        avatarStatus.textContent = text;
        avatarStatus.style.color = isError ? 'var(--danger)' : 'var(--text-mute)';
    };
    const setAvatarBusy = (busy) => {
        changeBtn.disabled = busy;
        removeBtn.disabled = busy;
    };

    await fetchAvatars([userId]);
    paintAvatar(getCachedAvatar(userId));

    changeBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = ''; // щоб повторний вибір того самого файла теж спрацював
        if (!file) return;

        setAvatarBusy(true);
        setAvatarStatus('Завантаження...');
        try {
            const url = await uploadAvatar(userId, file);
            paintAvatar(url);
            setAvatarStatus('Аватарку оновлено');
        } catch (err) {
            setAvatarStatus(err.message || 'Не вдалося змінити аватарку', true);
        } finally {
            setAvatarBusy(false);
        }
    });

    removeBtn.addEventListener('click', async () => {
        setAvatarBusy(true);
        setAvatarStatus('');
        try {
            await removeAvatar(userId);
            paintAvatar(null);
            setAvatarStatus('Аватарку видалено');
        } catch (err) {
            setAvatarStatus(err.message || 'Не вдалося видалити аватарку', true);
        } finally {
            setAvatarBusy(false);
        }
    });

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
