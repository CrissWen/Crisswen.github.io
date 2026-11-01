import { getGameConfig } from '../../config/config-manager.js';
import { ICONS } from '../../constants/icons.js';
import { normalizeRouletteConfig } from '../../utils/roulette-config.js';
import { playRouletteOverlay, primeRouletteAudio } from '../../ui/roulette-overlay.js';

// ===== Рулетка тесту виживання: дві іконки — серце («вижили») і череп («загинули») =====
// Підсумок тесту (вижили чи ні) вже пораховано за балами ДО рулетки: вона лише розігрує його. Стрічка — випадково
// накидані серця й черепи (50 на 50, не чергуються). Біля результату стоїть хоча б одна «чужа» іконка, тож у фіналі з шансом
// survivalTest.roulette.swapChance (за замовчуванням 20%) стрічка спершу зупиняється на іконці, протилежній результату,
// завмирає й лише потім підсувається на справжню. Бали й вердикт цим не змінюються.
//
// Тривалість, гальмування, звуки й режим (LDM) беруться з блоку cataclysmRoulette: одна «ручка» на всі рулетки гри.
// Спільний рушій оверлея — ui/roulette-overlay.js. Час локальний (Date.now): тест — окрема сторінка без синхронізації.

const ALIVE = { key: 'alive', src: ICONS.SURVIVAL_ALIVE };
const DEAD = { key: 'dead', src: ICONS.SURVIVAL_DEAD };

const STOP_INDEX_RANGE = { min: 24, max: 90 };
const MS_PER_STRIP_ITEM = 105; // як у рулетці катаклізму: швидкість стрічки лишається схожою за будь-якої тривалості
const DEFAULT_SWAP_CHANCE = 0.2;
const DEFAULT_START_LEAD_MS = 700;

const TEXTS = { kicker: 'Доля бункера визначається…', tease: 'Невже…', done: 'Доля бункера визначена' };
const TITLES = { alive: 'Бункер вижив', dead: 'Бункер не вижив' };

function randomSeed() {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}

// Для виклику з жесту користувача (клік «Дізнатися результат»): дозволяє браузеру програти звук рулетки
export function primeSurvivalRouletteAudio() {
  primeRouletteAudio();
}

// Показує рулетку й чекає, поки вона закінчиться та оверлей зникне. Ніколи не кидає помилку: якщо рулетку вимкнено в конфігу
// або щось пішло не так, одразу повертається — тест просто покаже підсумок без неї.
// survived — true: випаде серце, false: череп.
export async function playSurvivalRoulette(survived) {
  try {
    const config = await getGameConfig();
    const own = config.survivalTest?.roulette ?? {};
    if (own.enabled === false) return;

    const cfg = normalizeRouletteConfig(config.cataclysmRoulette);
    const swapChance = Number.isFinite(own.swapChance) ? Math.min(1, Math.max(0, own.swapChance)) : DEFAULT_SWAP_CHANCE;
    const startLeadMs = Number.isFinite(own.startLeadMs) ? Math.min(5000, Math.max(0, own.startLeadMs)) : DEFAULT_START_LEAD_MS;
    // Підсув — це «інтрига» (suspense): без неї стрічка просто гальмує до результату. Налаштування інтриги з конфігу катаклізму
    // зберігаються, але шанс підсуву для тесту свій
    const suspense = cfg.suspense
      ? { ...(typeof cfg.suspense === 'object' ? cfg.suspense : {}), swapChance }
      : false;

    const result = survived ? ALIVE : DEAD;
    const durationMs = Math.round(cfg.durationMs);
    const stopIndex = Math.min(
      STOP_INDEX_RANGE.max,
      Math.max(STOP_INDEX_RANGE.min, Math.round(durationMs / MS_PER_STRIP_ITEM))
    );
    const startAt = Date.now() + startLeadMs;

    await new Promise(resolve => {
      playRouletteOverlay({
        ariaLabel: 'Рулетка долі бункера',
        texts: TEXTS,
        title: survived ? TITLES.alive : TITLES.dead,
        timeline: { startAt, unlockAt: startAt + durationMs + cfg.holdAfterMs },
        now: Date.now,
        mode: cfg.mode,
        sounds: cfg.sounds,
        preload: [ALIVE.src, DEAD.src],
        reel: {
          pool: [ALIVE, DEAD],
          fillers: [],
          result,
          seed: randomSeed(),
          stopIndex,
          durationMs,
          easingPower: cfg.easingPower,
          scatter: true,
          suspense
        },
        onFinish: resolve
      }).then(shown => {
        if (!shown) resolve(); // показувати нічого — не чекаємо
      }).catch(err => {
        console.error('Рулетка тесту не запустилась:', err);
        resolve();
      });
    });
  } catch (err) {
    console.error('Рулетка тесту недоступна, показуємо підсумок одразу:', err);
  }
}
