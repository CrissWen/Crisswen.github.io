// Глобальне сповіщення від ведучого — з'являється по центру екрана і бачать його ВСІ гравці кімнати.
// Не плутати з showHostToast у host-panel.js: той — маленький тост всередині самої панелі,
// видимий лише ведучому. Цей модуль — про широкомовну подію для всіх (крадіжка, зміна характеристики тощо).

const TOAST_ID = 'global-host-toast';
let hideTimeout = null;

function ensureRoot() {
  let root = document.getElementById(TOAST_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = TOAST_ID;
    root.className = 'global-toast';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  return root;
}

// showGlobalToast(messageText) — показує повідомлення по центру екрана, ховає через ~3.5с.
// Повторний виклик під час показу попереднього тосту миттєво замінює текст і перезапускає таймер.
export function showGlobalToast(messageText) {
  const root = ensureRoot();
  root.textContent = messageText;

  clearTimeout(hideTimeout);
  root.classList.add('is-visible');

  hideTimeout = setTimeout(() => {
    root.classList.remove('is-visible');
  }, 3500);
}
