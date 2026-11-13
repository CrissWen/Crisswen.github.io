import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isToggleHotkey,
  isTypingTarget,
  groupTools,
  findBlockingModal,
  MODAL_SELECTOR,
  nextFocusIndex,
  createSingleFlight,
} from '../../js/utils/common/admin-panel-helpers.js';
import { ADMIN_TOOLS, ADMIN_TOOL_GROUPS, FALLBACK_GROUP } from '../../js/config/admin-tools-config.js';

const repoPath = rel => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

// ---------- Хоткей ----------

test('isToggleHotkey: Backquote без модифікаторів спрацьовує, Shift дозволений', () => {
  assert.equal(isToggleHotkey({ code: 'Backquote' }), true);
  assert.equal(isToggleHotkey({ code: 'Backquote', shiftKey: true }), true);
});

test('isToggleHotkey: Ctrl/Alt/Meta, автоповтор і IME блокують', () => {
  assert.equal(isToggleHotkey({ code: 'Backquote', ctrlKey: true }), false);
  assert.equal(isToggleHotkey({ code: 'Backquote', altKey: true }), false);
  assert.equal(isToggleHotkey({ code: 'Backquote', metaKey: true }), false);
  assert.equal(isToggleHotkey({ code: 'Backquote', repeat: true }), false);
  assert.equal(isToggleHotkey({ code: 'Backquote', isComposing: true }), false);
});

test('isToggleHotkey: інші клавіші та порожні значення ігноруються (розкладка не важлива, бо береться code)', () => {
  assert.equal(isToggleHotkey({ code: 'KeyX' }), false);
  assert.equal(isToggleHotkey({ code: 'Digit1', shiftKey: true }), false);
  // українська розкладка: key інший, code той самий
  assert.equal(isToggleHotkey({ code: 'Backquote', key: '’' }), true);
  assert.equal(isToggleHotkey({ key: '~' }), false);
  assert.equal(isToggleHotkey(null), false);
  assert.equal(isToggleHotkey(undefined), false);
});

// ---------- Поля вводу ----------

test('isTypingTarget: textarea, select, текстові input і contenteditable', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true, 'input без type — текстовий');
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: n => (n === 'contenteditable' ? 'true' : null) }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: n => (n === 'contenteditable' ? '' : null) }), true);
});

test('isTypingTarget: кнопки, чекбокси, повзунки та звичайні елементи не рахуються полями вводу', () => {
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tagName: 'A' }), false);
  assert.equal(isTypingTarget({ tagName: 'BODY' }), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'false' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
});

// ---------- Групування ----------

test('groupTools: зберігає порядок груп, пропускає порожні, невідомі збирає в fallback', () => {
  const groups = [{ id: 'a', title: 'А' }, { id: 'empty', title: 'Порожня' }, { id: 'b', title: 'Б' }];
  const tools = [
    { id: 't1', group: 'b' },
    { id: 't2', group: 'a' },
    { id: 't3', group: 'zzz' },
    { id: 't4', group: 'a' },
  ];
  const result = groupTools(tools, groups, { id: 'other', title: 'Інше' });
  assert.deepEqual(result.map(g => g.id), ['a', 'b', 'other']);
  assert.deepEqual(result[0].tools.map(t => t.id), ['t2', 't4']);
  assert.deepEqual(result[2].tools.map(t => t.id), ['t3']);
  assert.equal(result[2].title, 'Інше');
});

test('groupTools: порожні й некоректні вхідні дані не ламаються', () => {
  assert.deepEqual(groupTools([], [{ id: 'a', title: 'А' }]), []);
  assert.deepEqual(groupTools(undefined, undefined), []);
  assert.deepEqual(groupTools([null, {}, { group: 'a' }], [{ id: 'a', title: 'А' }]), [], 'записи без id ігноруються');
});

test('groupTools: реальний конфіг ділиться на відомі групи без fallback', () => {
  const result = groupTools(ADMIN_TOOLS, ADMIN_TOOL_GROUPS, FALLBACK_GROUP);
  assert.ok(result.length >= 1);
  assert.equal(result.flatMap(g => g.tools).length, ADMIN_TOOLS.length, 'жоден інструмент не загубився');
  assert.ok(!result.some(g => g.id === FALLBACK_GROUP.id), 'усі інструменти мають відому групу');
});

// ---------- Інша відкрита модалка ----------

function fakeDoc(nodes) {
  return { querySelectorAll: sel => (sel === MODAL_SELECTOR ? nodes : []) };
}
function fakeModal({ id = '', hidden = false, ariaHidden = null } = {}) {
  return { id, hidden, getAttribute: n => (n === 'aria-hidden' ? ariaHidden : null) };
}

test('findBlockingModal: знаходить видиму модалку, ігнорує власну та приховані', () => {
  const own = fakeModal({ id: 'admin-panel-root' });
  const hidden = fakeModal({ id: 'h1', hidden: true });
  const ariaHidden = fakeModal({ id: 'h2', ariaHidden: 'true' });
  const confirm = fakeModal({ id: 'custom-confirm-root' });

  assert.equal(findBlockingModal(fakeDoc([own, hidden, ariaHidden]), 'admin-panel-root'), null);
  assert.equal(findBlockingModal(fakeDoc([own, hidden, confirm]), 'admin-panel-root'), confirm);
  assert.equal(findBlockingModal(fakeDoc([]), 'admin-panel-root'), null);
});

test('MODAL_SELECTOR враховує й aria-modal, й нативні <dialog open> (куратор іконок)', () => {
  assert.match(MODAL_SELECTOR, /\[aria-modal="true"\]/);
  assert.match(MODAL_SELECTOR, /dialog\[open\]/);
});

test('findBlockingModal: відсутній document не ламається', () => {
  assert.equal(findBlockingModal(null, 'x'), null);
  assert.equal(findBlockingModal({}, 'x'), null);
});

// ---------- Focus trap ----------

test('nextFocusIndex: рух по колу вперед і назад', () => {
  assert.equal(nextFocusIndex(0, 3, false), 1);
  assert.equal(nextFocusIndex(2, 3, false), 0);
  assert.equal(nextFocusIndex(0, 3, true), 2);
  assert.equal(nextFocusIndex(2, 3, true), 1);
});

test('nextFocusIndex: фокус поза списком і порожній список', () => {
  assert.equal(nextFocusIndex(-1, 3, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true), 2);
  assert.equal(nextFocusIndex(0, 0, false), -1);
  assert.equal(nextFocusIndex(0, 1, false), 0, 'єдиний елемент лишається в фокусі');
});

// ---------- Злиття паралельних запитів ----------

test('createSingleFlight: паралельні виклики діляться одним запуском, послідовні запускаються знову', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const run = createSingleFlight(async () => { calls += 1; await gate; return calls; });

  const p1 = run();
  const p2 = run();
  const p3 = run();
  assert.equal(p1, p2);
  assert.equal(p2, p3);
  release();
  assert.deepEqual(await Promise.all([p1, p2, p3]), [1, 1, 1]);
  assert.equal(calls, 1);

  assert.equal(await run(), 2, 'після завершення наступний виклик запускає fn знову');
});

test('createSingleFlight: помилка не «залипає», наступний виклик працює', async () => {
  let n = 0;
  const run = createSingleFlight(async () => { n += 1; if (n === 1) throw new Error('boom'); return 'ok'; });
  await assert.rejects(run(), /boom/);
  assert.equal(await run(), 'ok');
});

// ---------- Реєстр інструментів ----------

test('конфіг: id унікальні, у кожного є назва, група, дія або href', () => {
  const ids = ADMIN_TOOLS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length, 'id інструментів мають бути унікальні');
  const groupIds = new Set(ADMIN_TOOL_GROUPS.map(g => g.id));
  assert.equal(groupIds.size, ADMIN_TOOL_GROUPS.length, 'id груп мають бути унікальні');

  for (const t of ADMIN_TOOLS) {
    assert.match(t.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `id «${t.id}» має бути kebab-case`);
    assert.ok(t.title && t.title.trim(), `у «${t.id}» немає назви`);
    assert.ok(t.description && t.description.trim(), `у «${t.id}» немає опису`);
    assert.ok(groupIds.has(t.group), `група «${t.group}» інструмента «${t.id}» не описана в ADMIN_TOOL_GROUPS`);
    assert.ok(Boolean(t.href) !== Boolean(t.action), `«${t.id}»: потрібен рівно один із href або action`);
    if (t.openIn !== undefined) assert.ok(['_blank', '_self'].includes(t.openIn), `openIn «${t.id}» має бути _blank або _self`);
  }
});

test('конфіг: href веде на наявний локальний файл, без протоколу та «#»', () => {
  for (const t of ADMIN_TOOLS.filter(x => x.href)) {
    assert.doesNotMatch(t.href, /^[a-z][a-z0-9+.-]*:/i, `href «${t.id}» не має містити протокол (javascript:, data: тощо)`);
    assert.notEqual(t.href, '#', `href «#» у «${t.id}» спрацював би в роутері`);
    const file = t.href.split(/[?#]/)[0];
    assert.ok(existsSync(repoPath(file)), `файл «${file}» інструмента «${t.id}» не знайдено`);
  }
});

test('конфіг: іконки існують на диску', () => {
  for (const t of ADMIN_TOOLS) {
    assert.ok(t.icon, `у «${t.id}» немає іконки`);
    assert.ok(existsSync(repoPath(t.icon)), `іконку «${t.icon}» інструмента «${t.id}» не знайдено`);
  }
});
