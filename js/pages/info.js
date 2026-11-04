// Інформаційні сторінки: «ЧаПи» (#/faq) і «Що нового» (#/changelog).
// Спільний каркас (renderInfoShell) — на ньому ж потім можна зробити «Правила», «Конфіденційність», «Умови».
// Дані: js/config/faq-config.js і js/config/changelog-config.js. Стилі: css/info.css (лише змінні теми).
// Сторінки відкриті без входу в акаунт (не входять у PROTECTED_ROUTES у app.js).

import { esc } from '../utils/common/escape-html.js';
import { FAQ_ITEMS } from '../config/faq-config.js';
import { CHANGELOG, CHANGE_TYPES } from '../config/changelog-config.js';
import { FORM_LINKS } from '../config/footer-config.js';
import { formatUpdateDate } from '../utils/common/footer-helpers.js';
import { maskIcon } from '../utils/common/icon-mask.js';
import { CHANGELOG_ICONS } from '../constants/icons.js';
import { requestScrollTopOnNextRoute } from '../utils/common/scroll-top.js';

// Порожній рядок між абзацами -> окремі <p>, одинарний перенос -> <br>. Текст екранується.
export function renderParagraphs(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function renderInfoShell({ id, title, lead = '', body = '' }) {
  return `
    <section class="info-page" id="info-page-${esc(id)}">
      <button type="button" class="info-page__back" data-info-back>&larr; Назад</button>
      <header class="info-page__head">
        <h1 class="info-page__title">${esc(title)}</h1>
        ${lead ? `<p class="info-page__lead">${esc(lead)}</p>` : ''}
      </header>
      <div class="info-page__body">${body}</div>
    </section>`;
}

// Посилання на форму: лише повна http(s)-адреса відкривається (в новій вкладці), інакше — «заглушка» без переходу.
function renderAction({ id, label, href }) {
  if (typeof href === 'string' && /^https?:\/\//i.test(href)) {
    return `<a class="info-action" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-info-action="${esc(id)}">${esc(label)}</a>`;
  }
  return `<button type="button" class="info-action is-stub" data-info-action="${esc(id)}" title="Скоро">${esc(label)}</button>`;
}

function renderHelpBlock() {
  return `
    <aside class="info-help" aria-labelledby="info-help-title">
      <h2 class="info-help__title" id="info-help-title">Не знайшли відповідь?</h2>
      <p class="info-help__text">Розкажіть нам — це допоможе зробити гру кращою.</p>
      <div class="info-help__actions">
        ${renderAction({ id: 'bug', label: 'Знайшли баг?', href: FORM_LINKS.bugReport })}
        ${renderAction({ id: 'idea', label: 'Є ідея?', href: FORM_LINKS.ideas })}
      </div>
    </aside>`;
}

export function renderFaq() {
  const items = FAQ_ITEMS.map(item => `
        <details class="faq-item" data-faq-id="${esc(item.id)}">
          <summary class="faq-item__q">
            <span>${esc(item.q)}</span>
            <span class="faq-item__chevron" aria-hidden="true"></span>
          </summary>
          <div class="faq-item__a">${renderParagraphs(item.a)}</div>
        </details>`).join('');

  const list = items
    ? `<div class="faq-list">${items}</div>`
    : '<p class="info-page__empty">Питань поки немає.</p>';

  return renderInfoShell({
    id: 'faq',
    title: 'ЧаПи',
    lead: 'Відповіді на найпоширеніші питання про гру.',
    body: list + renderHelpBlock(),
  });
}


// Іконки типів змін лежать у /icons/changelog, шляхи — у js/constants/icons.js (CHANGELOG_ICONS).
// Малюються через mask-image з фоном currentColor, тому підхоплюють колір теми.
export function renderChangelog() {
  const entries = CHANGELOG.map((entry, index) => {
    const items = entry.items.map(item => {
      const type = CHANGE_TYPES[item.type] ? item.type : 'change';
      return `
          <li class="changelog-item changelog-item--${esc(type)}">
            <span class="changelog-item__icon" role="img" aria-label="${esc(CHANGE_TYPES[type])}" title="${esc(CHANGE_TYPES[type])}">${maskIcon(CHANGELOG_ICONS[type], { size: 18 })}</span>
            <span class="changelog-item__text">${esc(item.text)}</span>
          </li>`;
    }).join('');

    return `
      <article class="changelog-entry${index === 0 ? ' is-latest' : ''}">
        <header class="changelog-entry__head">
          <h2 class="changelog-entry__version">v${esc(entry.version)}</h2>
          ${index === 0 ? '<span class="changelog-entry__badge">Поточна</span>' : ''}
          <time class="changelog-entry__date" datetime="${esc(entry.date)}">${esc(formatUpdateDate(entry.date))}</time>
        </header>
        <ul class="changelog-entry__list">${items}</ul>
      </article>`;
  }).join('');

  return renderInfoShell({
    id: 'changelog',
    title: 'Що нового',
    lead: 'Історія оновлень гри.',
    body: entries
      ? `<div class="changelog">${entries}</div>`
      : '<p class="info-page__empty">Записів поки немає.</p>',
  });
}

// «Назад»: у попередню сторінку історії (звідки прийшов гравець, у тому числі зі сторінки гри),
// а якщо історії немає (сторінку відкрито напряму) — у лобі.
function goBack() {
  requestScrollTopOnNextRoute(); // інакше браузер поверне попередню сторінку туди, де був клік по футеру (донизу)
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/lobby';
}

export function initInfoPage() {
  window.scrollTo(0, 0); // роутер не скролить сам, а сторінка відкривається з футера — тобто знизу довгої сторінки
  document.querySelector('[data-info-back]')?.addEventListener('click', goBack);
}
