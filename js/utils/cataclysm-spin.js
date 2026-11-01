import { getGameConfig } from '../config/config-manager.js';
import { detectCataclysmIcon } from './cataclysm-detector.js';
import { normalizeRouletteConfig } from './roulette-config.js';

// ===== Рулетка катаклізму: стан у bunker_state.cataclysm_spin =====
// Результат (bunker_state.cataclysm) обирається ДО анімації — генератором при старті гри або дією ведучого «Змінити катаклізм».
// Рулетка лише показує вже відомий результат, тому всі клієнти бачать однаковий катаклізм, а перезавантаження сторінки посеред
// кручення нічого не змінює. Модуль без DOM і без звернень до БД: час передається аргументом `now` (getGlobalTime()).
//
// Формат bunker_state.cataclysm_spin:
//   id          — унікальний номер спіну (Date.now()); за ним клієнти відрізняють новий спін від уже показаного
//   started_at  — коли стрічка починає крутитися, мс за серверним годинником (момент запису + startLeadMs)
//   duration_ms — скільки вона крутиться; hold_ms — скільки результат лишається на екрані, поки інтерфейс заблоковано
//   stop_index  — на скільки елементів стрічка проїжджає до результату; seed — зерно для однакової стрічки на всіх екранах
//   pool        — іконки реальних катаклізмів пака (результат серед них); result — іконка результату; title — його назва
//   viz         — візуальні параметри стрічки з конфігу ВЕДУЧОГО (maxFillers, fillerZone, easingPower, suspense): стрічка однакова у всіх
// Тривалість і час пишуться разом зі спіном, тож у всіх вона однакова й береться з конфігу ВЕДУЧОГО.

const MAX_POOL_ICONS = 48;          // пул у стані малий: ~35 катаклізмів × ~40 байт
const MAX_DURATION_MS = 30000;      // страховка: підроблений/зіпсований запис не заблокує інтерфейс надовго
const MAX_HOLD_MS = 10000;
const MAX_LEAD_SKEW_MS = 8000;      // старт далі за це від «зараз» означає розбіжність годинників, а не справжню паузу
const SKEW_FALLBACK_LEAD_MS = 1500; // тоді вважаємо, що старт — через цю паузу від першої миті, коли ми про спін дізналися
const STOP_INDEX_RANGE = { min: 24, max: 90 };
const MS_PER_STRIP_ITEM = 105;      // 5000 мс → 48 елементів: швидкість стрічки лишається схожою за будь-якої тривалості

// Шлях до іконки з каталогу (./icons/...svg). Усе інше (чужі URL, лапки, дужки) відкидається: шлях потрапляє в CSS url(),
// а значення приходять із bunker_state, який пише клієнт ведучого.
const ICON_PATH_RE = /^(?:\.\/)?icons\/[A-Za-z0-9_\-./]+\.svg$/i;

export function sanitizeIconPath(path) {
  if (typeof path !== 'string') return null;
  const clean = path.trim();
  if (!ICON_PATH_RE.test(clean) || clean.includes('..')) return null;
  return clean.startsWith('./') ? clean : `./${clean}`;
}

// Читання блока cataclysmRoulette з конфігу переїхало в utils/roulette-config.js (спільне з рулеткою тесту виживання);
// тут лишається реекспорт, щоб старі імпорти працювали.
export { normalizeRouletteConfig };

// Візуальні параметри стрічки, що впливають на її вміст і траєкторію (тому мусять бути однаковими в усіх клієнтів).
const SPIN_VIZ_KEYS = ['easingPower', 'fillerZone', 'maxFillers', 'suspense'];

// Беремо параметри зі спіну (їх записав ведучий), а відсутні — з локального конфігу (старі спіни без viz).
// Значення знову проходять нормалізацію, тож підроблений запис не вийде за допустимі межі.
export function resolveSpinVisuals(spin, localCfg) {
  const merged = {};
  for (const key of SPIN_VIZ_KEYS) merged[key] = localCfg?.[key];
  const viz = spin && typeof spin.viz === 'object' && spin.viz !== null && !Array.isArray(spin.viz) ? spin.viz : null;
  if (viz) {
    for (const key of SPIN_VIZ_KEYS) {
      if (viz[key] !== undefined) merged[key] = viz[key];
    }
  }
  const normalized = normalizeRouletteConfig(merged);
  const result = {};
  for (const key of SPIN_VIZ_KEYS) result[key] = normalized[key];
  return result;
}

// Іконки реальних катаклізмів пака (унікальні). Результат гарантовано серед них: інакше стрічка зупинилась би на іконці,
// якої в ній «не було». Якщо іконок забагато — обрізаємо, але результат лишаємо.
export function collectPoolIcons(cards, resultIcon, max = MAX_POOL_ICONS) {
  const seen = new Set();
  const icons = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const path = sanitizeIconPath(card?.meta?.icon || detectCataclysmIcon(card?.value, card?.meta?.description));
    if (path && !seen.has(path)) {
      seen.add(path);
      icons.push(path);
    }
  }
  const resultPath = sanitizeIconPath(resultIcon);
  const rest = icons.filter(path => path !== resultPath).slice(0, resultPath ? max - 1 : max);
  return resultPath ? [...rest, resultPath] : rest;
}

function randomSeed() {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}

// Додає до bunkerState спін для вже обраного катаклізму (bunkerState.cataclysm) і зсуває мітку кінця таймера катаклізму
// на момент, коли рулетка зупиниться та розблокує інтерфейс: гравці не втрачають час відліку, поки дивляться на стрічку.
// cards — картки катаклізмів пака (звідти беруться іконки стрічки); now — getGlobalTime() ведучого.
// Повертає створений спін, а коли рулетку вимкнено в конфігу (enabled: false) — null: катаклізм з'являється одразу, як раніше.
export async function attachCataclysmSpin(bunkerState, cards, now, options = {}) {
  if (!bunkerState || !bunkerState.cataclysm) return null;

  const cfg = normalizeRouletteConfig((await getGameConfig()).cataclysmRoulette);
  if (!cfg.enabled) {
    delete bunkerState.cataclysm_spin;
    return null;
  }

  const durationMs = Math.round(cfg.durationMs);
  const stopIndex = Math.min(
    STOP_INDEX_RANGE.max,
    Math.max(STOP_INDEX_RANGE.min, Math.round(durationMs / MS_PER_STRIP_ITEM))
  );
  const resultIcon = sanitizeIconPath(bunkerState.cataclysm.icon);

  const spin = {
    id: Date.now(),
    started_at: Math.round(now + (typeof options?.leadMs === 'number' ? options.leadMs : Math.max(cfg.startLeadMs, 4600))),
    duration_ms: durationMs,
    hold_ms: Math.round(cfg.holdAfterMs),
    stop_index: stopIndex,
    seed: randomSeed(),
    pool: collectPoolIcons(cards, resultIcon),
    result: resultIcon,
    title: String(bunkerState.cataclysm.text ?? ''),
    // I-10: візуальні параметри стрічки пише ХОСТ, щоб у всіх клієнтів вона збігалась незалежно від локального конфігу
    viz: {
      easingPower: cfg.easingPower,
      fillerZone: cfg.fillerZone,
      maxFillers: cfg.maxFillers,
      suspense: cfg.suspense
    }
  };
  bunkerState.cataclysm_spin = spin;

  const timerMinutes = Number(bunkerState.cataclysm.timer_minutes) || 0;
  if (timerMinutes > 0) {
    bunkerState.cataclysm_timer_end = spin.started_at + spin.duration_ms + spin.hold_ms + timerMinutes * 60 * 1000;
  }
  return spin;
}

// ===== Таймлайн спіну =====
// Перша «зустріч» клієнта зі спіном фіксує його таймлайн у кеші: усі подальші виклики (рендер дошки, перевірка ведучого,
// оверлей) бачать одні й ті самі моменти. Без цього виправлення розбіжності годинників давало б різні відповіді щоразу.
const timelineCache = new Map();

// { startAt, revealAt, unlockAt } у мс за серверним годинником або null, якщо запис не схожий на спін.
//   startAt — початок кручення; revealAt — зупинка й показ результату; unlockAt — кінець паузи, інтерфейс розблоковується.
// Якщо годинник цього пристрою відстає від годинника ведучого на хвилини (RPC get_server_time недоступна), startAt опинився б
// у далекому майбутньому, а інтерфейс завис би в очікуванні. Тоді старт зсувається на стандартну паузу від поточного моменту.
export function getSpinTimeline(spin, now) {
  if (!spin || typeof spin !== 'object') return null;

  const startedAt = Number(spin.started_at);
  const duration = Math.min(MAX_DURATION_MS, Number(spin.duration_ms));
  if (!Number.isFinite(startedAt) || !(duration > 0)) return null;
  const hold = Math.min(MAX_HOLD_MS, Math.max(0, Number(spin.hold_ms) || 0));

  const key = `${spin.id}:${startedAt}`;
  let timeline = timelineCache.get(key);
  if (!timeline) {
    const startAt = Number.isFinite(now) && startedAt - now > MAX_LEAD_SKEW_MS ? now + SKEW_FALLBACK_LEAD_MS : startedAt;
    timeline = { startAt, revealAt: startAt + duration, unlockAt: startAt + duration + hold };
    timelineCache.set(key, timeline);
    if (timelineCache.size > 20) timelineCache.delete(timelineCache.keys().next().value);
  }
  return timeline;
}

// Чи триває рулетка прямо зараз (від появи спіну до розблокування інтерфейсу). Поки триває, дошка не показує катаклізм,
// ведучий не може його змінити, а запис про зміну в лозі прихований.
export function isCataclysmSpinActive(bunkerState, now) {
  const timeline = getSpinTimeline(bunkerState?.cataclysm_spin, now);
  return !!timeline && now < timeline.unlockAt;
}
