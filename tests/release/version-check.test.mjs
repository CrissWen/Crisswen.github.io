import test from 'node:test';
import assert from 'node:assert/strict';
import { initVersionCheck } from '../../js/services/version-check.js';

function createHarness({ buildId = '1111aaaa', hash = '#/lobby', fetchPayloads = [] } = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const bodyChildren = [];
  let reloaded = false;
  let fetchCalls = 0;

  function makeBtn() {
    const listeners = new Map();
    return {
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); }
    };
  }

  const doc = {
    visibilityState: 'visible',
    querySelector(sel) {
      if (sel === 'meta[name="app-build-id"]') {
        return buildId ? { getAttribute: (k) => (k === 'content' ? buildId : null) } : null;
      }
      if (sel === '#update-banner') {
        return bodyChildren.find((el) => el.id === 'update-banner') || null;
      }
      return null;
    },
    createElement(tag) {
      const el = {
        tag,
        id: '',
        className: '',
        innerHTML: '',
        _listeners: new Map(),
        attrs: new Map(),
        setAttribute(k, v) { this.attrs.set(k, String(v)); },
        getAttribute(k) { return this.attrs.get(k) ?? null; },
        querySelector(sel) {
          if (sel === '[data-update-reload]') return this._reloadBtn || (this._reloadBtn = makeBtn());
          if (sel === '[data-update-dismiss]') return this._dismissBtn || (this._dismissBtn = makeBtn());
          return null;
        },
        remove() {
          const idx = bodyChildren.indexOf(this);
          if (idx !== -1) bodyChildren.splice(idx, 1);
        }
      };
      return el;
    },
    body: {
      appendChild(el) { bodyChildren.push(el); }
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatch(type) {
      for (const fn of [...(docListeners.get(type) || [])]) fn();
    }
  };

  const win = {
    location: {
      hash,
      reload() { reloaded = true; }
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatch(type) {
      for (const fn of [...(winListeners.get(type) || [])]) fn();
    }
  };

  const fetchImpl = async (url, opts) => {
    fetchCalls += 1;
    assert.equal(opts?.cache, 'no-store');
    assert.match(url, /^version\.json\?t=\d+$/);
    const next = fetchPayloads.shift();
    if (next instanceof Error) throw next;
    if (!next) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => next };
  };

  return { doc, win, fetchImpl, getFetchCalls: () => fetchCalls, isReloaded: () => reloaded };
}

test('initVersionCheck is a no-op when meta[name="app-build-id"] is absent (local dev)', async () => {
  const h = createHarness({ buildId: null, fetchPayloads: [{ buildId: '2222bbbb' }] });
  const ctl = initVersionCheck({ doc: h.doc, win: h.win, fetchImpl: h.fetchImpl });
  const changed = await ctl.checkNow();
  assert.equal(changed, false);
  assert.equal(h.getFetchCalls(), 0);
  assert.equal(h.doc.querySelector('#update-banner'), null);
});

test('initVersionCheck renders #update-banner on safe route when remote buildId differs and reloads on click', async () => {
  const h = createHarness({ buildId: '1111aaaa', hash: '#/lobby', fetchPayloads: [{ buildId: '2222bbbb', version: '1.0.1' }] });
  const ctl = initVersionCheck({ doc: h.doc, win: h.win, fetchImpl: h.fetchImpl });
  await ctl.checkNow();

  const banner = h.doc.querySelector('#update-banner');
  assert.ok(banner, 'banner should be mounted on #/lobby');
  assert.match(banner.innerHTML, /Доступне оновлення гри/);

  banner.querySelector('[data-update-reload]').click();
  assert.equal(h.isReloaded(), true);
  ctl.destroy();
});

test('initVersionCheck defers banner during #/game or #/pack-editor and shows it on hashchange to #/lobby', async () => {
  const h = createHarness({ buildId: '1111aaaa', hash: '#/game?room=ABCD', fetchPayloads: [{ buildId: '2222bbbb' }] });
  const ctl = initVersionCheck({ doc: h.doc, win: h.win, fetchImpl: h.fetchImpl });
  await ctl.checkNow();

  assert.equal(h.doc.querySelector('#update-banner'), null, 'must not interrupt active game');

  h.win.location.hash = '#/pack-editor';
  h.win.dispatch('hashchange');
  assert.equal(h.doc.querySelector('#update-banner'), null, 'must not interrupt pack editor');

  h.win.location.hash = '#/lobby';
  h.win.dispatch('hashchange');
  assert.ok(h.doc.querySelector('#update-banner'), 'banner appears once user returns to lobby');
  ctl.destroy();
});

test('initVersionCheck ignores network errors and throttles visibilitychange checks', async () => {
  const h = createHarness({
    buildId: '1111aaaa',
    hash: '#/lobby',
    fetchPayloads: [new Error('Network down'), { buildId: '1111aaaa' }, { buildId: '3333cccc' }]
  });
  const ctl = initVersionCheck({ doc: h.doc, win: h.win, fetchImpl: h.fetchImpl, minIntervalMs: 60_000 });

  const first = await ctl.checkNow();
  assert.equal(first, false);
  assert.equal(h.doc.querySelector('#update-banner'), null);

  await ctl.checkNow();
  assert.equal(h.getFetchCalls(), 2);

  h.doc.dispatch('visibilitychange');
  assert.equal(h.getFetchCalls(), 2, 'throttled within minIntervalMs');
  ctl.destroy();
});

test('initVersionCheck handles 404/invalid JSON, hides banner on entering #/game, and re-prompts after dismiss only on a newer buildId', async () => {
  const h = createHarness({
    buildId: '1111aaaa',
    hash: '#/lobby',
    fetchPayloads: [
      null, // 404 response
      { buildId: '2222bbbb' },
      { buildId: '2222bbbb' },
      { buildId: '3333cccc' }
    ]
  });
  const ctl = initVersionCheck({ doc: h.doc, win: h.win, fetchImpl: h.fetchImpl, minIntervalMs: 0 });

  // 404 -> no banner
  assert.equal(await ctl.checkNow(), false);
  assert.equal(h.doc.querySelector('#update-banner'), null);

  // New build 2222bbbb -> banner shown
  assert.equal(await ctl.checkNow(), true);
  assert.ok(h.doc.querySelector('#update-banner'));

  // Navigating into #/game removes the active banner
  h.win.location.hash = '#/game?room=1234';
  h.win.dispatch('hashchange');
  assert.equal(h.doc.querySelector('#update-banner'), null, 'banner hidden upon entering #/game');

  // Navigating back to #/lobby restores banner, then user clicks dismiss («Пізніше»)
  h.win.location.hash = '#/lobby';
  h.win.dispatch('hashchange');
  const banner = h.doc.querySelector('#update-banner');
  assert.ok(banner);
  banner.querySelector('[data-update-dismiss]').click();
  assert.equal(h.doc.querySelector('#update-banner'), null, 'dismiss removes banner');

  // Re-checking same build 2222bbbb stays dismissed
  await ctl.checkNow();
  assert.equal(h.doc.querySelector('#update-banner'), null);

  // visibilitychange with minIntervalMs: 0 fetches 3333cccc and re-shows banner
  h.doc.dispatch('visibilitychange');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(h.doc.querySelector('#update-banner'), 'newer buildId after dismiss re-shows banner');
  ctl.destroy();
});
