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
  // Витягуємо код запрошення з усієї після '?' (напр. #/lobby?join=ABCD) — щоб зберегти його при редиректі на логін
  const queryString = fullHash.split('?')[1] || '';
  const joinCode = new URLSearchParams(queryString).get('join');

  // Є сесія, і користувач відкрив просто порожній сайт (без хеша) -> в лобі
  if (session && !window.location.hash) {
    window.location.hash = '#/lobby';
    return;
  }

  // Є сесія, і гравець прийшов на #/login за посиланням-запрошенням (напр. вже був залогінений,
  // а хтось скинув йому #/login?join=КОД) — це не спроба зайти в акаунт, а запрошення в кімнату,
  // тож усе одно ведемо в лобі з тим самим кодом, а не показуємо форму входу.
  if (session && path === '#/login' && joinCode) {
    window.location.hash = `#/lobby?join=${joinCode}`;
    return;
  }

  // Є сесія, але гравець ЦІЛЕСПРЯМОВАНО перейшов на голий #/login (наприклад, через кнопку
  // "Профіль" у хедері) — більше НЕ редиректимо в лобі: дозволяємо роутеру нижче
  // зрендерити сторінку авторизації як є (auth.js не перевіряє сесію сам).

  // Немає сесії, але користувач намагається зайти в захищений розділ -> на вхід,
  // зберігаючи код запрошення в хвості хеша (auth.js поверне гравця саме в потрібну кімнату після логіну)
  if (!session && (path === '#/lobby' || path === '#/game')) {
    window.location.hash = joinCode ? `#/login?join=${joinCode}` : '#/login';
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