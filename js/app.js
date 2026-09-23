import { renderAuth, initAuth } from './pages/auth.js';
import { renderLobby, initLobby } from './pages/lobby.js';
import { renderGame, initGame } from './pages/game.js';

const appContainer = document.getElementById("app");

const routes = {
  '#/login': { render: renderAuth, init: initAuth },
  '#/lobby': { render: renderLobby, init: initLobby },
  '#/game':  { render: renderGame, init: initGame },
};

function router() {
  const fullHash = window.location.hash || '#/login';
  
  const path = fullHash.split('?')[0]; 
  
  const route = routes[path] || routes['#/login'];
  
  appContainer.innerHTML = route.render();

  if (route.init) {
    route.init();
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);