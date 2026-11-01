import { supabase } from './services/supabase.js';
import { renderAuth, initAuth } from './pages/auth.js';
import { renderLobby, initLobby } from './pages/lobby.js';
import { renderGame, initGame, cleanupGame } from './pages/game.js';
import { renderProfile, initProfile, cleanupProfile, selectProfileTab } from './pages/profile.js'; // Підключаємо сторінку профілю
import { renderPacks, initPacks, cleanupPacks } from './pages/packs.js';
import { renderPackEditor, initPackEditor, cleanupPackEditor } from './pack-editor/editor.js';
import { applyStoredTheme } from './utils/theme-manager.js';
import { syncGameTab } from './utils/last-session.js';
import { showUserAvatar, setAvatarEl, applyAvatarLetterPadding } from './utils/avatar.js';
import { subscribeToUserAvatar, unsubscribeUserAvatar, onAvatarChange } from './services/avatar-service.js';
import { initCustomSelects } from './ui/custom-select.js';
import { initRangeSliders, setRangeSliderValue } from './ui/range-slider.js';
import { soundManager } from './services/sound-manager.js';
import { firstChar } from './utils/initial.js';

// Підстраховує inline-скрипт у <head> index.html (той лише запобігає миготінню дефолтної теми
// до завантаження цього модуля) — викликається один раз при старті, не всередині router().
applyStoredTheme();
soundManager.init();
initRangeSliders(document);

const appContainer = document.getElementById("app");
const globalHeader = document.getElementById("global-header");
const headerUserName = document.getElementById("header-user-name");
const headerUserAvatar = document.getElementById("header-user-avatar");

// --- Ініціалізація швидкого керування звуком у хедері ---
(function initHeaderAudioWidget() {
  const widget = document.getElementById('header-audio-widget');
  const muteBtn = document.getElementById('header-audio-btn');
  const slider = document.getElementById('header-audio-master-slider');
  const valEl = document.getElementById('header-audio-master-val');
  const openSettingsBtn = document.getElementById('header-audio-open-settings');

  const syncHeaderAudioUI = (settings) => {
    const pct = Math.round(settings.masterVolume * 100);
    const isMuted = settings.muted || pct === 0;
    if (muteBtn) {
      muteBtn.classList.toggle('is-muted', isMuted);
      muteBtn.title = settings.muted ? 'Звук вимкнено (клік — увімкнути)' : `Гучність: ${pct}% (клік — вимкнути)`;
    }
    if (slider) {
      slider.classList.toggle('is-muted', isMuted);
      setRangeSliderValue(slider, pct);
    }
    if (valEl) {
      valEl.textContent = settings.muted ? 'MUTE' : `${pct}%`;
    }
  };

  syncHeaderAudioUI(soundManager.getSettings());
  soundManager.subscribe(syncHeaderAudioUI);

  if (muteBtn) {
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      soundManager.toggleMute();
    });
  }

  if (slider) {
    slider.addEventListener('input', () => {
      const pct = Number(slider.value) || 0;
      soundManager.setMasterVolume(pct / 100);
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () => {
      if (widget) widget.classList.remove('is-open');
      try {
        sessionStorage.setItem('bunker-profile-tab', 'audio');
      } catch (_) {}
      const currentPath = (window.location.hash || '').split('?')[0];
      if (currentPath === '#/profile') {
        selectProfileTab('audio', true);
      } else {
        window.location.hash = '#/profile';
      }
    });
  }
})();

// Автоматичне оновлення аватарки в хедері при надходженні Realtime-події
onAvatarChange((newUrl) => {
  if (headerUserAvatar && headerUserName) {
    const letter = firstChar(headerUserName.textContent.trim()) || '?';
    setAvatarEl(headerUserAvatar, letter, newUrl);
  }
});

// Додаємо новий роут
const routes = {
  '#/login': { render: renderAuth, init: initAuth, cleanup: null },
  '#/lobby': { render: renderLobby, init: initLobby, cleanup: null },
  '#/game': { render: renderGame, init: initGame, cleanup: cleanupGame },
  '#/profile': { render: renderProfile, init: initProfile, cleanup: cleanupProfile },
  '#/packs': { render: renderPacks, init: initPacks, cleanup: cleanupPacks },
  '#/pack-editor': { render: renderPackEditor, init: initPackEditor, cleanup: cleanupPackEditor },
};

// Маршрути, доступні лише авторизованим (інакше редірект на логін)
const PROTECTED_ROUTES = ['#/lobby', '#/game', '#/profile', '#/packs', '#/pack-editor'];

let currentRouteObj = null;

async function router() {
  const { data: { session } } = await supabase.auth.getSession();

  const fullHash = window.location.hash || '#/login';
  const path = fullHash.split('?')[0];
  const queryString = fullHash.split('?')[1] || '';
  const joinCode = new URLSearchParams(queryString).get('join');

  // Синхронізуємо час із сервером один раз, коли користувач залогінений
  if (session) {
    import('./utils/time-sync.js').then(({ syncTime }) => syncTime());
  }

  // --- ЛОГІКА ХЕДЕРА ---
  if (session && path !== '#/login') {
    globalHeader.style.display = 'flex';
    const username = session.user?.user_metadata?.username || 'Гравець';

    // Вставляємо ім'я
    headerUserName.textContent = username;

    // Вкладка «Гра»: веде до останньої активної кімнати або сіра, якщо такої немає (без await — не гальмуємо рендер сторінки)
    syncGameTab(session.user.id);

    const firstLetter = firstChar(username);
    headerUserAvatar.textContent = firstLetter;

    applyAvatarLetterPadding(headerUserAvatar, firstLetter, 3);

    // Фото аватарки поверх літери (з кешу одразу, а якщо його ще немає — після одного запиту до БД)
    showUserAvatar(headerUserAvatar, session.user.id, firstLetter);

    // Підписка на зміну аватарки в реальному часі (якщо гравець замінить її на іншому пристрої)
    subscribeToUserAvatar(session.user.id);
  } else {
    globalHeader.style.display = 'none';
    if (!session) unsubscribeUserAvatar();
  }

  // Підсвітка активного пункту навігації (редактор пака — частина розділу «Паки»)
  const navPath = path === '#/pack-editor' ? '#/packs' : path;
  document.querySelectorAll('.header-nav-link').forEach(link => {
    link.classList.toggle('is-active', link.dataset.navPath === navPath);
  });

  // Роутинг
  if (session && !window.location.hash) {
    window.location.hash = '#/lobby';
    return;
  }

  if (session && path === '#/login' && joinCode) {
    window.location.hash = `#/lobby?join=${joinCode}`;
    return;
  }

  // Захищені маршрути (див. PROTECTED_ROUTES)
  if (!session && PROTECTED_ROUTES.includes(path)) {
    window.location.hash = joinCode ? `#/login?join=${joinCode}` : '#/login';
    return;
  }

  const route = routes[path] || routes['#/login'];

  if (currentRouteObj && currentRouteObj.cleanup) {
    currentRouteObj.cleanup();
  }

  currentRouteObj = route;
  appContainer.innerHTML = route.render();
  if (route.init) route.init();
  initCustomSelects(appContainer);
  initRangeSliders(appContainer);
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);
// Повторне натискання на профіль у шапці: якщо гравець уже на сторінці профілю,
// повертає його на першу вкладку «Профіль»
document.addEventListener('click', (e) => {
  const profileLink = e.target.closest('.header-profile-link, a[href="#/profile"]');
  if (profileLink) {
    const currentPath = (window.location.hash || '').split('?')[0];
    if (currentPath === '#/profile') {
      selectProfileTab('profile', true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
});
