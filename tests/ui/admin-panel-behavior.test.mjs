import test from 'node:test';
import assert from 'node:assert/strict';

// Поведінка js/ui/admin-panel.js на мінімальному фейковому DOM (у проєкті немає jsdom, як і в інших UI-тестах).
// Перевірка доступу підміняється через initAdminPanel({ checkAccess }); реальний supabase тут не потрібен.
// Модуль тримає стан між викликами (initialized, rootEl), тому сценарії йдуть послідовно в одному файлі.

// ===== Фейковий DOM =====
class FakeHTMLElement {}
globalThis.HTMLElement = FakeHTMLElement;

class FakeEl extends FakeHTMLElement {
  constructor({ id = '', tagName = 'DIV', ariaModal = false, extra = {} } = {}) {
    super();
    this.id = id;
    this.tagName = tagName;
    this.hidden = false;
    this.removed = false;
    this.ariaModal = ariaModal;
    this.focused = false;
    this._classes = new Set();
    this.classList = {
      add: c => this._classes.add(c),
      remove: c => this._classes.delete(c),
      contains: c => this._classes.has(c),
    };
    this.listeners = {};
    Object.assign(this, extra);
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type) { delete this.listeners[type]; }
  getAttribute() { return null; }
  focus() { this.focused = true; doc.activeElement = this; }
  remove() { this.removed = true; registry.delete(this); }
}

const registry = new Set(); // елементи, що «є в DOM»
const docListeners = {};
const listenerCapture = {};

const doc = {
  activeElement: new FakeEl({ tagName: 'BODY' }),
  body: {
    insertAdjacentHTML(_pos, html) {
      const root = new FakeEl({ id: 'admin-panel-root', ariaModal: true });
      root.html = html;
      root.tool1 = new FakeEl({ tagName: 'A', extra: { target: '_blank' } });
      root.tool2 = new FakeEl({ tagName: 'A', extra: { target: '_blank' } });
      root.closeBtn = new FakeEl({ tagName: 'BUTTON' });
      root.querySelector = sel => {
        if (sel === '[data-admin-tool]') return root.tool1;
        if (sel === '[data-admin-close]') return root.closeBtn;
        return null;
      };
      root.querySelectorAll = () => [root.tool1, root.tool2, root.closeBtn];
      registry.add(root);
    },
  },
  getElementById(id) { return [...registry].find(el => el.id === id) || null; },
  querySelectorAll(sel) {
    return sel === MODAL_SELECTOR ? [...registry].filter(el => el.ariaModal) : [];
  },
  contains(el) { return registry.has(el) || el === doc.activeElement; },
};
globalThis.document = doc;
// Слухач клавіш має бути на window у фазі захоплення (першим, до гарячих клавіш сторінки)
globalThis.window = {
  addEventListener(type, fn, capture) { docListeners[type] = fn; listenerCapture[type] = capture; },
};
globalThis.requestAnimationFrame = fn => queueMicrotask(fn);

const tick = () => new Promise(r => setTimeout(r, 15));

function press(code, extra = {}) {
  const e = {
    code,
    key: extra.key ?? '',
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false,
    target: doc.activeElement,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...extra,
  };
  docListeners.keydown(e);
  return e;
}
const pressTilde = (extra) => press('Backquote', extra);
const pressKey = (code, key) => press(code, { key });
const pressEsc = () => press('Escape', { key: 'Escape' });
const panelRoot = () => doc.getElementById('admin-panel-root');

// ===== Підміна перевірки доступу =====
const access = { admin: false, calls: 0, delayMs: 0, throws: false };
async function checkAccess() {
  access.calls += 1;
  if (access.delayMs) await new Promise(r => setTimeout(r, access.delayMs));
  if (access.throws) throw new Error('збій мережі');
  return access.admin;
}

const { MODAL_SELECTOR } = await import('../../js/utils/common/admin-panel-helpers.js');
const { initAdminPanel, isAdminPanelOpen } = await import('../../js/ui/admin-panel.js');
initAdminPanel({ checkAccess });
initAdminPanel({ checkAccess: async () => true }); // повторна ініціалізація ігнорується

test('слухач клавіш стоїть на window у фазі захоплення', () => {
  assert.equal(typeof docListeners.keydown, 'function');
  assert.equal(listenerCapture.keydown, true);
});

test('не адмін: ~ нічого не відкриває й не блокує клавішу', async () => {
  access.admin = false;
  const e = pressTilde();
  await tick();
  assert.equal(access.calls, 1, 'доступ перевірено один раз');
  assert.equal(panelRoot(), null, 'панелі немає');
  assert.equal(e.defaultPrevented, false, 'клавіша лишається звичайною');
  assert.equal(e.propagationStopped, false, 'сторінка бачить клавішу коректно');
  const other = pressKey('KeyC', 'c');
  assert.equal(other.propagationStopped, false, 'закрита панель не чіпає інші клавіші');
});

test('збій перевірки доступу вважається відмовою без падіння', async () => {
  access.throws = true;
  const origError = console.error;
  console.error = () => {};
  try {
    pressTilde();
    await tick();
  } finally {
    console.error = origError;
    access.throws = false;
  }
  assert.equal(panelRoot(), null);
});

test('поле вводу: перевірка доступу навіть не запускається', async () => {
  const before = access.calls;
  doc.activeElement = new FakeEl({ tagName: 'TEXTAREA' });
  pressTilde();
  await tick();
  assert.equal(access.calls, before);
  assert.equal(panelRoot(), null);
  doc.activeElement = new FakeEl({ tagName: 'BODY' });
});

test('Ctrl+~ та автоповтор ігноруються', async () => {
  const before = access.calls;
  pressTilde({ ctrlKey: true });
  pressTilde({ repeat: true });
  await tick();
  assert.equal(access.calls, before);
});

test('інша модалка вже відкрита: панель не відкривається і до бази не ходить', async () => {
  access.admin = true;
  const before = access.calls;
  const other = new FakeEl({ id: 'custom-confirm-root', ariaModal: true });
  registry.add(other);
  pressTilde();
  await tick();
  assert.equal(access.calls, before);
  assert.equal(panelRoot(), null);
  registry.delete(other);
});

test('модалка з\'явилась під час перевірки доступу: панель не відкривається поверх', async () => {
  access.admin = true;
  access.delayMs = 30;
  const other = new FakeEl({ id: 'pack-notice-root', ariaModal: true });
  pressTilde();
  registry.add(other); // з'явилась, поки чекаємо відповіді
  await new Promise(r => setTimeout(r, 60));
  access.delayMs = 0;
  assert.equal(panelRoot(), null);
  registry.delete(other);
});

test('адмін: паралельні натискання зливаються в один запит і одну панель', async () => {
  access.admin = true;
  access.delayMs = 30;
  const before = access.calls;
  const prev = new FakeEl({ tagName: 'BUTTON' });
  doc.activeElement = prev;
  pressTilde();
  pressTilde();
  pressTilde();
  await new Promise(r => setTimeout(r, 60));
  access.delayMs = 0;

  assert.equal(access.calls - before, 1, 'один запит на всі натискання');
  const root = panelRoot();
  assert.ok(root, 'панель відкрилась');
  assert.ok(isAdminPanelOpen());
  assert.equal([...registry].filter(el => el.id === 'admin-panel-root').length, 1, 'одна панель у DOM');
  assert.ok(root.tool1.focused, 'фокус на першому інструменті');
});

test('розмітка: обидва інструменти, нова вкладка з noopener, кнопка закриття', () => {
  const html = panelRoot().html;
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /Аудіо-лабораторія/);
  assert.match(html, /Куратор іконок/);
  assert.match(html, /href="audio-lab\.html"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /href="cataclysm-icon-curator\.html"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /data-admin-close/);
});

test('поки панель відкрита, гарячі клавіші сторінки не спрацьовують, а Enter на посиланні не блокується', () => {
  for (const [code, key] of [['KeyC', 'c'], ['Enter', 'Enter'], ['Space', ' '], ['ArrowLeft', 'ArrowLeft'], ['KeyU', 'u']]) {
    const e = pressKey(code, key);
    assert.equal(e.propagationStopped, true, `«${key}» має зупинятись на панелі`);
    assert.equal(e.defaultPrevented, false, `«${key}»: стандартна дія (активація посилання) не скасована`);
  }
});

test('Tab обходить фокус по колу всередині панелі (focus trap)', () => {
  const root = panelRoot();
  root.closeBtn.focus(); // останній елемент
  const fwd = press('Tab', { key: 'Tab' });
  assert.equal(fwd.defaultPrevented, true);
  assert.equal(doc.activeElement, root.tool1, 'з останнього на перший');

  const back = press('Tab', { key: 'Tab', shiftKey: true });
  assert.equal(back.defaultPrevented, true);
  assert.equal(doc.activeElement, root.closeBtn, 'з першого назад на останній');
});

test('клік по посиланню в нову вкладку лишає панель відкритою', () => {
  const root = panelRoot();
  const blank = new FakeEl({ tagName: 'A', extra: { target: '_blank' } });
  root.listeners.click({ target: { closest: sel => (sel === 'a[data-admin-tool]' ? blank : null) } });
  assert.ok(isAdminPanelOpen(), 'нова вкладка: панель лишається');
});

test('Esc поступається іншій модалці, а потім закриває панель і повертає фокус', async () => {
  const prev = doc.activeElement; // після Tab-тесту це елемент усередині панелі
  const other = new FakeEl({ id: 'custom-confirm-root', ariaModal: true });
  registry.add(other);
  const e1 = pressEsc();
  assert.ok(isAdminPanelOpen(), 'з іншою модалкою Esc не чіпає панель');
  assert.equal(e1.defaultPrevented, false);
  assert.equal(e1.propagationStopped, false, 'Esc доходить до іншої модалки');
  registry.delete(other);

  const e2 = pressEsc();
  assert.equal(isAdminPanelOpen(), false);
  assert.equal(e2.defaultPrevented, true);
  assert.ok(prev, 'фокус було кому повертати');
  await tick();
});

test('закриття повертає фокус на елемент, що мав його до відкриття', async () => {
  access.admin = true;
  const prev = new FakeEl({ tagName: 'BUTTON' });
  registry.add(prev); // елемент ще є на сторінці (document.contains)
  doc.activeElement = prev;
  pressTilde();
  await tick();
  assert.ok(isAdminPanelOpen());
  assert.notEqual(doc.activeElement, prev, 'фокус зараз у панелі');

  prev.focused = false;
  pressTilde(); // повторне ~ закриває
  assert.equal(isAdminPanelOpen(), false);
  assert.equal(doc.activeElement, prev);
  assert.ok(prev.focused, 'фокус повернувся');
});

test('клік по фону та по × закривають панель', async () => {
  pressTilde();
  await tick();
  let root = panelRoot();
  assert.ok(isAdminPanelOpen());
  root.listeners.click({ target: root, closest: () => null });
  assert.equal(isAdminPanelOpen(), false, 'фон');

  await new Promise(r => setTimeout(r, 260)); // дати відпрацювати прибиранню старої панелі
  pressTilde();
  await tick();
  root = panelRoot();
  assert.ok(isAdminPanelOpen());
  const closeTarget = { closest: sel => (sel === '[data-admin-close]' ? root.closeBtn : null) };
  root.listeners.click({ target: closeTarget });
  assert.equal(isAdminPanelOpen(), false, 'кнопка ×');
  await new Promise(r => setTimeout(r, 260));
});
