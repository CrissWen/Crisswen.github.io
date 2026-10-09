import { supabase } from './services/supabase.js';
import { renderAuth, initAuth } from './pages/auth.js';
import { renderLobby, initLobby } from './pages/lobby.js';
import { renderGame, initGame, cleanupGame } from './pages/game.js';
import { renderProfile, initProfile } from './pages/profile.js'; // Підключаємо сторінку профілю
import { renderPacks, initPacks, cleanupPacks } from './pages/packs.js';
import { renderPackEditor, initPackEditor, cleanupPackEditor } from './pack-editor/editor.js';
import { applyStoredTheme } from './utils/theme-manager.js';

// Підстраховує inline-скрипт у <head> index.html (той лише запобігає миготінню дефолтної теми
// до завантаження цього модуля) — викликається один раз при старті, не всередині router().
applyStoredTheme();

const appContainer = document.getElementById("app");
const globalHeader = document.getElementById("global-header");
const headerUserName = document.getElementById("header-user-name");
const headerUserAvatar = document.getElementById("header-user-avatar");

// Додаємо новий роут
const routes = {
  '#/login': { render: renderAuth, init: initAuth, cleanup: null },
  '#/lobby': { render: renderLobby, init: initLobby, cleanup: null },
  '#/game': { render: renderGame, init: initGame, cleanup: cleanupGame },
  '#/profile': { render: renderProfile, init: initProfile, cleanup: null },
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

  // --- ЛОГІКА ХЕДЕРА ---
  if (session && path !== '#/login') {
    globalHeader.style.display = 'flex';
    const username = session.user?.user_metadata?.username || 'Гравець';

    // Вставляємо ім'я
    headerUserName.textContent = username;

    const firstLetter = username.charAt(0);
    headerUserAvatar.textContent = firstLetter;

    if (/^[gjpqyуфщц]/i.test(firstLetter)) {
      headerUserAvatar.style.paddingBottom = '3px';
    } else {
      headerUserAvatar.style.paddingBottom = '0';
    }
  } else {
    globalHeader.style.display = 'none';
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
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);