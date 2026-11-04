// Футер сайту + плаваюча кнопка «Нагору».
// Дані: js/config/footer-config.js (посилання, версія, команда) і js/config/footer-quotes.js (цитати дня).
// Чиста логіка (цитата, дата, поріг скролу): js/utils/common/footer-helpers.js.
// Кольори й шрифти беруться лише зі змінних теми, тому футер сам підлаштовується під усі теми (css/footer.css).

import { FOOTER_CONFIG, FOOTER_COLUMNS, FOOTER_LEGAL } from '../config/footer-config.js';
import { FOOTER_QUOTES, FALLBACK_QUOTE } from '../config/footer-quotes.js';
import { getCurrentTheme, onThemeChange } from '../utils/common/theme-manager.js';
import { esc } from '../utils/common/escape-html.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import {
  pickDailyQuote,
  formatUpdateDate,
  formatCopyright,
  shouldShowBackToTop,
} from '../utils/common/footer-helpers.js';

// Іконки малюються через currentColor, тому підхоплюють колір теми (hover, фокус тощо).
const SVG_OPEN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">';
const ICONS = {
  bug: `${SVG_OPEN}<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`,
  idea: `${SVG_OPEN}<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>`,
  star: `${SVG_OPEN}<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  heart: `${SVG_OPEN}<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  help: `${SVG_OPEN}<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  arrowUp: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" focusable="false"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
};

// Пункт із href -> посилання (зовнішнє в новій вкладці). Без href -> «заглушка»: кнопка, яка виглядає
// клікабельною, але нікуди не веде. Це не <a href="#">, бо порожній hash спрацював би в роутері (app.js).
function renderLink(item, extraClass = '') {
  const icon = item.icon && ICONS[item.icon]
    ? `<span class="site-footer__icon" aria-hidden="true">${ICONS[item.icon]}</span>`
    : '';
  const label = `<span class="site-footer__link-label">${esc(item.label)}</span>`;
  const cls = `site-footer__link${extraClass ? ` ${extraClass}` : ''}`;

  if (item.href) {
    const external = /^https?:\/\//i.test(item.href);
    const ext = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="${cls}" href="${esc(item.href)}"${ext} data-footer-link="${esc(item.id)}">${icon}${label}</a>`;
  }
  return `<button type="button" class="${cls} is-stub" data-footer-link="${esc(item.id)}" title="Скоро">${icon}${label}</button>`;
}

function renderColumn(col) {
  const items = col.items.map(item => `<li>${renderLink(item)}</li>`).join('');
  return `
        <nav class="site-footer__col site-footer__col--${esc(col.id)}" aria-labelledby="footer-col-${esc(col.id)}">
          <h3 class="site-footer__col-title" id="footer-col-${esc(col.id)}">${esc(col.title)}</h3>
          <ul class="site-footer__list">${items}</ul>
        </nav>`;
}

function renderFooter() {
  const { gameName, version, updatedAt, teamName, startYear } = FOOTER_CONFIG;
  const legal = FOOTER_LEGAL.map(item => renderLink(item, 'site-footer__link--small')).join('<span class="site-footer__dot" aria-hidden="true">·</span>');

  return `
    <div class="site-footer__inner">
      <div class="site-footer__main">
        <div class="site-footer__brand">
          <span class="site-footer__logo">
            <img src="icons/favicon.png" alt="" class="site-footer__logo-icon">
            ${esc(gameName)}
          </span>
          <!-- Пасхалка: клік по версії (data-footer-version) показує цитату дня, див. initQuoteEasterEgg.
               Анімація-підказка (css/footer.css) стихає після першого кліку. Тултіпа немає навмисно — щоб не розкривати сюрприз. -->
          <button type="button" class="site-footer__version" data-footer-version>v${esc(version)} · ${esc(formatUpdateDate(updatedAt))}</button>
        </div>
        ${FOOTER_COLUMNS.map(renderColumn).join('')}
      </div>

      <div class="site-footer__bottom">
        <span class="site-footer__copyright">${esc(formatCopyright({ startYear, teamName }))}</span>
        <div class="site-footer__legal">${legal}</div>
      </div>
    </div>`;
}

function applyTheme(footerEl) {
  footerEl.dataset.theme = getCurrentTheme();
}

// Після першого кліку по версії анімація-підказка стихає назавжди (localStorage може бути недоступний — тоді
// підказка просто показується знову після перезавантаження).
const QUOTE_SEEN_KEY = 'bunker_footer_quote_seen';

function wasQuoteSeen() {
  try { return localStorage.getItem(QUOTE_SEEN_KEY) === '1'; } catch { return false; }
}
function markQuoteSeen() {
  try { localStorage.setItem(QUOTE_SEEN_KEY, '1'); } catch { /* приватний режим тощо */ }
}

// Пасхалка: клік по версії показує цитату дня тостом. Цитату беремо щоразу заново,
// тож вона навіть після півночі буде актуальною.
function initQuoteEasterEgg(footerEl) {
  const versionBtn = footerEl.querySelector('[data-footer-version]');
  if (versionBtn && wasQuoteSeen()) versionBtn.classList.add('is-discovered');

  footerEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-footer-version]');
    if (!btn) return;
    btn.classList.add('is-discovered');
    markQuoteSeen();
    const text = pickDailyQuote(FOOTER_QUOTES, new Date(), FALLBACK_QUOTE);
    showGlobalToast(`«${text}»`, { duration: 6000 });
  });
}

function initBackToTop() {
  if (document.getElementById('back-to-top')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'back-to-top';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Нагору');
  btn.title = 'Нагору';
  btn.innerHTML = ICONS.arrowUp;
  document.body.appendChild(btn);

  const { showAfter, minScrollable } = FOOTER_CONFIG.backToTop;
  let ticking = false;

  const update = () => {
    ticking = false;
    btn.classList.toggle('is-visible', shouldShowBackToTop({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      threshold: showAfter,
      minScrollable,
    }));
  };
  const schedule = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('hashchange', schedule);
  // Сторінки відмальовуються роутером і ростуть/стискаються вже після завантаження — стежимо за висотою
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(document.body);

  btn.addEventListener('click', () => {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  schedule();
}

export function initSiteFooter() {
  const footerEl = document.getElementById('site-footer');
  if (!footerEl || footerEl.dataset.ready === '1') return;

  footerEl.innerHTML = renderFooter();
  footerEl.dataset.ready = '1';
  applyTheme(footerEl);
  initQuoteEasterEgg(footerEl);

  // Зміна теми -> тематичний декор футера
  onThemeChange(() => applyTheme(footerEl));

  initBackToTop();
}
