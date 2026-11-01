import assert from 'node:assert';
import { register } from 'node:module';

// ===== Підміна залежностей profile.js: рахуємо активні підписки на аватарку =====
const noop = 'export default null;';
const STUBS = {
  '../services/game-history-service.js': `export const getCachedUserHistory = () => []; export const fetchUserGameHistory = async () => []; export const checkRoomExists = async () => false; export const fetchRoomDataForExport = async () => null;`,
  '../services/replay-service.js': `export const exportGameReplay = () => {}; export const readReplayFile = async () => ({}); export const launchOfflineReplay = () => {};`,
  '../game-modules/overlays/global-toast.js': `export const showGlobalToast = () => {};`,
  '../services/supabase.js': `
    const chain = () => new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : chain()), apply: () => chain() });
    export const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', user_metadata: { username: 'Тест' }, created_at: '2026-01-01' } } } }) }, from: () => chain() };`,
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

// ===== Мінімальний DOM: будь-який id повертає вузол, списки порожні =====
class FakeNode {
  constructor() {
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  closest() { return null; }
}
const nodes = new Map();
globalThis.document = {
  getElementById: id => { if (!nodes.has(id)) nodes.set(id, new FakeNode()); return nodes.get(id); },
  querySelector: () => null,
  querySelectorAll: () => []
};
globalThis.window = { location: { hash: '' } };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { initProfile, cleanupProfile } = await import('../js/pages/profile.js');

// initProfile асинхронний і далі за точку підписки може впасти на спрощеному DOM: для цього тесту важлива лише підписка
const runInit = () => initProfile().catch(() => {});

let failed = 0;
async function check(name, fn) {
  try {
    cleanupProfile();
    globalThis.__avatarSubs = 0;
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log('Running profile-cleanup tests...');

await check('initProfile підписується на зміни аватарки рівно один раз', async () => {
  await runInit();
  assert.strictEqual(globalThis.__avatarSubs, 1);
});

await check('P-C2: cleanupProfile знімає підписку на аватарку', async () => {
  await runInit();
  cleanupProfile();
  assert.strictEqual(globalThis.__avatarSubs, 0, 'підписка onAvatarChange витікає після виходу зі сторінки');
});

await check('P-C2: повторні заходи в профіль не накопичують підписки', async () => {
  await runInit();
  await runInit();
  await runInit();
  assert.strictEqual(globalThis.__avatarSubs, 1, `активних підписок: ${globalThis.__avatarSubs}`);
  cleanupProfile();
  assert.strictEqual(globalThis.__avatarSubs, 0);
});

if (failed) {
  console.error(`FAIL: profile-cleanup (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all profile-cleanup tests passed!');
process.exit(0);
