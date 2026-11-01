import assert from 'node:assert';

// MINOR 3 (аудит етапу 3): custom-select.js мав без aria-activedescendant, а стрілки при відкритому списку
// одразу міняли значення (без Enter). Очікувана поведінка — патерн ARIA combobox:
//  - стрілки / Home / End лише переміщують підсвітку (aria-activedescendant), значення не міняють;
//  - Enter / Space підтверджують вибір; Escape і Tab закривають без змін.

// ===== Мінімальний фейковий DOM рівно під custom-select.js =====
function matcher(sel) {
  const [pos, neg] = sel.trim().split(':not(');
  const must = pos.split('.').slice(1).filter(Boolean);
  const not = neg ? neg.replace(')', '').split('.').filter(Boolean) : [];
  return (el) => must.every((c) => el.classList.contains(c)) && !not.some((c) => el.classList.contains(c));
}

const registry = [];

class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.hidden = false;
    this._classes = new Set();
    this._text = '';
    this.classList = {
      add: (...n) => n.forEach((x) => this._classes.add(x)),
      remove: (...n) => n.forEach((x) => this._classes.delete(x)),
      contains: (n) => this._classes.has(n),
      toggle: (n, force) => {
        const on = force ?? !this._classes.has(n);
        if (on) this._classes.add(n); else this._classes.delete(n);
        return on;
      }
    };
    registry.push(this);
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set innerHTML(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._html = v; }
  get innerHTML() { return this._html || ''; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n); n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter((c) => c !== n);
    n.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, n);
    return n;
  }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; } }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  querySelectorAll(sel) { const m = matcher(sel); return this.descendants().filter(m); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { const m = matcher(sel); let n = this; while (n) { if (n.classList && m(n)) return n; n = n.parentNode; } return null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
  getBoundingClientRect() { return { top: 100, bottom: 130, left: 0, right: 100 }; }
  scrollIntoView() {}
  focus() { globalThis.__focused = this; }
}

class HTMLSelectElementFake extends FakeEl {
  constructor() { super('select'); this.options = []; this._value = ''; this.disabled = false; }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
}
globalThis.HTMLSelectElement = HTMLSelectElementFake;
globalThis.MutationObserver = class { observe() {} disconnect() {} };

const docListeners = {};
globalThis.document = {
  readyState: 'complete',
  body: new FakeEl('body'),
  addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
  querySelectorAll(sel) {
    const ms = sel.split(',').map(matcher);
    return registry.filter((el) => ms.some((m) => m(el)));
  }
};
globalThis.window = { innerHeight: 900 };

const { initCustomSelect } = await import('../../js/ui/custom-select.js');

// ===== Підготовка <select> =====
function makeSelect(values, selected) {
  const sel = new HTMLSelectElementFake();
  sel.id = 'test-select';
  values.forEach((v) => sel.options.push({ value: v, textContent: v.toUpperCase(), disabled: false }));
  sel._value = selected;
  const host = new FakeEl('div');
  document.body.appendChild(host);
  host.appendChild(sel);
  return sel;
}

const select = makeSelect(['a', 'b', 'c', 'd'], 'a');
let changes = 0;
select.addEventListener('change', () => { changes++; });

const wrap = initCustomSelect(select);
const btn = wrap.querySelector('.pe-select-custom__btn');
const dropdown = wrap.querySelector('.pe-select-custom__dropdown');

const press = (key) => {
  let prevented = false;
  btn.dispatchEvent({ type: 'keydown', key, preventDefault() { prevented = true; }, stopPropagation() {} });
  return prevented;
};
const items = () => dropdown.querySelectorAll('.pe-select-custom__item');
const activeId = () => btn.getAttribute('aria-activedescendant');
const idOf = (value) => items().find((i) => i.dataset.value === value)?.id;

// 1) Семантика combobox і унікальні id опцій
assert.strictEqual(btn.getAttribute('role'), 'combobox', 'кнопка має роль combobox');
assert.ok(dropdown.id, 'listbox має id');
assert.strictEqual(btn.getAttribute('aria-controls'), dropdown.id, 'aria-controls вказує на listbox');
const ids = items().map((i) => i.id);
assert.ok(ids.every(Boolean), 'кожна опція має id');
assert.strictEqual(new Set(ids).size, ids.length, 'id опцій унікальні');
assert.strictEqual(activeId(), null, 'поки список закритий, aria-activedescendant немає');

// 2) Відкриття стрілкою: підсвітка на поточному значенні, значення не змінюється
press('ArrowDown');
assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
assert.strictEqual(activeId(), idOf('a'), 'при відкритті активна поточна опція');

// 3) Стрілки лише рухають підсвітку, значення і change не чіпають
press('ArrowDown');
assert.strictEqual(activeId(), idOf('b'));
assert.strictEqual(select.value, 'a', 'I-a11y: ArrowDown не має змінювати значення без Enter');
assert.strictEqual(changes, 0, 'change не спрацьовує від стрілок');
assert.ok(items().find((i) => i.id === idOf('b')).classList.contains('is-active'), 'активна опція має клас is-active');
assert.ok(!items().find((i) => i.id === idOf('a')).classList.contains('is-active'), 'попередня втрачає is-active');

press('ArrowUp');
assert.strictEqual(activeId(), idOf('a'));
press('ArrowUp'); // циклічно на останню
assert.strictEqual(activeId(), idOf('d'), 'ArrowUp з першої переходить на останню');
press('ArrowDown'); // циклічно на першу
assert.strictEqual(activeId(), idOf('a'), 'ArrowDown з останньої переходить на першу');

// 4) Home / End
press('End');
assert.strictEqual(activeId(), idOf('d'));
press('Home');
assert.strictEqual(activeId(), idOf('a'));

// 5) Enter підтверджує вибір і закриває список
press('ArrowDown');
press('ArrowDown'); // c
assert.strictEqual(activeId(), idOf('c'));
press('Enter');
assert.strictEqual(select.value, 'c', 'Enter підтверджує вибір');
assert.strictEqual(changes, 1, 'рівно один change після підтвердження');
assert.strictEqual(btn.getAttribute('aria-expanded'), 'false', 'список закрито');
assert.strictEqual(activeId(), null, 'після закриття aria-activedescendant прибрано');

// 6) Escape закриває без змін
press('ArrowDown'); // відкрити (активна c)
press('ArrowDown'); // d
press('Escape');
assert.strictEqual(select.value, 'c', 'Escape не змінює значення');
assert.strictEqual(changes, 1);
assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
assert.strictEqual(activeId(), null);

// 7) Tab закриває без змін
press('ArrowDown');
press('ArrowDown');
press('Tab');
assert.strictEqual(select.value, 'c', 'Tab не змінює значення');
assert.strictEqual(changes, 1);
assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');

// 8) Space підтверджує так само, як Enter
press('ArrowDown'); // відкрити, активна c
press('ArrowUp');   // b
press(' ');
assert.strictEqual(select.value, 'b', 'Space підтверджує вибір');
assert.strictEqual(changes, 2);

// 9) Enter на закритому списку лише відкриває його
press('Enter');
assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
assert.strictEqual(select.value, 'b');
press('Escape');

console.log('custom-select-a11y: ok');
