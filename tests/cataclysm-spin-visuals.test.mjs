import assert from 'node:assert';
import { register } from 'node:module';

// I-10: візуальні параметри стрічки (maxFillers, fillerZone, easingPower, suspense) раніше читались із ЛОКАЛЬНОГО конфігу кожного клієнта,
// тож гравці з різними налаштуваннями бачили різні стрічки. Тепер їх записує хост у cataclysm_spin.viz, а клієнти беруть звідти.

const RULES = [
  { parent: '/overlays/cataclysm-roulette.js', spec: '../../services/server-time.js', src: 'export const getGlobalTime = () => 1000;' },
  { parent: '/overlays/cataclysm-roulette.js', spec: '../../config/config-manager.js', src: 'export const getGameConfig = async () => globalThis.__cfg;' },
  { parent: '/overlays/cataclysm-roulette.js', spec: '../../constants/icons.js', src: "export const ICONS = { HAZARD: './icons/hazard.svg' };" },
  { parent: '/overlays/cataclysm-roulette.js', spec: '../../constants/catastrophe-icons.js',
    src: "export const CATASTROPHE_ICONS_LIST = Array.from({ length: 60 }, (_, i) => ({ path: 'icons/c' + i + '.svg' }));" },
  { parent: '/overlays/cataclysm-roulette.js', spec: '../../ui/roulette-overlay.js',
    src: 'export const playRouletteOverlay = async (o) => { globalThis.__overlayOpts = o; return true; }; export const hideRouletteOverlay = () => {}; export const isRouletteOverlayShown = () => false; export const primeRouletteAudio = () => {};' },
  { parent: '/utils/cataclysm-spin.js', spec: '../config/config-manager.js', src: 'export const getGameConfig = async () => globalThis.__cfg;' },
  { parent: '/utils/cataclysm-spin.js', spec: './cataclysm-detector.js', src: 'export const detectCataclysmIcon = () => null;' },
];
const hooksSource = `
  const RULES = ${JSON.stringify(RULES)};
  export async function resolve(specifier, context, next) {
    const rule = RULES.find(r => context.parentURL && context.parentURL.endsWith(r.parent) && specifier === r.spec);
    if (rule) return { url: 'data:text/javascript,' + encodeURIComponent(rule.src), shortCircuit: true };
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

const spinMod = await import('../js/utils/cataclysm-spin.js');
const { playCataclysmRoulette } = await import('../js/game-modules/overlays/cataclysm-roulette.js');

const HOST = { enabled: true, durationMs: 5000, startLeadMs: 1500, holdAfterMs: 3000, easingPower: 4, fillerZone: 0.4, maxFillers: 17, suspense: { holdMs: 300 }, mode: 'full' };
const CLIENT_A = { ...HOST, easingPower: 2, fillerZone: 0.1, maxFillers: 3, suspense: false, mode: 'light', sounds: { volume: 0.1 } };
const CLIENT_B = { ...HOST, easingPower: 6, fillerZone: 0.9, maxFillers: 50, suspense: true, mode: 'auto', sounds: { volume: 0.9 } };

const pool = ['./icons/p1.svg', './icons/p2.svg', './icons/p3.svg'];
const baseSpin = (extra = {}) => ({ id: 1, started_at: 2000, duration_ms: 5000, hold_ms: 3000, stop_index: 40, seed: 12345, pool, result: pool[1], title: 'Тест', ...extra });

let failed = 0;
async function check(name, fn) {
  try { globalThis.__overlayOpts = null; await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}
async function reelFor(clientCfg, spin) {
  globalThis.__cfg = { cataclysmRoulette: clientCfg };
  globalThis.__overlayOpts = null;
  await playCataclysmRoulette(spin);
  assert.ok(globalThis.__overlayOpts, 'рулетку не було показано');
  return globalThis.__overlayOpts;
}

console.log('Running cataclysm-spin-visuals tests...');

await check('хост записує візуальні параметри стрічки у cataclysm_spin.viz', async () => {
  globalThis.__cfg = { cataclysmRoulette: HOST };
  const state = { cataclysm: { icon: './icons/p2.svg', text: 'Тест' } };
  const spin = await spinMod.attachCataclysmSpin(state, [], 1000);
  assert.ok(spin && spin.viz && typeof spin.viz === 'object', 'очікували spin.viz');
  assert.strictEqual(spin.viz.maxFillers, 17);
  assert.strictEqual(spin.viz.fillerZone, 0.4);
  assert.strictEqual(spin.viz.easingPower, 4);
  assert.deepStrictEqual(spin.viz.suspense, { holdMs: 300 });
  assert.strictEqual(state.cataclysm_spin.viz, spin.viz);
});

await check('клієнти з різними локальними налаштуваннями отримують ОДНАКОВУ стрічку', async () => {
  const viz = { maxFillers: 17, fillerZone: 0.4, easingPower: 4, suspense: { holdMs: 300 } };
  const a = await reelFor(CLIENT_A, baseSpin({ viz }));
  const b = await reelFor(CLIENT_B, baseSpin({ viz }));
  assert.strictEqual(a.reel.fillers.length, 17, 'кількість «фільтрів» має бути від хоста');
  assert.deepStrictEqual(a.reel.fillers, b.reel.fillers);
  assert.strictEqual(a.reel.easingPower, 4);
  assert.strictEqual(b.reel.easingPower, 4);
  assert.strictEqual(a.reel.fillerZone, 0.4);
  assert.strictEqual(b.reel.fillerZone, 0.4);
  assert.deepStrictEqual(a.reel.suspense, { holdMs: 300 });
  assert.deepStrictEqual(b.reel.suspense, { holdMs: 300 });
});

await check('локальні налаштування звуку та режиму (LDM) лишаються за клієнтом', async () => {
  const viz = { maxFillers: 17, fillerZone: 0.4, easingPower: 4, suspense: true };
  const a = await reelFor(CLIENT_A, baseSpin({ viz }));
  const b = await reelFor(CLIENT_B, baseSpin({ viz }));
  assert.strictEqual(a.mode, 'light');
  assert.strictEqual(b.mode, 'auto');
  assert.strictEqual(a.sounds.volume, 0.1);
  assert.strictEqual(b.sounds.volume, 0.9);
});

await check('старий спін без viz: відкат на локальний конфіг (сумісність)', async () => {
  const a = await reelFor(CLIENT_A, baseSpin());
  assert.strictEqual(a.reel.fillers.length, 3);
  assert.strictEqual(a.reel.easingPower, 2);
  assert.strictEqual(a.reel.fillerZone, 0.1);
});

await check('підроблений viz обмежується допустимими межами', async () => {
  const a = await reelFor(CLIENT_A, baseSpin({ viz: { maxFillers: 1e9, fillerZone: 7, easingPower: -5, suspense: 'x' } }));
  assert.ok(a.reel.fillers.length <= 60, `фільтрів забагато: ${a.reel.fillers.length}`);
  assert.ok(a.reel.fillerZone <= 1 && a.reel.fillerZone >= 0);
  assert.ok(a.reel.easingPower >= 1.5 && a.reel.easingPower <= 6);
  assert.ok(typeof a.reel.suspense === 'boolean' || typeof a.reel.suspense === 'object');
});

await check('частковий viz доповнюється локальним конфігом', async () => {
  const a = await reelFor(CLIENT_A, baseSpin({ viz: { maxFillers: 9 } }));
  assert.strictEqual(a.reel.fillers.length, 9);
  assert.strictEqual(a.reel.easingPower, 2, 'відсутні поля беруться з локального конфігу');
});

for (const bad of ['text', 42, [], null, true]) {
  await check(`viz некоректного типу (${JSON.stringify(bad)}) ігнорується`, async () => {
    const a = await reelFor(CLIENT_A, baseSpin({ viz: bad }));
    assert.strictEqual(a.reel.fillers.length, 3);
    assert.strictEqual(a.reel.easingPower, 2);
  });
}

await check('resolveSpinVisuals віддає лише візуальні поля', async () => {
  const v = spinMod.resolveSpinVisuals(baseSpin({ viz: { maxFillers: 5, secret: 'x', durationMs: 99999 } }), { ...HOST });
  assert.deepStrictEqual(Object.keys(v).sort(), ['easingPower', 'fillerZone', 'maxFillers', 'suspense']);
  assert.strictEqual(v.maxFillers, 5);
});

if (failed) {
  console.error(`FAIL: cataclysm-spin-visuals (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all cataclysm-spin-visuals tests passed!');
process.exit(0);
