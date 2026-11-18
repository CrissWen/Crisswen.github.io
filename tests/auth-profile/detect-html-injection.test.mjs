import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHtmlInjection } from '../../js/utils/auth/security.js';

// ===== detectHtmlInjection: обробники подій =====
// Справжні атрибути-обробники ловимо, звичайні слова на кшталт "online = …" не чіпаємо.

test('detectHtmlInjection: ловить справжні обробники подій', () => {
  for (const bad of [
    'onclick=alert(1)', 'onerror = x', 'onload=boom', 'x onmouseover=evil', 'ONCLICK=1',
    'onfocus =1', 'onkeydown=1', 'onpointerdown=1', 'onanimationend=1', 'ontoggle=1',
  ]) {
    assert.equal(detectHtmlInjection(bad), true, `має ловити: ${bad}`);
  }
});

test('detectHtmlInjection: не спрацьовує на звичайні слова з "on…="', () => {
  for (const ok of [
    'online = так', 'only = ліпше', 'onions = 3', 'once = раз', 'oncandy = 1', 'one = 1',
    'Умови = прості', 'Condition = норма', 'Режим: online = true',
  ]) {
    assert.equal(detectHtmlInjection(ok), false, `не має ловити: ${ok}`);
  }
});

test('detectHtmlInjection: інші перевірки лишились', () => {
  assert.equal(detectHtmlInjection('<script>alert(1)</script>'), true);
  assert.equal(detectHtmlInjection('<img src=x>'), true);
  assert.equal(detectHtmlInjection('javascript:alert(1)'), true);
  assert.equal(detectHtmlInjection('data:text/html,<b>'), true);
  assert.equal(detectHtmlInjection('Звичайний текст картки'), false);
  assert.equal(detectHtmlInjection(''), false);
  assert.equal(detectHtmlInjection(null), false);
});