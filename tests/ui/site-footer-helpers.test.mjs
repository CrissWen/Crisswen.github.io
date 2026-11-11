import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDayOfYear,
  pickDailyQuote,
  formatUpdateDate,
  formatCopyright,
  shouldShowBackToTop,
} from '../../js/utils/common/footer-helpers.js';
import { FOOTER_QUOTES, FALLBACK_QUOTE, QUOTES_COUNT } from '../../js/config/footer-quotes.js';
import { FOOTER_COLUMNS, FOOTER_LEGAL, FOOTER_CONFIG } from '../../js/config/footer-config.js';

test('getDayOfYear: межі року, звичайний і високосний', () => {
  assert.equal(getDayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(getDayOfYear(new Date(2026, 2, 1)), 60);
  assert.equal(getDayOfYear(new Date(2026, 11, 31)), 365);
  assert.equal(getDayOfYear(new Date(2028, 11, 31)), 366);
});

test('getDayOfYear: не залежить від часу доби', () => {
  assert.equal(getDayOfYear(new Date(2026, 5, 15, 0, 0, 1)), getDayOfYear(new Date(2026, 5, 15, 23, 59, 59)));
});

test('pickDailyQuote: різні дні дають різні цитати, один день — одну', () => {
  const quotes = Array.from({ length: 365 }, (_, i) => `q${i + 1}`);
  assert.equal(pickDailyQuote(quotes, new Date(2026, 0, 1)), 'q1');
  assert.equal(pickDailyQuote(quotes, new Date(2026, 0, 2)), 'q2');
  assert.equal(pickDailyQuote(quotes, new Date(2026, 11, 31)), 'q365');
  assert.equal(pickDailyQuote(quotes, new Date(2026, 3, 10, 3)), pickDailyQuote(quotes, new Date(2026, 3, 10, 22)));
});

test('pickDailyQuote: 366-й день високосного року не ламається (береться залишок)', () => {
  const quotes = Array.from({ length: 365 }, (_, i) => `q${i + 1}`);
  assert.equal(pickDailyQuote(quotes, new Date(2028, 11, 31)), 'q1');
});

test('pickDailyQuote: порожній масив, відсутня тема або порожній рядок -> fallback', () => {
  assert.equal(pickDailyQuote([], new Date(2026, 0, 1), 'FB'), 'FB');
  assert.equal(pickDailyQuote(undefined, new Date(2026, 0, 1), 'FB'), 'FB');
  assert.equal(pickDailyQuote(['  '], new Date(2026, 0, 1), 'FB'), 'FB');
});

test('formatUpdateDate: РРРР-ММ-ДД -> ДД.ММ.РРРР, невалідне лишається як є', () => {
  assert.equal(formatUpdateDate('2026-11-04'), '04.11.2026');
  assert.equal(formatUpdateDate('04.11.2026'), '04.11.2026');
  assert.equal(formatUpdateDate(undefined), '');
});

test('formatCopyright: один рік, а з наступного — діапазон', () => {
  const cfg = { startYear: 2026, teamName: 'Назва команди' };
  assert.equal(formatCopyright(cfg, new Date(2026, 5, 1)), '© 2026 Назва команди');
  assert.equal(formatCopyright(cfg, new Date(2027, 0, 1)), '© 2026–2027 Назва команди');
});

test('shouldShowBackToTop: поріг 40% від доступної прокрутки', () => {
  const page = { scrollHeight: 3000, viewportHeight: 1000, threshold: 0.4, minScrollable: 240 }; // є куди скролити: 2000
  assert.equal(shouldShowBackToTop({ ...page, scrollY: 0 }), false);
  assert.equal(shouldShowBackToTop({ ...page, scrollY: 799 }), false);
  assert.equal(shouldShowBackToTop({ ...page, scrollY: 800 }), true);
  assert.equal(shouldShowBackToTop({ ...page, scrollY: 2000 }), true);
});

test('shouldShowBackToTop: на коротких сторінках кнопки немає', () => {
  assert.equal(shouldShowBackToTop({ scrollY: 100, scrollHeight: 1100, viewportHeight: 1000 }), false);
  assert.equal(shouldShowBackToTop({ scrollY: 0, scrollHeight: 800, viewportHeight: 1000 }), false);
  assert.equal(shouldShowBackToTop({ scrollY: 0, scrollHeight: NaN, viewportHeight: 1000 }), false);
});

test('цитати: єдиний список із 365 непорожніх унікальних рядків', () => {
  assert.ok(Array.isArray(FOOTER_QUOTES));
  assert.equal(FOOTER_QUOTES.length, QUOTES_COUNT);
  assert.ok(FOOTER_QUOTES.every(q => typeof q === 'string' && q.trim()), 'є порожня цитата');
  assert.equal(new Set(FOOTER_QUOTES).size, FOOTER_QUOTES.length, 'є дублікати цитат');
  assert.ok(FALLBACK_QUOTE.trim());
});

test('конфіг футера: усі пункти мають унікальні id та підпис, href — null або рядок', () => {
  const items = [...FOOTER_COLUMNS.flatMap(c => c.items), ...FOOTER_LEGAL];
  const ids = items.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'id пунктів мають бути унікальні');
  for (const item of items) {
    assert.ok(item.label && item.label.trim(), `у пункту «${item.id}» немає підпису`);
    assert.ok(item.href === null || typeof item.href === 'string', `href пункту «${item.id}» має бути null або рядком`);
    assert.notEqual(item.href, '#', `href «#» у «${item.id}» спрацював би в роутері — використовуйте null для заглушки`);
  }
  assert.match(FOOTER_CONFIG.version, /^\d+\.\d+\.\d+$/);
  assert.match(FOOTER_CONFIG.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
});
