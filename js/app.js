import { renderAuth, initAuth } from './pages/auth.js';
import { renderLobby, initLobby } from './pages/lobby.js';
import { renderGame } from './pages/game.js';

const appContainer = document.getElementById("app");

// Тепер кожен маршрут має функцію для HTML і функцію для логіки
const routes = {
  '#/login': { render: renderAuth, init: initAuth },
  '#/lobby': { render: renderLobby, init: initLobby },
  '#/game':  { render: renderGame, init: null },
};

function router() {
  const hash = window.location.hash || '#/login';
  const route = routes[hash] || routes['#/login'];
  
  // 1. Відмальовуємо інтерфейс
  appContainer.innerHTML = route.render();

  // 2. Якщо є логіка (слухачі подій), запускаємо її
  if (route.init) {
    route.init();
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);