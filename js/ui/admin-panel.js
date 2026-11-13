// Адмін-панель: модальне вікно зі списком службових сторінок-відладчиків. Відкривається й ховається клавішею ~.
// Дані: js/config/admin-tools-config.js (новий інструмент = ще один запис у реєстрі).
// Чиста логіка (хоткей, поля вводу, групування, пошук іншої модалки, обхід фокуса): js/utils/common/admin-panel-helpers.js.
// Кольори, шрифти й радіуси беруться лише зі змінних теми (css/admin-panel.css), тож панель сама підлаштовується під усі теми.
//
// Панель це зручність, а не захист: кожна сторінка зберігає власний Admin Gate, а справжній захист забезпечує RLS.
// Для не-адміна й незалогінених панель мовчить: без тостів, підказок і (для незалогінених) без запитів до бази.

import { esc } from '../utils/auth/security.js';
import { maskIcon } from '../utils/common/icon-mask.js';
import { ADMIN_TOOLS, ADMIN_TOOL_GROUPS, FALLBACK_GROUP } from '../config/admin-tools-config.js';
import {
  isToggleHotkey,
  isTypingTarget,
  groupTools,
  findBlockingModal,
  nextFocusIndex,
  createSingleFlight,
} from '../utils/common/admin-panel-helpers.js';

const ROOT_ID = 'admin-panel-root';
const CLOSE_MS = 220;
const FOCUSABLE = 'a[href], button:not([disabled])';

// Обробники інструментів без сторінки: ключ відповідає полю action у реєстрі. Обробник отримує інструмент.
// Приклад: ACTION_HANDLERS['clear-cache'] = tool => { ... }. Панель сама закриється перед викликом.
const ACTION_HANDLERS = {};

let initialized = false;
let accessCheck = defaultCheckAccess;
let rootEl = null;
let previousFocus = null;

function toolInner(tool) {
  const icon = tool.icon
    ? `<span class="admin-panel__tool-icon">${maskIcon(tool.icon, { size: 22 })}</span>`
    : '';
  return `${icon}
        <span class="admin-panel__tool-text">
          <span class="admin-panel__tool-title">${esc(tool.title)}</span>
          <span class="admin-panel__tool-desc">${esc(tool.description || '')}</span>
        </span>`;
}

// Інструмент із href: посилання (за замовчуванням у новій вкладці: гра працює через Realtime, тож перехід у тій самій вкладці
// розірвав би сесію). Інструмент із action: кнопка. Без жодного з двох: нічого не малюємо.
function renderTool(tool) {
  if (tool.href) {
    const target = tool.openIn === '_self' ? '_self' : '_blank';
    const rel = target === '_blank' ? ' rel="noopener noreferrer"' : '';
    return `<a class="admin-panel__tool" href="${esc(tool.href)}" target="${target}"${rel} data-admin-tool="${esc(tool.id)}">
        ${toolInner(tool)}
        <span class="admin-panel__tool-go" aria-hidden="true">↗</span>
      </a>`;
  }
  if (tool.action) {
    return `<button type="button" class="admin-panel__tool" data-admin-tool="${esc(tool.id)}" data-admin-action="${esc(tool.action)}">
        ${toolInner(tool)}
      </button>`;
  }
  return '';
}

function renderGroup(group) {
  const items = group.tools.map(tool => renderTool(tool)).filter(Boolean).map(html => `<li>${html}</li>`).join('');
  if (!items) return '';
  const titleId = `${ROOT_ID}-group-${group.id}`;
  return `
      <section class="admin-panel__group" aria-labelledby="${esc(titleId)}">
        <h3 class="admin-panel__group-title" id="${esc(titleId)}">${esc(group.title)}</h3>
        <ul class="admin-panel__list">${items}</ul>
      </section>`;
}

function panelHtml() {
  const groups = groupTools(ADMIN_TOOLS, ADMIN_TOOL_GROUPS, FALLBACK_GROUP);
  const body = groups.map(renderGroup).join('') || '<p class="admin-panel__empty">Інструментів поки немає.</p>';
  return `
    <div id="${ROOT_ID}" class="admin-panel" role="dialog" aria-modal="true" aria-labelledby="${ROOT_ID}-title">
      <div class="admin-panel__card">
        <header class="admin-panel__head">
          <h2 class="admin-panel__title" id="${ROOT_ID}-title">Адмін-панель</h2>
          <button type="button" class="admin-panel__close" data-admin-close aria-label="Закрити" title="Закрити">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </header>
        <div class="admin-panel__body">${body}
        </div>
        <footer class="admin-panel__foot">
          <kbd class="admin-panel__key">~</kbd> або <kbd class="admin-panel__key">Esc</kbd>: закрити
        </footer>
      </div>
    </div>
  `;
}

export function isAdminPanelOpen() {
  return Boolean(rootEl) && rootEl.classList.contains('is-open');
}

export function closeAdminPanel() {
  if (!rootEl) return;
  const el = rootEl;
  rootEl = null;
  el.removeEventListener('click', onRootClick);
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), CLOSE_MS);

  // Фокус повертається туди, де був до відкриття (якщо елемент ще є на сторінці)
  const back = previousFocus;
  previousFocus = null;
  if (back && typeof back.focus === 'function' && document.contains(back)) {
    try { back.focus({ preventScroll: true }); } catch { /* елемент міг зникнути */ }
  }
}

function openAdminPanel() {
  document.getElementById(ROOT_ID)?.remove();
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  document.body.insertAdjacentHTML('beforeend', panelHtml());
  rootEl = document.getElementById(ROOT_ID);
  rootEl.addEventListener('click', onRootClick);

  const el = rootEl;
  // rAF, щоб браузер застосував початковий (прихований) стан до додавання .is-open: інакше анімації не буде
  requestAnimationFrame(() => {
    if (rootEl !== el) return;
    el.classList.add('is-open');
    (el.querySelector('[data-admin-tool]') || el.querySelector('[data-admin-close]'))?.focus();
  });
}

function onRootClick(e) {
  // клік по затемненому фону (поза карткою) або по ×
  if (e.target === rootEl || e.target.closest('[data-admin-close]')) {
    closeAdminPanel();
    return;
  }

  const actionBtn = e.target.closest('[data-admin-action]');
  if (actionBtn) {
    const tool = ADMIN_TOOLS.find(t => t.id === actionBtn.dataset.adminTool);
    const handler = tool && ACTION_HANDLERS[tool.action];
    closeAdminPanel();
    if (typeof handler === 'function') handler(tool);
    else console.warn(`admin-panel: немає обробника для action «${actionBtn.dataset.adminAction}»`);
    return;
  }

  // Посилання у тій самій вкладці: панель більше не потрібна. Посилання в нову вкладку лишає панель відкритою.
  const link = e.target.closest('a[data-admin-tool]');
  if (link && link.target === '_self') closeAdminPanel();
}

// Стандартна перевірка доступу. Імпорти динамічні: supabase.js вже завантажений з app.js (береться з кешу модулів),
// а packs-store.js підвантажується лише для залогінених. getSession читає локальний стан, тому для
// незалогінених запиту до бази немає. Помилку перевірки вважаємо відмовою.
async function defaultCheckAccess() {
  const { supabase } = await import('../services/supabase.js');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { checkIsAdmin } = await import('../services/packs-store.js');
  return checkIsAdmin();
}

async function isCurrentUserAdmin() {
  try {
    return Boolean(await accessCheck());
  } catch (err) {
    console.error('admin-panel: не вдалося перевірити доступ:', err);
    return false;
  }
}

// Один запуск на всі натискання, що прийшли, поки триває перевірка: запит до бази не дублюється.
const tryOpen = createSingleFlight(async () => {
  if (rootEl) return;
  if (findBlockingModal(document, ROOT_ID)) return;
  if (!(await isCurrentUserAdmin())) return;
  // Поки чекали відповіді, могла відкритися інша модалка: тоді не відкриваємось поверх, щоб один Esc не закрив обидві
  if (rootEl || findBlockingModal(document, ROOT_ID)) return;
  openAdminPanel();
});

function trapTab(e) {
  const items = [...rootEl.querySelectorAll(FOCUSABLE)];
  if (!items.length) { e.preventDefault(); return; }
  e.preventDefault();
  const next = nextFocusIndex(items.indexOf(document.activeElement), items.length, e.shiftKey);
  items[next]?.focus();
}

// Слухач стоїть на window у фазі захоплення, щоб бути першим: поки панель відкрита, ми зупиняємо поширення клавіш,
// інакше гарячі клавіші сторінки працювали би під панеллю (у кураторі Enter, пробіл, C, U та стрілки
// міняють оцінки й блокують активацію посилання). Стандартна дія клавіші (Enter на посиланні) працює крім цього.
function onKeydown(e) {
  if (rootEl) {
    // Поверх панелі відкрилась інша модалка: усі клавіші (й Esc) належать їй, панель нічого не чіпає
    if (findBlockingModal(document, ROOT_ID)) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAdminPanel();
      return;
    }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (isToggleHotkey(e)) {
      e.preventDefault();
      closeAdminPanel();
    }
    return;
  }

  if (!isToggleHotkey(e)) return;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
  // Не preventDefault: поки не відомо, що це адмін, клавіша має лишатися звичайною для всіх інших
  tryOpen();
}

// checkAccess: дає підмінити перевірку доступу (async () => boolean); у застосунку не потрібен, використовується тестами.
export function initAdminPanel({ checkAccess } = {}) {
  if (initialized) return;
  initialized = true;
  if (typeof checkAccess === 'function') accessCheck = checkAccess;
  window.addEventListener('keydown', onKeydown, true);
}
