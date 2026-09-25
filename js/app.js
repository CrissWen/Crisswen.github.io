import { supabase } from './services/supabase.js';
import { renderAuth, initAuth } from './pages/auth.js';
import { renderLobby, initLobby } from './pages/lobby.js';
import { renderGame, initGame, cleanupGame } from './pages/game.js';

const appContainer = document.getElementById("app");

const routes = {
  '#/login': { render: renderAuth, init: initAuth, cleanup: null },
  '#/lobby': { render: renderLobby, init: initLobby, cleanup: null },
  '#/game':  { render: renderGame, init: initGame, cleanup: cleanupGame },
};

let currentRouteObj = null;

async function router() {
  const { data: { session } } = await supabase.auth.getSession();

  const fullHash = window.location.hash || '#/login';
  const path = fullHash.split('?')[0];

  // Є сесія, але користувач на сторінці входу (або на корені сайту) -> в лобі
  if (session && (path === '#/login' || !window.location.hash)) {
    window.location.hash = '#/lobby';
    return;
  }

  // Немає сесії, але користувач намагається зайти в захищений розділ -> на вхід
  if (!session && (path === '#/lobby' || path === '#/game')) {
    window.location.hash = '#/login';
    return;
  }

  const route = routes[path] || routes['#/login'];

  if (currentRouteObj && currentRouteObj.cleanup) {
    currentRouteObj.cleanup();
  }

  currentRouteObj = route;

  appContainer.innerHTML = route.render();

  if (route.init) {
    route.init();
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);