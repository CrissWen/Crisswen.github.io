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

export function hideGlobalToast() {
  clearTimeout(hideTimeout);
  const root = document.getElementById(TOAST_ID);
  if (root) {
    root.classList.remove('is-visible');
    root.classList.remove('has-action');
    root.innerHTML = '';
  }
}

// showGlobalToast(messageText, options) — показує повідомлення по центру екрана, ховає через ~3.5с (або options.duration).
// options = { actionText: 'Скасувати', onAction: () => { ... }, duration: 6000 }
export function showGlobalToast(messageText, options = null) {
  const root = ensureRoot();
  clearTimeout(hideTimeout);

  if (options?.actionText && typeof options?.onAction === 'function') {
    root.classList.add('has-action');
    root.innerHTML = '';

    const msgEl = document.createElement('div');
    msgEl.className = 'global-toast__text';
    msgEl.textContent = messageText;
    root.appendChild(msgEl);

    const actionsEl = document.createElement('div');
    actionsEl.className = 'global-toast__actions';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'global-toast__btn';
    btn.textContent = options.actionText;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      options.onAction();
      hideGlobalToast();
    });
    actionsEl.appendChild(btn);
    root.appendChild(actionsEl);

    root.classList.add('is-visible');
    const duration = typeof options.duration === 'number' ? options.duration : 6000;
    hideTimeout = setTimeout(() => {
      hideGlobalToast();
    }, duration);
  } else {
    root.classList.remove('has-action');
    root.textContent = messageText;

    root.classList.add('is-visible');
    const duration = typeof options?.duration === 'number' ? options.duration : 3500;
    hideTimeout = setTimeout(() => {
      hideGlobalToast();
    }, duration);
  }
}
