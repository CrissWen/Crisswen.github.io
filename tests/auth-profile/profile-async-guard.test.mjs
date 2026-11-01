import assert from 'node:assert';
import { register } from 'node:module';

// I-5: після виходу зі сторінки профілю (cleanupProfile) відкладені відповіді мережі
// не повинні писати в DOM, підписуватися на події чи міняти стан сторінки.

const STUBS = {
  '../services/game-history-service.js': `export const getCachedUserHistory = () => []; export const fetchUserGameHistory = () => globalThis.__fetchHistory(); export const checkRoomExists = async () => false; export const fetchRoomDataForExport = async () => null;`,
  '../services/replay-service.js': `export const exportGameReplay = () => {}; export const readReplayFile = async () => ({}); export const launchOfflineReplay = () => {};`,
  '../game-modules/overlays/global-toast.js': `export const showGlobalToast = () => {};`,
  '../services/supabase.js': `
    export const supabase = {
      auth: { getSession: () => globalThis.__getSession() },
      from: () => { const c = { select: () => c, eq: () => c, maybeSingle: () => globalThis.__maybeSingle() }; return c; }
    };`,
  '../utils/theme-manager.js': `export const THEMES = []; export const getCurrentTheme = () => 'classic'; export const setTheme = () => {}; export const onThemeChange = () => () => {};`,
  '../services/avatar-service.js': `
    globalThis.__avatarSubs = 0;
    export const fetchAvatars = async () => 0; export const getCachedAvatar = () => null; export const hasCachedAvatar = () => true;
    export const isAvatarStale = () => false; export const uploadAvatar = async () => ''; export const removeAvatar = async () => {};
    export const onAvatarChange = (cb) => { globalThis.__avatarSubs++; let on = true; return () => { if (on) { on = false; globalThis.__avatarSubs--; } }; };`,
  '../utils/avatar.js': `export const setAvatarEl = () => {}; export const applyAvatarLetterPadding = () => {};`,
  '../ui/avatar-cropper-modal.js': `export const openAvatarCropper = async () => null;`,
  '../utils/security.js': `export const esc = s => String(s);`,
  '../services/sound-manager.js': `
    export const AUDIO_CHANNELS = { MASTER: 'master', SFX: 'sfx', UI: 'ui', MUSIC: 'music' };
    export const SOUND_IDS = { BUNKER_AMBIENT: 'ambient', DICE_ROLL: 'dice', UI_CLICK: 'click' };
    export const soundManager = { getSettings: () => ({ masterVolume: 1, sfxVolume: 1, uiVolume: 1, musicVolume: 1 }), isPlaying: () => false,
      stop() {}, play() {}, subscribe: () => () => {}, isMuted: () => false };`,
  '../ui/range-slider.js': `export const initRangeSliders = () => {}; export const setRangeSliderValue = () => {};`,
  '../constants/icons.js': `export const ICONS = new Proxy({}, { get: () => 'icon.svg' });`
};
const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.endsWith('/pages/profile.js') && STUBS[specifier]) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

// ===== Мінімальний DOM, що запам'ятовує записи =====
class FakeNode {
  constructor(dataset = {}) {
    this.style = {};
    this.dataset = dataset;
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.hidden = false;
    this.disabled = false;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  focus() {}
  closest() { return null; }
}
let nodes = new Map();
let statNodes = new Map();
let tabs = [];
const getNode = id => { if (!nodes.has(id)) nodes.set(id, new FakeNode()); return nodes.get(id); };
globalThis.document = {
  getElementById: getNode,
  querySelector: sel => {
    if (!sel.startsWith('[data-stat')) return null;
    if (!statNodes.has(sel)) statNodes.set(sel, new FakeNode());
    return statNodes.get(sel);
  },
  querySelectorAll: sel => (sel === '.profile-tab' ? tabs : [])
};
globalThis.window = { location: { hash: '' } };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const SESSION = { user: { id: 'u1', user_metadata: { username: 'Тест' }, created_at: '2026-01-01' } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 0));
async function until(cond, label) {
  for (let i = 0; i < 100; i++) { if (cond()) return; await tick(); }
  throw new Error(`не дочекались: ${label}`);
}

const { initProfile, cleanupProfile, selectProfileTab } = await import('../../js/pages/profile.js');
const runInit = () => initProfile().catch(() => {});

let failed = 0;
async function check(name, fn) {
  try {
    cleanupProfile();
    nodes = new Map();
    statNodes = new Map();
    tabs = [new FakeNode({ tab: 'profile' }), new FakeNode({ tab: 'history' })];
    globalThis.__avatarSubs = 0;
    globalThis.window.location.hash = '';
    globalThis.__getSession = async () => ({ data: { session: SESSION } });
    globalThis.__maybeSingle = async () => ({ data: null, error: null });
    globalThis.__fetchHistory = async () => [];
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('Running profile-async-guard tests...');

await check('I-5: вихід до відповіді getSession — без запису імені, підписок і редіректу', async () => {
  const session = deferred();
  globalThis.__getSession = () => session.promise;
  const init = runInit();
  await tick();
  cleanupProfile();
  session.resolve({ data: { session: SESSION } });
  await init;
  assert.strictEqual(getNode('profile-page-name').textContent, '', 'ім’я записано в DOM після виходу зі сторінки');
  assert.strictEqual(globalThis.__avatarSubs, 0, 'після виходу з’явилась нова підписка на аватарку');
});

await check('I-5: вихід до відповіді getSession без сесії — без редіректу на логін', async () => {
  const session = deferred();
  globalThis.__getSession = () => session.promise;
  const init = runInit();
  await tick();
  cleanupProfile();
  session.resolve({ data: { session: null } });
  await init;
  assert.strictEqual(globalThis.window.location.hash, '', 'застарілий initProfile перекинув користувача на #/login');
});

await check('I-5: вихід під час запиту статистики — DOM статистики не оновлюється', async () => {
  const stats = deferred();
  let called = false;
  globalThis.__maybeSingle = () => { called = true; return stats.promise; };
  const init = runInit();
  await until(() => called, 'запит статистики');
  cleanupProfile();
  stats.resolve({ data: { created_at: '2026-01-01', games_played: 5, games_won: 2, avatar_url: null }, error: null });
  await init;
  const played = document.querySelector('[data-stat="games_played"]');
  assert.notStrictEqual(played.textContent, 5, 'застаріла відповідь перезаписала статистику після виходу');
  assert.notStrictEqual(String(played.textContent), '5');
});

await check('I-5: вихід під час завантаження історії — список не рендериться', async () => {
  const history = deferred();
  globalThis.__fetchHistory = () => history.promise;
  await runInit();
  selectProfileTab('history');
  const container = getNode('profile-history-content');
  container.innerHTML = '';
  cleanupProfile();
  history.resolve([{ survived: true, room_code: 'ABCD', played_at: '2026-01-01', cataclysm_title: 'X', profession_title: 'Y' }]);
  await tick();
  await tick();
  assert.strictEqual(container.innerHTML, '', 'історія відрендерилась після виходу зі сторінки');
});

await check('регресія: без виходу статистика та історія оновлюються як раніше', async () => {
  const stats = deferred();
  let called = false;
  globalThis.__maybeSingle = () => { called = true; return stats.promise; };
  const init = runInit();
  await until(() => called, 'запит статистики');
  stats.resolve({ data: { created_at: '2026-01-01', games_played: 5, games_won: 2, avatar_url: null }, error: null });
  await init;
  assert.strictEqual(String(document.querySelector('[data-stat="games_played"]').textContent), '5');
  assert.strictEqual(getNode('profile-page-name').textContent, 'Тест');
});

await check('регресія: історія рендериться, поки сторінка жива', async () => {
  const history = deferred();
  globalThis.__fetchHistory = () => history.promise;
  await runInit();
  selectProfileTab('history');
  history.resolve([{ survived: true, room_code: 'ABCD', played_at: '2026-01-01', cataclysm_title: 'X', profession_title: 'Y' }]);
  await tick();
  await tick();
  assert.ok(getNode('profile-history-content').innerHTML.includes('history-card'), 'історія не відрендерилась');
});

if (failed) {
  console.error(`FAIL: profile-async-guard (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all profile-async-guard tests passed!');
process.exit(0);
