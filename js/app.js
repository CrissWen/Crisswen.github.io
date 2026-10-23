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

function router() {
  const fullHash = window.location.hash || '#/login';
  const path = fullHash.split('?')[0]; 
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