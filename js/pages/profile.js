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
    const themeCardsHtml = THEMES.map(t => `
      <label class="theme-card" for="theme-radio-${esc(t.value)}">
        <input
          type="radio"
          name="bunker-theme"
          id="theme-radio-${esc(t.value)}"
          value="${esc(t.value)}"
          class="theme-radio-input"
        >
        <div class="theme-card-body">
          <div class="theme-card-info">
            <span class="theme-card-name">${esc(t.name || t.label)}</span>
            ${t.tag ? `<span class="theme-card-tag">${esc(t.tag)}</span>` : ''}
          </div>
          <div class="theme-palette-swatch" aria-hidden="true">
            ${(t.palette || []).map(c => `<span class="theme-dot" style="background-color: ${esc(c)};"></span>`).join('')}
          </div>
        </div>
        <span class="theme-card-check" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </span>
      </label>
    `).join('');

    return `
    <section class="block layout-small-centered profile-block">
      <div class="block-head">
        <h2>Мій профіль</h2>
      </div>
      <nav class="profile-tabs" role="tablist" aria-label="Розділи профілю">
        <button type="button" role="tab" class="profile-tab" id="profile-tab-profile" data-tab="profile" aria-controls="profile-panel-profile">Профіль</button>
        <button type="button" role="tab" class="profile-tab" id="profile-tab-stats" data-tab="stats" aria-controls="profile-panel-stats">Статистика</button>
        <button type="button" role="tab" class="profile-tab" id="profile-tab-history" data-tab="history" aria-controls="profile-panel-history">Історія ігор</button>
      </nav>
      <div class="block-body">
      <div class="profile-panel" id="profile-panel-profile" role="tabpanel" aria-labelledby="profile-tab-profile">
        
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

        <fieldset class="theme-picker-group">
          <legend class="theme-picker-legend">Тема інтерфейсу</legend>
          <div class="theme-picker-grid" role="radiogroup" aria-label="Вибір теми інтерфейсу">
            ${themeCardsHtml}
          </div>
        </fieldset>

        <hr style="width: 100%; border-color: var(--metal-lt); margin: 8px 0;">
        
        <button id="profile-logout-btn" style="padding: 10px; border-radius: var(--radius-sm); background: var(--danger); color: #1a0806; font-weight: bold; cursor: pointer; border: none; transition: filter 0.2s ease;">
          Вийти з акаунта
        </button>
      </div>

      <!-- Заготовка: цифри підключимо, коли буде завершення гри та лічильники в БД (data-stat — ключ для підстановки) -->
      <div class="profile-panel" id="profile-panel-stats" role="tabpanel" aria-labelledby="profile-tab-stats" hidden>
        <div class="stat-grid">
          <div class="stat-tile"><span class="stat-tile__label">Зіграно ігор</span><span class="stat-tile__value" data-stat="games_played">—</span></div>
          <div class="stat-tile"><span class="stat-tile__label">Перемог</span><span class="stat-tile__value" data-stat="games_won">—</span></div>
          <div class="stat-tile"><span class="stat-tile__label">Відсоток перемог</span><span class="stat-tile__value" data-stat="win_rate">—</span></div>
          <div class="stat-tile"><span class="stat-tile__label">Проведено як ведучий</span><span class="stat-tile__value" data-stat="games_hosted">—</span></div>
        </div>
        <p class="profile-placeholder-note">Статистика з'явиться після ваших перших завершених ігор.</p>
      </div>

      <div class="profile-panel" id="profile-panel-history" role="tabpanel" aria-labelledby="profile-tab-history" hidden>
        <div class="profile-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
          <p class="profile-empty__title">Ігор поки немає</p>
          <p class="profile-empty__text">Тут з'явиться список ваших завершених ігор з результатами.</p>
        </div>
      </div>
      </div>
    </section>
  `;
}

// ===== Вкладки профілю =====
// Активна вкладка запам'ятовується на час вкладки браузера (sessionStorage), а не в URL: зміна hash перемалювала би
// всю сторінку через роутер і скидала би стан.
const TAB_STORAGE_KEY = 'bunker-profile-tab';
const TAB_NAMES = ['profile', 'stats', 'history'];

function setupProfileTabs() {
    const tabs = [...document.querySelectorAll('.profile-tab')];
    if (!tabs.length) return;

    const select = (name, focus = false) => {
        tabs.forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1; // стрілками перемикаємо, Tab переходить у вміст панелі
            const panel = document.getElementById(tab.getAttribute('aria-controls'));
            if (panel) panel.hidden = !active;
            if (active && focus) tab.focus();
        });
        try {
            sessionStorage.setItem(TAB_STORAGE_KEY, name);
        } catch (e) { /* sessionStorage недоступний — просто не запам'ятовуємо вкладку */ }
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab.dataset.tab));
        tab.addEventListener('keydown', (e) => {
            let target = null;
            if (e.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
            else if (e.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') target = tabs[0];
            else if (e.key === 'End') target = tabs[tabs.length - 1];
            if (!target) return;
            e.preventDefault();
            select(target.dataset.tab, true);
        });
    });

    let initial = 'profile';
    try {
        const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
        if (TAB_NAMES.includes(saved)) initial = saved;
    } catch (e) { /* лишаємося на «Профілі» */ }
    select(initial);
}

export async function initProfile() {
    // Вкладки працюють одразу, без очікування сесії та запитів до БД
    setupProfileTabs();

    const nameEl = document.getElementById('profile-page-name');
    const avatarEl = document.getElementById('profile-page-avatar');
    const logoutBtn = document.getElementById('profile-logout-btn');
    const themeCards = document.querySelectorAll('.theme-card');
    const themeRadios = document.querySelectorAll('input[name="bunker-theme"]');

    function updateSelectedCard(selectedVal) {
        themeCards.forEach(card => {
            const input = card.querySelector('input[name="bunker-theme"]');
            const isMatch = input && input.value === selectedVal;
            if (input) input.checked = isMatch;
            card.classList.toggle('theme-card--selected', isMatch);
        });
    }

    // Тему можна перемкнути незалежно від сесії (хоча на цю сторінку і так не пускає неавторизованих —
    // перевірка нижче), тож ініціалізуємо одразу, до await supabase.auth.getSession()
    updateSelectedCard(getCurrentTheme());

    themeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                updateSelectedCard(radio.value);
                setTheme(radio.value);
            }
        });
    });

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
