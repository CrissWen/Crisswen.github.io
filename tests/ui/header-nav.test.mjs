import assert from 'node:assert';
import test from 'node:test';
import { initHeaderNav, closeHeaderNav } from '../../js/ui/header-nav.js';

function makeMockElement(tag = 'div') {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  return {
    tag,
    _focused: false,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) { classes.delete(c); return false; }
          classes.add(c); return true;
        }
        if (force) classes.add(c); else classes.delete(c);
        return Boolean(force);
      },
      contains(c) { return classes.has(c); }
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatch(type, event = {}) {
      for (const fn of [...(listeners.get(type) || [])]) fn(event);
    },
    focus() { this._focused = true; },
    contains(target) { return target === this || (this._children || []).includes(target); },
    closest(sel) { return sel === '.header-nav-link' && classes.has('header-nav-link') ? this : null; }
  };
}

function setupHarness() {
  const headerEl = makeMockElement('header');
  const toggleBtn = makeMockElement('button');
  const navEl = makeMockElement('nav');
  const linkEl = makeMockElement('a');
  linkEl.classList.add('header-nav-link');
  const outsideEl = makeMockElement('div');

  navEl._children = [linkEl];
  headerEl._children = [toggleBtn, navEl, linkEl];

  const doc = makeMockElement('document');
  const win = makeMockElement('window');

  const ctrl = initHeaderNav({ headerEl, toggleBtn, navEl, doc, win });
  return { headerEl, toggleBtn, navEl, linkEl, outsideEl, doc, win, ctrl };
}

test('toggleBtn click opens and closes nav and syncs aria-expanded', () => {
  const { headerEl, toggleBtn, ctrl } = setupHarness();
  assert.strictEqual(ctrl.isOpen(), false);
  assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'false');

  toggleBtn.dispatch('click', { stopPropagation() {} });
  assert.strictEqual(ctrl.isOpen(), true);
  assert.strictEqual(headerEl.classList.contains('is-nav-open'), true);
  assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'true');

  toggleBtn.dispatch('click', { stopPropagation() {} });
  assert.strictEqual(ctrl.isOpen(), false);
  assert.strictEqual(headerEl.classList.contains('is-nav-open'), false);
  assert.strictEqual(toggleBtn.getAttribute('aria-expanded'), 'false');
  ctrl.destroy();
});

test('clicking a nav link closes the open menu', () => {
  const { navEl, linkEl, ctrl } = setupHarness();
  ctrl.open();
  assert.strictEqual(ctrl.isOpen(), true);

  navEl.dispatch('click', { target: linkEl });
  assert.strictEqual(ctrl.isOpen(), false);
  ctrl.destroy();
});

test('pointerdown outside header closes menu; pointerdown inside header keeps it open', () => {
  const { headerEl, outsideEl, doc, ctrl } = setupHarness();
  ctrl.open();

  doc.dispatch('pointerdown', { target: headerEl });
  assert.strictEqual(ctrl.isOpen(), true);

  doc.dispatch('pointerdown', { target: outsideEl });
  assert.strictEqual(ctrl.isOpen(), false);
  ctrl.destroy();
});

test('Escape key closes menu and returns focus to toggleBtn; hashchange and closeHeaderNav close menu', () => {
  const { toggleBtn, doc, win, ctrl } = setupHarness();
  ctrl.open();
  doc.dispatch('keydown', { key: 'Escape' });
  assert.strictEqual(ctrl.isOpen(), false);
  assert.strictEqual(toggleBtn._focused, true);

  ctrl.open();
  win.dispatch('hashchange');
  assert.strictEqual(ctrl.isOpen(), false);

  ctrl.open();
  closeHeaderNav();
  assert.strictEqual(ctrl.isOpen(), false);
  ctrl.destroy();
});

test('initHeaderNav returns safe no-op controller when required elements are missing', () => {
  const ctrl = initHeaderNav({ headerEl: null, toggleBtn: null, navEl: null });
  assert.strictEqual(ctrl.isOpen(), false);
  ctrl.open();
  ctrl.close();
  ctrl.toggle();
  closeHeaderNav();
  ctrl.destroy();
});
