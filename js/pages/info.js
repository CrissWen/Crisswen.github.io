// Інформаційні сторінки: «Правила» (#/rules), «ЧаПи» (#/faq), «Що нового» (#/changelog), «Автори» (#/credits),
// «Конфіденційність» (#/privacy) і «Умови» (#/terms).
// Спільний каркас — renderInfoShell.
// Дані: js/config/rules-config.js, faq-config.js, changelog-config.js, credits-config.js і legal-config.js. Стилі: css/info.css (лише змінні теми).
// Сторінки відкриті без входу в акаунт (не входять у PROTECTED_ROUTES у app.js).

import { esc } from '../utils/common/escape-html.js';
import { FAQ_ITEMS } from '../config/faq-config.js';
import { CREDITS } from '../config/credits-config.js';
import { CHANGELOG, CHANGE_TYPES } from '../config/changelog-config.js';
import { FORM_LINKS, FOOTER_CONFIG } from '../config/footer-config.js';
import { LEGAL_PAGES, LEGAL_UPDATED } from '../config/legal-config.js';
import { RULES_SECTIONS } from '../config/rules-config.js';
import { formatUpdateDate, formatCopyright } from '../utils/common/footer-helpers.js';
import { maskIcon } from '../utils/common/icon-mask.js';
import { CHANGELOG_ICONS } from '../constants/icons.js';
import { requestScrollTopOnNextRoute } from '../utils/common/scroll-top.js';
import { openPhotoModal, isSafePhotoPath } from '../ui/photo-modal.js';

// Безпечне підсвічування inline-форматування після esc():
// **жирний** -> <strong class="legal-strong">, ==акцент== -> <mark class="legal-highlight">,
// !!небезпека/штраф!! -> <span class="legal-danger">, ++успіх++ -> <span class="legal-ok">, `код` -> <code>
export function formatInline(escapedText) {
  return String(escapedText ?? '')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="legal-strong">$1</strong>')
    .replace(/==(.+?)==/g, '<mark class="legal-highlight">$1</mark>')
    .replace(/!!(.+?)!!/g, '<span class="legal-danger">$1</span>')
    .replace(/\+\+(.+?)\+\+/g, '<span class="legal-ok">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="legal-code">$1</code>');
}

// Парсить Markdown-таблиці (| col1 | col2 |) у розмітку .legal-table
function renderMarkdownTable(lines) {
  const rows = lines.map(line => {
    return line.split('|').map(cell => cell.trim()).filter((cell, idx, arr) => idx > 0 && idx < arr.length - 1);
  });
  if (rows.length < 2) return '';
  const header = rows[0];
  const isDivider = rows[1].every(cell => /^:?-+:?$/.test(cell));
  const dataRows = isDivider ? rows.slice(2) : rows.slice(1);

  const ths = header.map((cell, idx) => {
    const isNum = idx > 0;
    const numCls = isNum ? ' class="is-num"' : '';
    return `<th${numCls}>${formatInline(esc(cell))}</th>`;
  }).join('');

  const trs = dataRows.map(row => {
    const tds = row.map((cell, idx) => {
      const isHead = idx === 0;
      const cls = isHead ? ' class="is-head"' : ' class="is-num"';
      return `<td${cls}>${formatInline(esc(cell))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  return `
    <div class="legal-table-wrap">
      <table class="legal-table">
        <thead><tr>${ths}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
}

// Парсить звичайні текстові блоки: підзаголовки (### ...), таблиці (| ... |), плашки (> ...) та списки (- / — / •)
function renderBlocks(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(block => {
      const rawLines = block.split('\n');
      const parts = [];
      let currentList = null;
      let currentParagraph = null;

      function flushParagraph() {
        if (currentParagraph) {
          parts.push(`<p>${currentParagraph.join('<br>')}</p>`);
          currentParagraph = null;
        }
      }
      function flushList() {
        if (currentList) {
          parts.push(`<ul class="legal-section__list">${currentList.join('')}</ul>`);
          currentList = null;
        }
      }

      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          flushParagraph();
          flushList();
          const tableLines = [trimmed];
          while (i + 1 < rawLines.length && rawLines[i + 1].trim().startsWith('|') && rawLines[i + 1].trim().endsWith('|')) {
            i++;
            tableLines.push(rawLines[i].trim());
          }
          parts.push(renderMarkdownTable(tableLines));
          continue;
        }

        if (/^###\s+/.test(trimmed)) {
          flushParagraph();
          flushList();
          const headingText = trimmed.replace(/^###\s+/, '');
          parts.push(`<h3 class="legal-subheading">${formatInline(esc(headingText))}</h3>`);
          continue;
        }

        if (/^>\s*/.test(trimmed)) {
          flushParagraph();
          flushList();
          const raw = trimmed.replace(/^>\s*/, '');
          const isDanger = /^\[!(DANGER|WARNING)\]/i.test(raw);
          const clean = raw.replace(/^\[!(DANGER|WARNING|NOTE|TIP)\]\s*/i, '');
          const modifier = isDanger ? ' legal-callout--danger' : '';
          parts.push(`<div class="legal-callout${modifier}">${formatInline(esc(clean))}</div>`);
          continue;
        }

        if (/^[-—•]\s+/.test(trimmed)) {
          flushParagraph();
          if (!currentList) currentList = [];
          const itemText = trimmed.replace(/^[-—•]\s+/, '');
          currentList.push(`<li>${formatInline(esc(itemText))}</li>`);
          continue;
        }

        flushList();
        if (currentParagraph) {
          currentParagraph.push(formatInline(esc(line)));
        } else {
          currentParagraph = [formatInline(esc(line))];
        }
      }

      flushParagraph();
      flushList();
      return parts.join('');
    })
    .join('');
}

// Порожній рядок між абзацами -> окремі блоки, одинарний перенос -> <br>. Текст екранується.
// Підтримує розкривні блоки :::details <Заголовок>\n<Зміст>\n:::
export function renderParagraphs(text) {
  if (!text) return '';

  const detailsRegex = /:::details\s+([^\n]+)\n([\s\S]*?)\n:::/g;
  if (detailsRegex.test(text)) {
    let lastIndex = 0;
    let match;
    const segments = [];
    detailsRegex.lastIndex = 0;
    while ((match = detailsRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'normal', content: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'details', title: match[1].trim(), content: match[2].trim() });
      lastIndex = detailsRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      segments.push({ type: 'normal', content: text.slice(lastIndex) });
    }
    return segments.map(seg => {
      if (seg.type === 'details') {
        const titleHtml = formatInline(esc(seg.title));
        const bodyHtml = renderParagraphs(seg.content);
        return `
          <details class="legal-details">
            <summary class="legal-details__summary">
              <span>${titleHtml}</span>
              <span class="legal-details__chevron" aria-hidden="true"></span>
            </summary>
            <div class="legal-details__body">${bodyHtml}</div>
          </details>`;
      }
      return renderBlocks(seg.content);
    }).join('');
  }

  return renderBlocks(text);
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

// «Автори»: картки з іменем, роллю й (за наявності) посиланням. Дані — js/config/credits-config.js.
// Посилання відкривається лише якщо це повна https-адреса, інакше показуємо картку без нього.
export function renderCredits() {
  const cards = CREDITS.map(person => {
    const link = typeof person.link === 'string' && /^https:\/\//i.test(person.link)
      ? `<a class="credits-card__link" href="${esc(person.link)}" target="_blank" rel="noopener noreferrer">${esc(person.link.replace(/^https:\/\//i, ''))}</a>`
      : '';
    // Картка з фото клікабельна: відкриває вікно з фото (initInfoPage → openPhotoModal)
    const hasPhoto = isSafePhotoPath(person.photo);
    const photoAttrs = hasPhoto
      ? ` role="button" tabindex="0" aria-haspopup="dialog" data-credits-photo="${esc(person.photo)}" data-credits-alt="${esc(person.photoAlt || '')}" data-credits-caption="${esc(person.photoCaption || '')}"`
      : '';
    const hint = hasPhoto ? '<span class="credits-card__hint">Натисніть, щоб побачити фото</span>' : '';
    return `
        <article class="credits-card${hasPhoto ? ' credits-card--photo' : ''}" data-credits-id="${esc(person.id)}"${photoAttrs}>
          <h2 class="credits-card__name">${esc(person.name)}</h2>
          <p class="credits-card__role">${esc(person.role)}</p>
          ${link}
          ${hint}
        </article>`;
  }).join('');

  return renderInfoShell({
    id: 'credits',
    title: 'Автори',
    lead: 'Над грою працювали.',
    body: cards
      ? `<div class="credits-list">${cards}</div>`
      : '<p class="info-page__empty">Список авторів поки порожній.</p>',
  });
}

// ===== «Конфіденційність» і «Умови» =====
// Обидві сторінки будуються з js/config/legal-config.js: нумеровані пункти (заголовок, абзаци, список), нагорі — дата редакції,
// внизу — блок зв'язку (ті самі Google-форми, що й у ЧаПи), копірайт і посилання на «сусідню» сторінку.
// Увесь текст екранується (esc), тож HTML із конфігу в розмітку не потрапить.
// Необов'язкове посилання в кінці пункту ({ label, href }). Дозволено лише повну https-адресу або сторінку сайту вигляду 'name.html';
// відкривається в новій вкладці (як тест «Оцінка виживання бункера» у грі). Інакше повертає порожній рядок.
function renderSectionLink(link) {
  const href = link && typeof link.href === 'string' ? link.href.trim() : '';
  const label = link && typeof link.label === 'string' ? link.label.trim() : '';
  if (!label || !(/^https:\/\//i.test(href) || /^[a-z0-9_-]+\.html$/i.test(href))) return '';
  return `<p class="legal-section__link-wrap"><a class="legal-section__link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></p>`;
}

function renderLegalSection(pageId, section, index) {
  const text = section.text ? renderParagraphs(section.text) : '';
  const items = Array.isArray(section.items) && section.items.length
    ? `<ul class="legal-section__list">${section.items.map(item => `<li>${formatInline(esc(item))}</li>`).join('')}</ul>`
    : '';
  const after = section.after ? renderParagraphs(section.after) : '';
  const link = renderSectionLink(section.link);
  return `
        <section class="legal-section" id="legal-${esc(pageId)}-${esc(section.id)}">
          <h2 class="legal-section__title"><span class="legal-section__num">${index + 1}.</span> ${esc(section.title)}</h2>
          <div class="legal-section__body">${text}${items}${after}${link}</div>
        </section>`;
}

function renderContactBlock() {
  return `
    <aside class="info-help" aria-labelledby="legal-contact-title">
      <h2 class="info-help__title" id="legal-contact-title">Зв'язок з нами</h2>
      <p class="info-help__text">Питання, скарги чи запит на видалення акаунта — напишіть нам.</p>
      <div class="info-help__actions">
        ${renderAction({ id: 'bug', label: 'Знайшли баг?', href: FORM_LINKS.bugReport })}
        ${renderAction({ id: 'idea', label: 'Є ідея?', href: FORM_LINKS.ideas })}
      </div>
    </aside>`;
}

function renderLegalPage(key, otherKey) {
  const page = LEGAL_PAGES[key];
  const other = LEGAL_PAGES[otherKey];
  const sections = page.sections.map((section, i) => renderLegalSection(page.id, section, i)).join('');
  const body = `
    <p class="legal-meta">Остання редакція: <time datetime="${esc(LEGAL_UPDATED)}">${esc(formatUpdateDate(LEGAL_UPDATED))}</time></p>
    <div class="legal-sections">${sections}</div>
    ${renderContactBlock()}
    <footer class="legal-foot">
      <p class="legal-foot__copy">${esc(formatCopyright(FOOTER_CONFIG))}. Усі права захищено.</p>
      <a class="legal-foot__link" href="#/${esc(other.id)}">${esc(other.title)} &rarr;</a>
    </footer>`;
  return renderInfoShell({ id: page.id, title: page.title, lead: page.lead, body });
}

export function renderPrivacy() { return renderLegalPage('privacy', 'terms'); }
export function renderTerms() { return renderLegalPage('terms', 'privacy'); }

// ===== «Правила» =====
// Бокова липка панель швидкого переходу між розділами правил
function renderRulesSidebar() {
  if (!RULES_SECTIONS?.length) return '';
  const items = RULES_SECTIONS.map((sec, i) => `
    <a class="rules-nav__item" href="#legal-rules-${esc(sec.id)}" data-rules-nav="${esc(sec.id)}">
      <span class="rules-nav__num">${i + 1}.</span>
      <span class="rules-nav__label">${esc(sec.title)}</span>
    </a>`).join('');

  return `
    <aside class="rules-sidebar" aria-label="Зміст правил">
      <nav class="rules-nav">
        <div class="rules-nav__head">
          <span class="rules-nav__title">Зміст</span>
        </div>
        <div class="rules-nav__list">${items}</div>
      </nav>
    </aside>`;
}

// Нумеровані пункти з js/config/rules-config.js (той самий вигляд, що й у юридичних сторінок: renderLegalSection),
// внизу — блок «Не знайшли відповідь?» (форми як у ЧаПи) і посилання на ЧаПи. Текст екранується (esc).
export function renderRules() {
  const sidebar = renderRulesSidebar();
  const sections = RULES_SECTIONS.map((section, i) => renderLegalSection('rules', section, i)).join('');
  const body = sections
    ? `
    <div class="rules-layout">
      <div class="rules-layout__content">
        <div class="legal-sections">${sections}</div>
        ${renderHelpBlock()}
        <footer class="legal-foot">
          <a class="legal-foot__link" href="#/faq">ЧаПи &rarr;</a>
        </footer>
      </div>
      ${sidebar}
    </div>`
    : '<p class="info-page__empty">Правила поки не додані.</p>';
  return renderInfoShell({
    id: 'rules',
    title: 'Правила гри',
    lead: 'Як грати в «Бункер»: від кімнати очікування до фінального екрана.',
    body,
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

  // «Автори»: клік (або Enter/Пробіл) по картці з фото відкриває вікно з фото
  document.querySelectorAll('[data-credits-photo]').forEach(card => {
    const open = () => openPhotoModal({
      src: card.dataset.creditsPhoto,
      alt: card.dataset.creditsAlt || '',
      caption: card.dataset.creditsCaption || '',
    }, card);
    card.addEventListener('click', e => { if (!e.target.closest('a')) open(); });
    card.addEventListener('keydown', e => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });

  // Плавний перехід при кліку по пунктах навігації
  const navItems = document.querySelectorAll('[data-rules-nav]');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const id = item.getAttribute('data-rules-nav');
      const target = document.getElementById(`legal-rules-${id}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        navItems.forEach(c => c.classList.remove('is-active'));
        item.classList.add('is-active');
      }
    });
  });

  // Підсвічування активного розділу при скролі сторінки
  const navList = document.querySelector('.rules-nav__list');
  const sections = document.querySelectorAll('.legal-section');
  if (navList && sections.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.id.replace('legal-rules-', '');
          const activeItem = navList.querySelector(`[data-rules-nav="${sectionId}"]`);
          if (activeItem) {
            navList.querySelectorAll('.rules-nav__item').forEach(c => c.classList.remove('is-active'));
            activeItem.classList.add('is-active');
            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          }
        }
      });
    }, { rootMargin: '-15% 0px -65% 0px', threshold: 0 });

    sections.forEach(sec => observer.observe(sec));
  }
}
