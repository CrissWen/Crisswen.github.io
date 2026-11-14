// Футер сайту + плаваюча кнопка «Нагору».
// Дані: js/config/footer-config.js (посилання, версія, команда) і js/config/footer-quotes.js (цитати дня).
// Чиста логіка (цитата, дата, поріг скролу): js/utils/common/footer-helpers.js.
// Кольори й шрифти беруться лише зі змінних теми, тому футер сам підлаштовується під усі теми (css/footer.css).

import { FOOTER_CONFIG, FOOTER_COLUMNS, FOOTER_LEGAL } from '../config/footer-config.js';
import { FOOTER_QUOTES, FALLBACK_QUOTE } from '../config/footer-quotes.js';
import { getCurrentTheme, onThemeChange } from '../utils/common/theme-manager.js';
import { isLdmEnabled } from '../services/display-settings.js';
import { esc } from '../utils/common/escape-html.js';
import { maskIcon } from '../utils/common/icon-mask.js';
import { FOOTER_ICONS } from '../constants/icons.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { openRateVideo } from './rate-video-modal.js';
import {
  pickDailyQuote,
  formatUpdateDate,
  formatCopyright,
  shouldShowBackToTop,
} from '../utils/common/footer-helpers.js';

// Пункт із href -> посилання (зовнішнє в новій вкладці). Без href -> «заглушка»: кнопка, яка виглядає
// клікабельною, але нікуди не веде. Це не <a href="#">, бо порожній hash спрацював би в роутері (app.js).
function renderLink(item, extraClass = '') {
  const icon = item.icon && FOOTER_ICONS[item.icon]
    ? `<span class="site-footer__icon" aria-hidden="true">${maskIcon(FOOTER_ICONS[item.icon], { size: 16 })}</span>`
    : '';
  const label = `<span class="site-footer__link-label">${esc(item.label)}</span>`;
  const cls = `site-footer__link${extraClass ? ` ${extraClass}` : ''}`;

  if (item.href) {
    const external = /^https?:\/\//i.test(item.href);
    const ext = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="${cls}" href="${esc(item.href)}"${ext} data-footer-link="${esc(item.id)}">${icon}${label}</a>`;
  }
  // Пункт із action — робоча кнопка (без «Скоро»), дію обробляє initFooterActions
  if (item.action) {
    return `<button type="button" class="${cls}" data-footer-link="${esc(item.id)}" data-footer-action="${esc(item.action)}">${icon}${label}</button>`;
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

// Кнопки футера з data-footer-action: «Оцінити проєкт» відкриває програвач із відео
function initFooterActions(footerEl) {
  footerEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-footer-action]');
    if (!btn) return;
    if (btn.dataset.footerAction === 'rate-video') openRateVideo(btn);
  });
}

// Клік по внутрішньому посиланню футера, що веде на сторінку, де гравець уже є (наприклад, «Що нового» на сторінці
// «Що нового»), не змінює адресу, тому роутер мовчить. Щоб клік усе ж «спрацював», плавно піднімаємо сторінку нагору.
function initSamePageScroll(footerEl) {
  footerEl.addEventListener('click', e => {
    const link = e.target.closest('a[href^="#/"]');
    if (!link) return;
    const target = link.getAttribute('href').split('?')[0];
    const current = (window.location.hash || '').split('?')[0];
    if (target !== current) return;
    e.preventDefault();
    const reduceMotion = isLdmEnabled() || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
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
  btn.innerHTML = maskIcon(FOOTER_ICONS.arrowUp, { size: 20 });
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
    const reduceMotion = isLdmEnabled() || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
  initSamePageScroll(footerEl);
  initFooterActions(footerEl);

  // Зміна теми -> тематичний декор футера
  onThemeChange(() => applyTheme(footerEl));

  initBackToTop();
}
