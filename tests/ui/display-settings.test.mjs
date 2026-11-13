import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ===== Режим LDM: ручний перемикач, вимкнений за замовчуванням, без автовизначення =====

const root = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const read = (rel) => readFileSync(root(rel), 'utf8');

// Мінімальні заглушки браузера (Node їх не має). defineProperty — бо в новіших Node `localStorage` може вже існувати.
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    _data: data,
  };
}

function makeClassList() {
  const set = new Set();
  return {
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    contains: (name) => set.has(name),
  };
}

test('LDM вимкнений за замовчуванням, коли сховища немає (приватний режим / Node)', async () => {
  const fresh = await import('../../js/services/display-settings.js?no-storage');
  assert.equal(fresh.isLdmEnabled(), false);
});

// Далі — спільний екземпляр модуля з фейковим середовищем
const storage = makeStorage();
const listeners = {};
const htmlClassList = makeClassList();
defineGlobal('localStorage', storage);
defineGlobal('document', { documentElement: { classList: htmlClassList } });
defineGlobal('window', {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  // Імітуємо пристрій, який «просить» зменшити анімацію: автовмикання LDM від цього бути не повинно
  matchMedia: (query) => ({ matches: query.includes('prefers-reduced-motion') }),
});
defineGlobal('navigator', { deviceMemory: 1, hardwareConcurrency: 1, connection: { saveData: true } });

const settings = await import('../../js/services/display-settings.js');
const { resolveReelMode } = await import('../../js/ui/roulette-reel.js');

test('слабке залізо, saveData і «зменшити анімацію» НЕ вмикають LDM самі', async () => {
  settings.initDisplaySettings();
  assert.equal(settings.isLdmEnabled(), false);
  assert.equal(htmlClassList.contains('ldm'), false);
  assert.equal(await resolveReelMode({ preference: 'auto' }), 'full');
  assert.equal(await resolveReelMode({ preference: 'full' }), 'full');
  assert.equal(await resolveReelMode(), 'full');
});

test('конфіг гри може примусово вимкнути ефекти для всіх (mode: light)', async () => {
  assert.equal(await resolveReelMode({ preference: 'light' }), 'light');
});

test('setLdmEnabled(true): зберігає, ставить клас на <html>, сповіщає і вмикає light-режим рулетки', async () => {
  const seen = [];
  const off = settings.onLdmChange((v) => seen.push(v));

  settings.setLdmEnabled(true);
  assert.equal(settings.isLdmEnabled(), true);
  assert.equal(storage.getItem(settings.LDM_STORAGE_KEY), '1');
  assert.equal(htmlClassList.contains(settings.LDM_CLASS), true);
  assert.equal(await resolveReelMode({ preference: 'full' }), 'light');
  assert.equal(await resolveReelMode({ preference: 'auto' }), 'light');

  settings.setLdmEnabled(true); // повтор без змін не сповіщає вдруге
  settings.setLdmEnabled(false);
  assert.equal(settings.isLdmEnabled(), false);
  assert.equal(storage.getItem(settings.LDM_STORAGE_KEY), '0');
  assert.equal(htmlClassList.contains(settings.LDM_CLASS), false);
  assert.equal(await resolveReelMode({ preference: 'full' }), 'full');
  assert.deepEqual(seen, [true, false]);

  off();
  settings.setLdmEnabled(true);
  assert.deepEqual(seen, [true, false], 'після відписки слухач більше не викликається');
  settings.setLdmEnabled(false);
});

test('зміна в іншій вкладці (подія storage) синхронізує LDM без повторного запису', () => {
  assert.equal(typeof listeners.storage, 'function', 'initDisplaySettings має підписатися на storage');

  storage.setItem(settings.LDM_STORAGE_KEY, '1');
  listeners.storage({ key: settings.LDM_STORAGE_KEY });
  assert.equal(settings.isLdmEnabled(), true);
  assert.equal(htmlClassList.contains('ldm'), true);

  storage.setItem(settings.LDM_STORAGE_KEY, '0');
  listeners.storage({ key: settings.LDM_STORAGE_KEY });
  assert.equal(settings.isLdmEnabled(), false);

  listeners.storage({ key: 'bunker-theme' }); // чужий ключ ігнорується
  assert.equal(settings.isLdmEnabled(), false);
});

test('initDisplaySettings підтягує збережене «1» і ставить клас', () => {
  storage.setItem(settings.LDM_STORAGE_KEY, '1');
  settings.initDisplaySettings();
  assert.equal(settings.isLdmEnabled(), true);
  assert.equal(htmlClassList.contains('ldm'), true);
  settings.setLdmEnabled(false);
});

test('автовизначення прибрано: у roulette-reel.js немає виміру FPS, кешу сесії й апаратних підказок', () => {
  const src = read('js/ui/roulette-reel.js');
  for (const banned of ['measureFrameRate', 'deviceMemory', 'hardwareConcurrency', 'saveData', 'bunker-roulette-auto-mode', 'sessionStorage']) {
    assert.ok(!src.includes(banned), `у roulette-reel.js лишилось автовизначення: ${banned}`);
  }
});

test('конфіг гри за замовчуванням — повний режим, не auto', () => {
  const src = read('js/config/game-config.base.js');
  assert.match(src, /mode:\s*'full'/);
  assert.ok(!/mode:\s*'auto'/.test(src));
});

test('index.html: ldm.css підключено останнім, inline-скрипт збігається з ключем і класом сервісу', () => {
  const html = read('index.html');
  const links = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
  assert.equal(links.at(-1), 'css/ldm.css', 'ldm.css має бути останнім стилем');
  assert.ok(html.includes(`localStorage.getItem('${settings.LDM_STORAGE_KEY}') === '1'`), 'ключ в inline-скрипті розійшовся з display-settings.js');
  assert.ok(html.includes(`classList.add('${settings.LDM_CLASS}')`), 'клас в inline-скрипті розійшовся з display-settings.js');
});

test('ldm.css: усі правила під html.ldm, цифру кубика і смужку прогресу не ховає', () => {
  const css = read('css/ldm.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
  for (const group of selectors) {
    for (const sel of group.split(',').map(s => s.trim()).filter(Boolean)) {
      assert.ok(sel.startsWith('html.ldm'), `правило поза html.ldm зачепить усіх: ${sel}`);
    }
  }
  assert.ok(!/\.rr-progress/.test(css), 'смужка прогресу — це вигляд LDM рулетки, її не вимикаємо');
  assert.match(css, /\.dice-overlay\.is-revealed \.dice span[\s\S]*?opacity:\s*1/, 'цифра кубика має показуватися без анімації');
});

test('профіль: тумблер LDM є, і він під вкладкою «Вигляд»', () => {
  const src = read('js/pages/profile.js');
  assert.ok(src.includes('id="profile-ldm-toggle"'));
  assert.ok(src.includes('setLdmEnabled(ldmToggle.checked)'));
  assert.ok(src.includes('unsubscribeProfileLdm'), 'підписку на LDM треба знімати в cleanupProfile');
  assert.match(src, /data-tab="themes"[^>]*>Вигляд</);
});

test('усі ефекти, що мали гілку для «зменшити анімацію», враховують і LDM', () => {
  for (const file of ['js/ui/bunker-airlock.js', 'js/fx/bunker-transition.js', 'js/ui/roulette-overlay.js', 'js/game-modules/overlays/dice-overlay.js', 'js/ui/site-footer.js']) {
    assert.ok(read(file).includes('isLdmEnabled'), `${file} не підключений до LDM`);
  }
});
