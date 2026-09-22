import { renderAuth } from './pages/auth.js';
import { renderLobby } from './pages/lobby.js';
import { renderGame } from './pages/game.js';

const appContainer = document.getElementById("app");

// Словник маршрутів: зіставляє хеш з функцією відмальовування
const routes = {
  '': renderAuth,
  '#/': renderAuth,
  '#/login': renderAuth,
  '#/lobby': renderLobby,
  '#/game': renderGame,
};

function router() {
  // Отримуємо поточний хеш з URL
  const hash = window.location.hash;
  
  // Знаходимо відповідну функцію, або використовуємо авторизацію як fallback
  const renderFunction = routes[hash] || routes['#/login'];
  
  // Відмальовуємо інтерфейс у контейнер
  appContainer.innerHTML = renderFunction();

  // Тут у майбутньому можна буде прив'язувати обробники подій (onClick для кнопок)
  // залежно від того, на якій ми зараз сторінці.
}

// Запускаємо роутер при зміні хешу та при першому завантаженні сторінки
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);