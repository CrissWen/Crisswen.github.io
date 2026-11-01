import { getGlobalTime } from '../../services/server-time.js';
import { getGameConfig } from '../../config/config-manager.js';
import { ICONS } from '../../constants/icons.js';
import { CATASTROPHE_ICONS_LIST } from '../../constants/catastrophe-icons.js';
import { createRng } from '../../utils/roulette/roulette-ribbon.js';
import { getSpinTimeline, sanitizeIconPath, resolveSpinVisuals } from '../../utils/roulette/cataclysm-spin.js';
import { normalizeRouletteConfig } from '../../utils/roulette/roulette-config.js';
import { playRouletteOverlay, hideRouletteOverlay, isRouletteOverlayShown, primeRouletteAudio } from '../../ui/roulette-overlay.js';

// ===== Рулетка катаклізму =====
// Показується всім клієнтам кімнати за записом bunker_state.cataclysm_spin (див. utils/cataclysm-spin.js).
// Результат відомий заздалегідь, рулетка лише розігрує його за серверним часом: стрічка крутиться, зупиняється на результаті,
// кілька секунд тримає його на екрані й розблоковує інтерфейс. Сам оверлей (розмітка, ефекти, звук, блокування сторінки) —
// спільний рушій ui/roulette-overlay.js; тут лише дані катаклізму: іконки стрічки, тексти й серверний годинник.

let wrapperToken = 0; // скасовує виклик, що ще чекає конфіг, якщо за цей час прийшов новіший спін або рулетку закрили

// Декоративні «фільтри»: іконки з повного каталогу, яких немає в пулі пака. Вибір залежить лише від seed і відсортованого
// каталогу, тож у всіх клієнтів стрічка збігається.
function buildFillers(poolPaths, seed, count) {
  if (count <= 0) return [];
  const inPool = new Set(poolPaths);
  const candidates = [];
  const seen = new Set();
  for (const icon of CATASTROPHE_ICONS_LIST) {
    const path = sanitizeIconPath(icon?.path);
    if (path && !inPool.has(path) && !seen.has(path)) {
      seen.add(path);
      candidates.push(path);
    }
  }
  candidates.sort();
  const rng = createRng((seed ^ 0x1F2E3D4C) >>> 0);
  for (let i = candidates.length - 1; i > 0; i--) { // перемішування Фішера—Єйтса на детермінованому генераторі
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count).map(path => ({ key: path, src: path }));
}

// ===== Публічний API =====

export function isCataclysmRouletteShown() {
  return isRouletteOverlayShown();
}

// Прибирає оверлей, розблоковує сторінку. Безпечно викликати будь-коли й повторно.
export function hideCataclysmRoulette() {
  wrapperToken++; // скасовує виклик, що ще чекає конфіг
  hideRouletteOverlay();
}

// Запускає рулетку для спіну. Повертає true, якщо оверлей показано, і false, якщо показувати вже нічого
// (запис не схожий на спін або кручення давно скінчилось). onFinish викликається один раз, коли інтерфейс розблоковано.
export async function playCataclysmRoulette(spin, { onFinish = null } = {}) {
  hideCataclysmRoulette();

  const now = getGlobalTime();
  const timeline = getSpinTimeline(spin, now);
  if (!timeline || now >= timeline.unlockAt) return false;

  const myToken = ++wrapperToken;
  const cfg = normalizeRouletteConfig((await getGameConfig()).cataclysmRoulette);
  if (myToken !== wrapperToken) return false;

  const poolPaths = (Array.isArray(spin.pool) ? spin.pool : []).map(sanitizeIconPath).filter(Boolean);
  const resultPath = sanitizeIconPath(spin.result) || ICONS.HAZARD;
  const result = { key: resultPath, src: resultPath };
  const pool = poolPaths.length > 0 ? poolPaths.map(path => ({ key: path, src: path })) : [result];
  const seed = Number(spin.seed) || 0;
  const visuals = resolveSpinVisuals(spin, cfg); // I-10: стрічка визначається спіном ведучого, а не локальним конфігом
  const fillers = buildFillers(poolPaths, seed, visuals.maxFillers);

  return playRouletteOverlay({
    ariaLabel: 'Рулетка катаклізму',
    texts: { kicker: 'Катаклізм визначається…', tease: 'Невже це він…', done: 'Катаклізм визначено' },
    title: String(spin.title ?? ''),
    timeline,
    now: getGlobalTime,
    mode: cfg.mode,
    sounds: cfg.sounds,
    preload: [...poolPaths, resultPath, ...fillers.map(item => item.src)],
    reel: {
      pool,
      fillers,
      result,
      seed,
      stopIndex: Number(spin.stop_index),
      durationMs: Number(spin.duration_ms),
      easingPower: visuals.easingPower,
      fillerZone: visuals.fillerZone,
      suspense: visuals.suspense
    },
    onFinish
  });
}

// Для виклику з жесту користувача (клік «Почати гру»): дозволяє браузеру програти звук рулетки, що стартує пізніше
export function primeCataclysmRouletteAudio() {
  primeRouletteAudio();
}
