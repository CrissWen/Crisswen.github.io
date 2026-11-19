import test from 'node:test';
import assert from 'node:assert/strict';

function setupDom() {
  const byId = new Map();
  const allElements = [];

  class FakeClassList {
    constructor(el) {
      this.el = el;
      this.set = new Set();
    }
    _syncFromString(str) {
      this.set = new Set(String(str || '').split(/\s+/).filter(Boolean));
    }
    add(...cls) { cls.forEach(c => this.set.add(c)); }
    remove(...cls) { cls.forEach(c => this.set.delete(c)); }
    toggle(c, force) {
      if (force === undefined) {
        if (this.set.has(c)) { this.set.delete(c); return false; }
        this.set.add(c); return true;
      }
      if (force) this.set.add(c); else this.set.delete(c);
      return Boolean(force);
    }
    contains(c) { return this.set.has(c); }
    toString() { return Array.from(this.set).join(' '); }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.classList = new FakeClassList(this);
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this._id = '';
      this._textContent = '';
      this._innerHTML = '';
      allElements.push(this);
    }
    get id() { return this._id; }
    set id(val) {
      if (this._id) byId.delete(this._id);
      this._id = String(val || '');
      if (this._id) byId.set(this._id, this);
    }
    get className() { return this.classList.toString(); }
    set className(val) { this.classList._syncFromString(val); }
    get textContent() {
      if (this.children.length) return this.children.map(c => c.textContent).join('');
      return this._textContent;
    }
    set textContent(val) {
      this.children = [];
      this._textContent = String(val ?? '');
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
      this.children = [];
      this._innerHTML = String(val ?? '');
    }
    setAttribute(name, val) {
      const s = String(val);
      this.attributes.set(name, s);
      if (name === 'id') this.id = s;
      else if (name === 'class') this.className = s;
      else if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = s;
      }
    }
    getAttribute(name) {
      if (name === 'id') return this._id || null;
      if (name === 'class') return this.className || null;
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    get control() {
      if (this.tagName !== 'LABEL') return null;
      const f = this.getAttribute('for');
      return f ? (byId.get(f) || null) : null;
    }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'id') this.id = '';
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    insertBefore(newNode, refNode) {
      newNode.parentNode = this;
      const idx = this.children.indexOf(refNode);
      if (idx === -1) this.children.push(newNode);
      else this.children.splice(idx, 0, newNode);
      return newNode;
    }
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
        this.parentNode = null;
      }
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(evt) {
      evt.target = evt.target || this;
      evt.stopPropagation = evt.stopPropagation || (() => {});
      evt.preventDefault = evt.preventDefault || (() => {});
      const list = this.listeners.get(evt.type) || [];
      for (const fn of list) fn(evt);
    }
    focus() {}
    scrollIntoView() {}
    getBoundingClientRect() { return { top: 100, bottom: 140 }; }
    closest(selector) {
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      const tag = !cls ? selector.toUpperCase() : null;
      let cur = this;
      while (cur) {
        if (cls && cur.classList?.contains(cls)) return cur;
        if (tag && cur.tagName === tag) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const results = [];
      const visit = (node) => {
        for (const ch of node.children || []) {
          if (matchesSelector(ch, selector)) results.push(ch);
          visit(ch);
        }
      };
      visit(this);
      return results;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  function matchesSelector(el, selector) {
    return selector.split(',').some(part => {
      const s = part.trim();
      if (s.startsWith('.')) return el.classList?.contains(s.slice(1).split(':')[0]);
      const m = s.match(/^label\[for="(.+)"\]$/);
      if (m) return el.tagName === 'LABEL' && el.getAttribute('for') === m[1];
      return el.tagName === s.toUpperCase();
    });
  }

  class FakeSelectElement extends FakeElement {
    constructor() {
      super('select');
      this._value = '';
    }
    get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
    get value() {
      if (this._value) return this._value;
      const sel = this.options.find(o => o.selected);
      return sel ? sel.value : (this.options[0]?.value ?? '');
    }
    set value(v) {
      this._value = String(v ?? '');
    }
  }

  const root = new FakeElement('div');
  const docListeners = new Map();
  const doc = {
    readyState: 'complete',
    ownerDocument: null,
    createElement: (tag) => tag.toLowerCase() === 'select' ? new FakeSelectElement() : new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchEvent: (evt) => {
      for (const fn of docListeners.get(evt.type) || []) fn(evt);
    }
  };

  globalThis.document = doc;
  globalThis.window = { innerHeight: 800 };
  globalThis.HTMLSelectElement = FakeSelectElement;
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  return { root, doc, FakeElement, FakeSelectElement };
}

test('initCustomSelect retargets label[for] to button id and closes .pe-combo__dropdown on click', async () => {
  const { root, doc, FakeElement } = setupDom();
  const { initCustomSelect } = await import('../../js/ui/custom-select.js');

  const field = new FakeElement('div');
  field.className = 'pe-field';

  const label = new FakeElement('label');
  label.setAttribute('for', 'pe-dyn-custom_age_mode');

  const selectEl = doc.createElement('select');
  selectEl.id = 'pe-dyn-custom_age_mode';
  selectEl.className = 'pe-select-custom';
  const opt1 = new FakeElement('option');
  opt1.value = '';
  opt1.textContent = 'Default';
  const opt2 = new FakeElement('option');
  opt2.value = 'no_age';
  opt2.textContent = 'No age';
  selectEl.appendChild(opt1);
  selectEl.appendChild(opt2);

  field.appendChild(label);
  field.appendChild(selectEl);
  root.appendChild(field);

  const comboDrop = new FakeElement('div');
  comboDrop.className = 'pe-combo__dropdown';
  comboDrop.hidden = false;
  const comboToggle = new FakeElement('button');
  comboToggle.className = 'pe-combo__toggle is-open';
  root.appendChild(comboDrop);
  root.appendChild(comboToggle);

  const wrap = initCustomSelect(selectEl);
  const btn = wrap.querySelector('.pe-select-custom__btn');

  assert.equal(btn.id, 'pe-dyn-custom_age_mode-btn');
  assert.equal(label.getAttribute('for'), 'pe-dyn-custom_age_mode-btn');

  btn.dispatchEvent({ type: 'click' });
  assert.equal(comboDrop.hidden, true);
  assert.equal(comboToggle.classList.contains('is-open'), false);

  // Clicking <label for="...-btn"> while dropdown is open must toggle it CLOSED (not close+reopen)
  const drop = wrap.querySelector('.pe-select-custom__dropdown');
  assert.equal(drop.hidden, false);
  doc.dispatchEvent({ type: 'click', target: label });
  btn.dispatchEvent({ type: 'click' });
  assert.equal(drop.hidden, true, 'label click while open should close dropdown');

  // Programmatic value & disabled sync (FIELD_CODECS.select / toggleField contract)
  selectEl.value = 'no_age';
  assert.equal(wrap.querySelector('.pe-select-custom__label').textContent, 'No age');
  selectEl.disabled = true;
  selectEl.value = '';
  assert.equal(btn.disabled, true);
  assert.equal(wrap.querySelector('.pe-select-custom__label').textContent, 'Default');

  selectEl._customSelect.destroy();
  assert.equal(label.getAttribute('for'), 'pe-dyn-custom_age_mode');
});
