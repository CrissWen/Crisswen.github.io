import { getGlobalTime } from '../../services/server-time.js';
import { getGameConfig } from '../../config/config-manager.js';
import { ICONS } from '../../constants/icons.js';
import { CATASTROPHE_ICONS_LIST } from '../../constants/catastrophe-icons.js';
import { createRouletteReel, resolveReelMode } from '../../ui/roulette-reel.js';
import { createRng } from '../../utils/roulette-ribbon.js';
import { getSpinTimeline, normalizeRouletteConfig, sanitizeIconPath } from '../../utils/cataclysm-spin.js';
import { configureSfx, playTick, playReveal, playHeartbeat, playRiser, playSnap, playRelief, setSfxMuted, isSfxMuted, unlockAudio } from '../../utils/sfx.js';

// ===== Оверлей рулетки катаклізму =====
// Показується всім клієнтам кімнати за записом bunker_state.cataclysm_spin (див. utils/cataclysm-spin.js).
// Результат відомий заздалегідь, оверлей лише розігрує його за серверним часом: стрічка крутиться, зупиняється на результаті,
// кілька секунд тримає його на екрані й розблоковує інтерфейс. Розмітка створюється тут (а не в index.html), бо оверлей потрібен
// лише на сторінці гри й має знати про блокування решти сторінки.
//
// Шари оверлея (знизу вгору): .cr-backdrop (нерухомий розмитий фон) → .cr-stage { .cr-fx--back (світло), .cr-panel (стрічка й
// назва), .cr-fx--front («герой» й іскри) } → кнопка звуку. Ефект «випадіння» малюється в .cr-fx--*, а не всередині стрічки
// (див. пояснення на початку css/components/roulette.css).

const OVERLAY_CLASS = 'cr-overlay';
const EMERGENCY_LIMIT_MS = 30000;  // страховка: що б не сталося, інтерфейс не лишається заблокованим довше
const UNLOCK_PAD_MS = 30;          // розблокування трохи після кінця паузи: усі клієнти встигають показати результат
const MAX_PRELOAD = 100;
const KICKER_TEASE = 'Невже це він…';
const BEAT_START_MS = 660;          // інтервал між першими «серцебиттями» перед ривком
const BEAT_STEP_MS = 45;            // на скільки кожен наступний інтервал коротший: серце б'ється дедалі частіше
const BEAT_MIN_MS = 430;

let current = null; // { overlay, reel, timers, cleanups, restore, onKeydown, fxBack, fxFront }
let tokenCounter = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const rand = (min, max) => min + Math.random() * (max - min);
const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ===== Блокування інтерфейсу =====
// inert на всіх прямих дітях body, крім оверлея: сторінка не реагує на клік і Tab, а скрінрідер її не читає.
function lockPage(overlay) {
  const locked = [];
  Array.from(document.body.children).forEach(node => {
    if (node === overlay || node.tagName === 'SCRIPT') return;
    if (!node.inert) {
      node.inert = true;
      locked.push(node);
    }
  });
  return () => locked.forEach(node => { node.inert = false; });
}

// Tab не виходить за межі оверлея. Фокусованих елементів тут мало (кнопка звуку), тож це радше «утримати фокус», ніж цикл.
function trapFocus(event, overlay) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(overlay.querySelectorAll('button:not([disabled])'));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ===== Склад стрічки =====

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

function preloadIcons(paths) {
  paths.slice(0, MAX_PRELOAD).forEach(path => {
    const img = new Image();
    img.decoding = 'async';
    img.src = path;
  });
}

// ===== Ефект «випадіння» =====
// Усе, що рухається, — лише transform/opacity (див. css/components/roulette.css). Тут JS тільки будує елементи й ставить
// точку відліку; сама анімація — CSS, з відліком від --impact (момент «удару» після зупинки стрічки).
const SPARK_COUNT = 30;
const SPARK_COLORS = ['var(--hazard)', 'var(--hazard)', '#fff', 'var(--accent)'];
const SPARKS_CLEANUP_MS = 3000;

// Точка, від якої розходяться всі ефекти: X — центр стрілки (вона стабільна, поки стрічка ще вирівнюється), Y — центр
// плитки-переможця. Записується в CSS-змінні оверлея. Повертає елемент-переможець або null.
function placeFxAnchor(overlay) {
  const winner = overlay.querySelector('.rr-item.is-winner');
  if (!winner) return null;
  const marker = overlay.querySelector('.rr-marker');
  const winnerRect = winner.getBoundingClientRect();
  const markerRect = marker?.getBoundingClientRect();
  const x = markerRect ? markerRect.left + markerRect.width / 2 : winnerRect.left + winnerRect.width / 2;
  const y = winnerRect.top + winnerRect.height / 2;
  overlay.style.setProperty('--fx-x', `${x.toFixed(1)}px`);
  overlay.style.setProperty('--fx-y', `${y.toFixed(1)}px`);
  return winner;
}

// Іскри розлітаються від плитки дугою: по горизонталі рівномірно (--dx), по вертикалі спершу вгору (--up), потім падають (--fall)
function buildSparks() {
  const box = el('div', 'cr-sparks');
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < SPARK_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / SPARK_COUNT + rand(-0.22, 0.22);
    const power = rand(120, 380);
    const vertical = Math.sin(angle);
    const up = vertical < 0 ? vertical * power * 0.8 - 20 : -rand(20, 70);
    const spark = el('span', 'cr-spark');
    spark.style.setProperty('--dx', `${(Math.cos(angle) * power * 1.15).toFixed(1)}px`);
    spark.style.setProperty('--up', `${up.toFixed(1)}px`);
    spark.style.setProperty('--fall', `${Math.max(up + rand(140, 280), 30).toFixed(1)}px`);
    spark.style.setProperty('--s', `${rand(4, 10).toFixed(1)}px`);
    spark.style.setProperty('--dur', `${rand(0.9, 1.5).toFixed(2)}s`);
    spark.style.setProperty('--c', SPARK_COLORS[i % SPARK_COLORS.length]);
    spark.appendChild(el('i'));
    fragment.appendChild(spark);
  }
  box.appendChild(fragment);
  return box;
}

// Будує шари ефекту: світло за стрічкою (спалах, ореол, промені, кільця) і «героя» з іскрами поверх неї.
// late — клієнт зайшов уже після зупинки: показуємо кінцевий стан («герой», ореол, промені) без спалаху, кілець, іскор і руху.
function revealHero(state, late) {
  const { overlay, fxBack, fxFront } = state;
  const winner = placeFxAnchor(overlay);
  if (!winner) return;

  const backAnchor = el('div', 'cr-anchor');
  backAnchor.append(el('div', 'cr-bloom'), el('div', 'cr-rays'));
  if (!late) {
    ['0s', '.16s'].forEach(delay => {
      const ring = el('div', 'cr-ring');
      ring.style.setProperty('--d', delay);
      backAnchor.appendChild(ring);
    });
    fxBack.appendChild(el('div', 'cr-flash'));
  }
  fxBack.appendChild(backAnchor);

  // «Герой» — копія плитки-переможця більшого розміру. Маску іконки беремо з готової плитки: шлях уже перевірений рулеткою
  const icon = el('span', 'rr-icon');
  const sourceIcon = winner.querySelector('.rr-icon');
  if (sourceIcon) {
    icon.style.webkitMaskImage = sourceIcon.style.webkitMaskImage;
    icon.style.maskImage = sourceIcon.style.maskImage;
  }
  const tile = el('div', 'cr-hero-tile');
  tile.appendChild(icon);
  const hero = el('div', 'cr-hero');
  hero.appendChild(tile);

  const frontAnchor = el('div', 'cr-anchor');
  frontAnchor.appendChild(hero);
  if (!late && !prefersReducedMotion()) {
    const sparks = buildSparks();
    frontAnchor.appendChild(sparks);
    state.timers.push(setTimeout(() => sparks.remove(), SPARKS_CLEANUP_MS));
  }
  fxFront.appendChild(frontAnchor);

  overlay.classList.add('has-hero'); // ховає плитку-переможця в стрічці й гасить саму стрічку

  // Зміна розміру вікна/орієнтації під час показу: переносимо точку відліку, шари підуть за змінними
  let rafId = 0;
  const onResize = () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => placeFxAnchor(overlay));
  };
  window.addEventListener('resize', onResize);
  state.cleanups.push(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
  });
}

// ===== Напруження перед ривком (інтрига) =====
// Фази (approach → hold → snap) оголошує сама стрічка за своєю кривою (див. createTravelCurve), тож у всіх клієнтів вони збігаються.
//   approach — стрічка доповзає до «приманки»: темніють краї, камера наїжджає, з'являється серцебиття й наростаючий звук;
//   hold     — вона ніби зупинилась на не тому катаклізмі; snap — ривок на справжній результат.
// Візуально це класи на оверлеї (css/components/roulette.css), JS лише перемикає їх і б'є серцем у такт.
// is-snapping — підсунулась на сусіда (яскравий спалах), is-relieved — лишилась там, де стала (напруження м'яко спадає, без спалаху)
const TENSION_CLASSES = ['is-tense', 'is-teasing', 'is-snapping', 'is-relieved'];

function setTension(overlay, name) {
  overlay.classList.remove(...TENSION_CLASSES);
  if (name) overlay.classList.add(name);
}

// Кожен удар перемикає beat-a / beat-b: різні назви анімації змушують CSS запускати її заново без примусового перерахунку розмітки
function startHeartbeat(state) {
  stopHeartbeat(state);
  let interval = BEAT_START_MS;
  let beat = 0;
  const pulse = () => {
    if (current !== state) return;
    playHeartbeat(Math.min(1, 0.45 + beat * 0.14));
    const { classList } = state.overlay;
    classList.remove(beat % 2 ? 'beat-a' : 'beat-b');
    classList.add(beat % 2 ? 'beat-b' : 'beat-a');
    beat++;
    interval = Math.max(BEAT_MIN_MS, interval - BEAT_STEP_MS);
    state.beatTimer = setTimeout(pulse, interval);
  };
  pulse();
}

function stopHeartbeat(state) {
  clearTimeout(state.beatTimer);
  state.beatTimer = 0;
  state.overlay.classList.remove('beat-a', 'beat-b'); // інакше після ривку анімація пульсу стартувала б знову
}

// Назва результату: слова виїжджають по черзі (анімація в CSS), а скрінрідер читає цілий текст з прихованого .cr-sr
function setTitle(titleEl, text, animated) {
  titleEl.replaceChildren();
  const words = text.split(/\s+/).filter(Boolean);
  if (!animated || words.length === 0) {
    titleEl.textContent = text;
    return;
  }
  const visible = el('span', 'cr-title-visible');
  visible.setAttribute('aria-hidden', 'true');
  words.forEach((word, index) => {
    const node = el('span', 'cr-title-word', word);
    node.style.setProperty('--i', String(index));
    visible.appendChild(node);
    if (index < words.length - 1) visible.appendChild(document.createTextNode(' '));
  });
  titleEl.append(el('span', 'cr-sr', text), visible);
}

// ===== Публічний API =====

export function isCataclysmRouletteShown() {
  return !!current;
}

// Прибирає оверлей, розблоковує сторінку. Безпечно викликати будь-коли й повторно.
export function hideCataclysmRoulette() {
  if (!current) return;
  const state = current;
  current = null;
  tokenCounter++; // скасовує всі асинхронні кроки, що ще чекають (визначення режиму)
  state.timers.forEach(clearTimeout);
  state.cleanups.forEach(cleanup => cleanup());
  state.reel?.destroy();
  document.removeEventListener('keydown', state.onKeydown, true);
  state.overlay.remove();
  state.restore();
}

// Запускає рулетку для спіну. Повертає true, якщо оверлей показано, і false, якщо показувати вже нічого
// (запис не схожий на спін або кручення давно скінчилось). onFinish викликається один раз, коли інтерфейс розблоковано.
export async function playCataclysmRoulette(spin, { onFinish = null } = {}) {
  hideCataclysmRoulette();

  const now = getGlobalTime();
  const timeline = getSpinTimeline(spin, now);
  if (!timeline || now >= timeline.unlockAt) return false;

  const myToken = ++tokenCounter;
  const cfg = normalizeRouletteConfig((await getGameConfig()).cataclysmRoulette);
  if (myToken !== tokenCounter) return false;

  configureSfx({
    enabled: cfg.sounds.enabled,
    volume: cfg.sounds.volume,
    files: { tick: cfg.sounds.tickUrl, reveal: cfg.sounds.revealUrl }
  });

  const poolPaths = (Array.isArray(spin.pool) ? spin.pool : []).map(sanitizeIconPath).filter(Boolean);
  const resultPath = sanitizeIconPath(spin.result) || ICONS.HAZARD;
  const result = { key: resultPath, src: resultPath };
  const pool = poolPaths.length > 0 ? poolPaths.map(path => ({ key: path, src: path })) : [result];
  const fillers = buildFillers(poolPaths, Number(spin.seed) || 0, cfg.maxFillers);

  // ----- Розмітка -----
  const overlay = el('div', OVERLAY_CLASS);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Рулетка катаклізму');

  const backdrop = el('div', 'cr-backdrop');
  const vignette = el('div', 'cr-vignette'); // темні краї: з'являються, коли наростає напруження
  const pulse = el('div', 'cr-pulse');       // світіння в такт серцебиттю й спалах під час ривку
  const stage = el('div', 'cr-stage');
  const fxBack = el('div', 'cr-fx cr-fx--back');
  const fxFront = el('div', 'cr-fx cr-fx--front');
  const panel = el('div', 'cr-panel');
  const kicker = el('p', 'cr-kicker', 'Катаклізм визначається…');
  const reelHost = el('div', 'cr-reel');
  const title = el('p', 'cr-title');
  title.setAttribute('role', 'status');
  title.setAttribute('aria-live', 'polite');

  const soundBtn = el('button', 'cr-sound');
  soundBtn.type = 'button';
  const syncSoundBtn = () => {
    const muted = isSfxMuted();
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.setAttribute('aria-label', muted ? 'Увімкнути звук' : 'Вимкнути звук');
    soundBtn.textContent = muted ? '🔇 Звук вимк.' : '🔊 Звук';
  };
  syncSoundBtn();
  soundBtn.addEventListener('click', () => {
    setSfxMuted(!isSfxMuted());
    syncSoundBtn();
  });

  panel.append(kicker, reelHost, title);
  stage.append(fxBack, panel, fxFront);
  overlay.append(backdrop, vignette, pulse, stage, soundBtn);
  document.body.appendChild(overlay);

  const restore = lockPage(overlay);
  const onKeydown = event => trapFocus(event, overlay);
  document.addEventListener('keydown', onKeydown, true);
  soundBtn.focus({ preventScroll: true });

  const state = { overlay, reel: null, timers: [], cleanups: [], restore, onKeydown, fxBack, fxFront, beatTimer: 0, stopRiser: null };
  state.cleanups.push(() => {
    clearTimeout(state.beatTimer);
    state.stopRiser?.();
  });
  current = state;

  preloadIcons([...poolPaths, resultPath, ...fillers.map(item => item.src)]);

  // Аварійний ліміт від показу, а не від таймлайну: навіть при зламаному годиннику інтерфейс розблокується
  state.timers.push(setTimeout(() => finish(), EMERGENCY_LIMIT_MS));

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    const callback = onFinish;
    hideCataclysmRoulette();
    callback?.();
  }

  // ----- Режим (LDM) -----
  // На визначення режиму є вся пауза перед стартом, мінус запас; після старту рулетка вже не змінює режим
  const leadMs = timeline.startAt - getGlobalTime();
  const mode = await resolveReelMode({ preference: cfg.mode, probeMs: Math.min(600, Math.max(0, leadMs - 300)) });
  if (myToken !== tokenCounter || current !== state) return true;

  if (mode === 'light') overlay.classList.add('is-light'); // LDM: без розмиття фону — це найважчий ефект
  // ----- Стрічка -----
  state.reel = createRouletteReel(reelHost, {
    pool,
    fillers,
    result,
    seed: Number(spin.seed) || 0,
    stopIndex: Number(spin.stop_index),
    durationMs: Number(spin.duration_ms),
    easingPower: cfg.easingPower,
    fillerZone: cfg.fillerZone,
    mode,
    suspense: cfg.suspense,
    onTick: ({ speed }) => playTick(speed),
    onPhase: (phase, { missed, untilSnapMs, swaps }) => {
      if (current !== state || mode === 'light' || prefersReducedMotion()) return;
      if (phase === 'approach') {
        setTension(overlay, 'is-tense');
        if (!missed) { // хто приєднався посеред цього, звук уже не наздожене: лише картинка
          startHeartbeat(state);
          // «Райзер» (playRiser) вимкнено: ось цей дивний звук після серцебиття
        }
      } else if (phase === 'hold') {
        setTension(overlay, 'is-teasing');
        kicker.textContent = KICKER_TEASE;
      } else if (phase === 'snap') {
        stopHeartbeat(state);
        state.stopRiser?.();
        state.stopRiser = null;
        setTension(overlay, swaps ? 'is-snapping' : 'is-relieved');
        // Звуки ривку (playSnap) і полегшення (playRelief) вимкнено: далі одразу грає власний звук результату
      }
    },
    onFinish: ({ late }) => {
      if (current !== state) return;
      stopHeartbeat(state); // на випадок, якщо ривок не було оголошено (вкладка була у фоні)
      state.stopRiser?.();
      state.stopRiser = null;
      setTension(overlay, null);
      kicker.textContent = 'Катаклізм визначено';
      setTitle(title, String(spin.title ?? ''), mode !== 'light');
      if (late) overlay.classList.add('is-late'); // тим, хто зайшов після зупинки, ефекти вже ні до чого: одразу кінцевий стан
      if (mode !== 'light') revealHero(state, late); // LDM: без «героя», променів і іскор
      overlay.classList.add('is-revealed');
      if (!late) playReveal();
    }
  });
  state.reel.start({ startAt: timeline.startAt, now: getGlobalTime });

  // Розблокування за серверним часом: пауза після зупинки однакова в усіх
  state.timers.push(setTimeout(finish, Math.max(0, timeline.unlockAt + UNLOCK_PAD_MS - getGlobalTime())));
  return true;
}

// Для виклику з жесту користувача (клік «Почати гру»): дозволяє браузеру програти звук рулетки, що стартує пізніше
export function primeCataclysmRouletteAudio() {
  unlockAudio();
}
