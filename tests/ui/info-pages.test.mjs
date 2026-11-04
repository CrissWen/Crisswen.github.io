import test from 'node:test';
import assert from 'node:assert/strict';
import { FAQ_ITEMS } from '../../js/config/faq-config.js';
import { CHANGELOG, CHANGE_TYPES } from '../../js/config/changelog-config.js';
import { FOOTER_CONFIG, FOOTER_COLUMNS, FORM_LINKS } from '../../js/config/footer-config.js';
import { renderFaq, renderChangelog, renderParagraphs, renderInfoShell } from '../../js/pages/info.js';
import { ICONS, FOOTER_ICONS, CHANGELOG_ICONS } from '../../js/constants/icons.js';
import { maskIcon } from '../../js/utils/common/icon-mask.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootFile = p => fileURLToPath(new URL(`../../${p.replace(/^\.\//, '')}`, import.meta.url));

const allFooterItems = () => FOOTER_COLUMNS.flatMap(col => col.items);

test('ЧаПи: id унікальні, питання й відповіді непорожні', () => {
  assert.ok(FAQ_ITEMS.length > 0);
  const ids = FAQ_ITEMS.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of FAQ_ITEMS) {
    assert.ok(typeof item.q === 'string' && item.q.trim(), `порожнє питання: ${item.id}`);
    assert.ok(typeof item.a === 'string' && item.a.trim(), `порожня відповідь: ${item.id}`);
  }
});

test('ченджлог: версії унікальні, дати валідні й від новішої до старішої, типи відомі', () => {
  assert.ok(CHANGELOG.length > 0);
  const versions = CHANGELOG.map(e => e.version);
  assert.equal(new Set(versions).size, versions.length);
  for (const entry of CHANGELOG) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.items.length > 0, `порожній запис ${entry.version}`);
    for (const item of entry.items) {
      assert.ok(CHANGE_TYPES[item.type], `невідомий тип «${item.type}» у ${entry.version}`);
      assert.ok(item.text.trim());
    }
  }
  const dates = CHANGELOG.map(e => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'найновіший запис має бути першим');
});

test('футер бере версію й дату з першого запису ченджлогу', () => {
  assert.equal(FOOTER_CONFIG.version, CHANGELOG[0].version);
  assert.equal(FOOTER_CONFIG.updatedAt, CHANGELOG[0].date);
});

test('пункти футера «ЧаПи» і «Що нового» ведуть на свої сторінки', () => {
  const byId = Object.fromEntries(allFooterItems().map(i => [i.id, i]));
  assert.equal(byId.faq.href, '#/faq');
  assert.equal(byId.changelog.href, '#/changelog');
});

test('renderParagraphs: абзаци, переноси й екранування HTML', () => {
  assert.equal(renderParagraphs('Один\n\nДва'), '<p>Один</p><p>Два</p>');
  assert.ok(renderParagraphs('а\nб').includes('<br>'));
  assert.equal(renderParagraphs(''), '');
  assert.equal(renderParagraphs(null), '');
  const html = renderParagraphs('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
});

test('renderInfoShell: заголовок екранується, лід і кнопка «Назад» на місці', () => {
  const html = renderInfoShell({ id: 'x', title: '<b>Заг</b>', lead: 'Лід', body: '<i>тіло</i>' });
  assert.ok(!html.includes('<b>Заг'));
  assert.ok(html.includes('data-info-back'));
  assert.ok(html.includes('info-page__lead'));
  assert.ok(html.includes('<i>тіло</i>'));
  assert.ok(!renderInfoShell({ id: 'x', title: 'T' }).includes('info-page__lead'));
});

test('renderFaq: усі питання виведено акордеоном, небезпечний текст екранується', () => {
  const html = renderFaq();
  assert.equal((html.match(/<details class="faq-item"/g) || []).length, FAQ_ITEMS.length);
  for (const item of FAQ_ITEMS) assert.ok(html.includes(item.id));

  FAQ_ITEMS.push({ id: 'xss', q: '<img src=x onerror=alert(1)>', a: 'а\n\nб' });
  try {
    const dirty = renderFaq();
    assert.ok(!dirty.includes('<img'), 'питання не екранується');
    assert.equal((dirty.match(/<p>/g) || []).length >= 2, true);
  } finally {
    FAQ_ITEMS.pop();
  }
});

test('форми в ЧаПи: без адреси — заглушка, з https-адресою — посилання, чужа схема — заглушка', () => {
  const saved = { ...FORM_LINKS };
  try {
    FORM_LINKS.bugReport = '';
    FORM_LINKS.ideas = 'https://forms.gle/abc';
    let html = renderFaq();
    assert.ok(html.includes('data-info-action="bug"'));
    assert.match(html, /<button[^>]*is-stub[^>]*data-info-action="bug"/);
    assert.match(html, /<a class="info-action" href="https:\/\/forms\.gle\/abc" target="_blank" rel="noopener noreferrer"/);

    FORM_LINKS.ideas = 'javascript:alert(1)';
    html = renderFaq();
    assert.ok(!html.includes('javascript:'), 'небезпечна схема потрапила в розмітку');
  } finally {
    Object.assign(FORM_LINKS, saved);
  }
});

test('renderChangelog: усі версії на сторінці, позначка «Поточна» лише на першій, дата у форматі ДД.ММ.РРРР', () => {
  const html = renderChangelog();
  assert.equal((html.match(/<article class="changelog-entry/g) || []).length, CHANGELOG.length);
  assert.equal((html.match(/changelog-entry__badge/g) || []).length, 1);
  assert.ok(html.includes(`v${CHANGELOG[0].version}`));
  const [y, m, d] = CHANGELOG[0].date.split('-');
  assert.ok(html.includes(`${d}.${m}.${y}`));
});

test('renderChangelog: типи змін показані іконками з доступною назвою, а не текстовими мітками', () => {
  const entry = CHANGELOG[0];
  const added = [
    { type: 'change', text: 'A1' },
    { type: 'fix', text: 'A2' },
    { type: 'bogus', text: 'A3' },
  ];
  entry.items.push(...added);
  try {
    const html = renderChangelog();
    assert.ok(!html.includes('changelog-item__tag'), 'лишилася стара текстова мітка');
    for (const label of Object.values(CHANGE_TYPES)) {
      assert.ok(html.includes(`role="img" aria-label="${label}"`), `немає іконки «${label}»`);
    }
    const totalItems = CHANGELOG.reduce((n, e) => n + e.items.length, 0);
    assert.equal((html.match(/class="ui-icon/g) || []).length, totalItems, 'у кожного пункту має бути рівно одна іконка');
    assert.ok(!html.includes('<svg '), 'іконки мають братися з файлів /icons, а не бути вбудованими SVG');
    assert.ok(html.includes(CHANGELOG_ICONS.fix), 'немає шляху до іконки «fix» із констант');
    // невідомий тип не ламає розмітку й показується як «Зміна»
    assert.match(html, /changelog-item--change[\s\S]*?A3/);
  } finally {
    entry.items.splice(-added.length);
  }
});

test('іконки футера й ченджлогу: кожен шлях із констант веде на існуючий SVG-файл', () => {
  const paths = [...Object.values(FOOTER_ICONS), ...Object.values(CHANGELOG_ICONS)];
  assert.ok(paths.length >= 9);
  for (const p of paths) {
    assert.match(p, /^\.\/icons\/(footer|changelog)\/[\w-]+\.svg$/, `дивний шлях: ${p}`);
    assert.ok(existsSync(rootFile(p)), `немає файлу ${p}`);
  }
  for (const key of Object.keys(ICONS).filter(k => /^(FOOTER|CHANGELOG)_/.test(k))) {
    assert.ok(existsSync(rootFile(ICONS[key])), `немає файлу для ICONS.${key}`);
  }
});

test('кожен type із CHANGE_TYPES має іконку, а кожен icon у колонках футера — запис у FOOTER_ICONS', () => {
  for (const type of Object.keys(CHANGE_TYPES)) assert.ok(CHANGELOG_ICONS[type], `немає іконки для типу «${type}»`);
  for (const item of allFooterItems().filter(i => i.icon)) {
    assert.ok(FOOTER_ICONS[item.icon], `немає іконки «${item.icon}» для пункту ${item.id}`);
  }
});

test('maskIcon: маска з файлу, розмір, екранування, порожній шлях -> порожній рядок', () => {
  const html = maskIcon('./icons/footer/bug.svg', { size: 20, className: 'x' });
  assert.ok(html.includes("mask-image:url('./icons/footer/bug.svg')"));
  assert.ok(html.includes('--icon-size:20px'));
  assert.ok(html.includes('class="ui-icon x"'));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.equal(maskIcon(''), '');
  assert.ok(!maskIcon('x\'"><script>').includes('<script>'));
});

test('scroll-top: запит спрацьовує один раз і гасне; без запиту нічого не відбувається', async () => {
  const { requestScrollTopOnNextRoute, consumeScrollTopRequest } = await import('../../js/utils/common/scroll-top.js');
  assert.equal(consumeScrollTopRequest(), false);
  requestScrollTopOnNextRoute();
  assert.equal(consumeScrollTopRequest(), true);
  assert.equal(consumeScrollTopRequest(), false, 'запит має спрацьовувати лише раз');
  requestScrollTopOnNextRoute(-1);
  assert.equal(consumeScrollTopRequest(), false, 'прострочений запит не діє');
});
test('ЧаПи: заглушок немає, є базові питання про теми, звук, кімнату й пак', () => {
  for (const item of FAQ_ITEMS) {
    assert.ok(!/з.явиться найближчим часом/i.test(item.a), `у питанні «${item.id}» лишилась заглушка`);
    assert.ok(item.a.trim().length > 20, `надто коротка відповідь: ${item.id}`);
  }
  const ids = FAQ_ITEMS.map(i => i.id);
  for (const need of ['how-to-start', 'room-code', 'connection-lost', 'change-theme', 'change-sound', 'create-pack']) {
    assert.ok(ids.includes(need), `немає питання «${need}»`);
  }
});
