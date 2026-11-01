import { createRouletteReel, resolveReelMode } from './roulette-reel.js';
import { configureSfx, playHeartbeat, unlockAudio } from '../utils/sfx.js';
import { soundManager, SOUND_IDS } from '../services/sound-manager.js';

// ===== Оверлей рулетки (спільний для рулетки катаклізму й рулетки тесту виживання) =====
// Не знає, що саме крутиться: приймає готову стрічку (reel), тексти, таймлайн і годинник. Показує оверлей на весь екран,
// розігрує стрічку за часом, тримає результат на екрані й розблоковує сторінку. Дані й джерело часу готує викликач:
//   • катаклізм — js/game-modules/overlays/cataclysm-roulette.js (серверний час, спін із bunker_state);
//   • тест виживання — js/pages/survival-roulette.js (локальний час, дві іконки).
//
// Шари оверлея (знизу вгору): .cr-backdrop (нерухомий розмитий фон) → .cr-stage { .cr-fx--back (світло), .cr-panel (стрічка й
// назва), .cr-fx--front («герой» й іскри) }. Ефект «випадіння» малюється в .cr-fx--*, а не всередині стрічки
// (див. пояснення на початку css/components/roulette.css).
//
// Приклад:
//   await playRouletteOverlay({
//     ariaLabel: 'Рулетка', texts: { kicker: 'Визначається…', tease: 'Невже…', done: 'Готово' }, title: 'Результат',
//     timeline: { startAt, unlockAt }, now: () => Date.now(),     // startAt/unlockAt — у тому ж годиннику, що й now()
//     reel: { pool, fillers, result, seed, stopIndex, durationMs, easingPower, fillerZone, suspense, scatter },
//     mode: 'auto', sounds: { enabled, volume, tickUrl, revealUrl }, preload: ['icons/a.svg'], onFinish
//   });

const OVERLAY_CLASS = 'cr-overlay';
const EMERGENCY_LIMIT_MS = 30000;  // страховка: що б не сталося, інтерфейс не лишається заблокованим довше
const UNLOCK_PAD_MS = 30;          // розблокування трохи після кінця паузи: усі клієнти встигають показати результат
const FADE_OUT_DURATION_MS = 800;   // плавний fade-out оверлея після показу результату
const MAX_PRELOAD = 100;
const BEAT_START_MS = 660;          // інтервал між першими «серцебиттями» перед ривком
const BEAT_STEP_MS = 45;            // на скільки кожен наступний інтервал коротший: серце б'ється дедалі частіше
const BEAT_MIN_MS = 430;

let current = null; // { overlay, reel, timers, cleanups, restore, onKeydown, fxBack, fxFront, beatTimer }
let tokenCounter = 0;

// Клацання стрічки й звук результату йдуть через SoundManager (js/constants/sounds.js: ROULETTE_TICK, ROULETTE_REVEAL, з preload).
// Серцебиття лишається синтезованим у utils/sfx.js: окремого файлу для нього немає.
let soundsEnabled = true;
let soundsVolume = 0.5; // cataclysmRoulette.sounds.volume з конфігу: множник поверх каналів SoundManager

// speed (0..1): швидка стрічка — вищий і тихіший тик, повільна наприкінці — глибший і виразніший («доповзання» як гальмування)
function playRouletteTick(speed = 0) {
  if (!soundsEnabled) return;
  const s = Math.min(1, Math.max(0, Number(speed) || 0));
  soundManager.play(SOUND_IDS.ROULETTE_TICK, { rate: 0.9 + s * 0.4, volume: soundsVolume * (1 - s * 0.45) });
}

function playRouletteReveal() {
  if (!soundsEnabled) return;
  soundManager.play(SOUND_IDS.ROULETTE_REVEAL, { volume: soundsVolume });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Виклик зовнішнього onFinish: виняток у колбеку (наприклад, refreshBoard) не має лишити оверлей у DOM або зупиняти очищення
function runCallback(callback, arg) {
  try {
    callback?.(arg);
  } catch (err) {
    console.error('Помилка в onFinish рулетки:', err);
  }
}

const rand = (min, max) => min + Math.random() * (max - min);
const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ===== Блокування інтерфейсу =====
// inert на всіх прямих дітях body, крім оверлея: сторінка не реагує на клік і Tab, а скрінрідер її не читає.
function lockPage(overlay) {
  const locked = [];
  Array.from(document.body.children).forEach(node => {
    if (node === overlay || node.tagName === 'SCRIPT' || node.classList?.contains('bunker-vault-overlay')) return;
    if (!node.inert) {
      node.inert = true;
      locked.push(node);
    }
  });
  return () => locked.forEach(node => { node.inert = false; });
}

// Tab не виходить за межі оверлея, навіть коли в ньому немає кнопок.
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
//   approach — стрічка доповзає до «приманки»: темніють краї, камера наїжджає, з'являється серцебиття;
//   hold     — вона ніби зупинилась на не тому елементі; snap — розв'язка: підсув на справжній результат або полегшення.
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

export function isRouletteOverlayShown() {
  return !!current && !current.fading;
}

// Прибирає оверлей, розблоковує сторінку. Безпечно викликати будь-коли й повторно.
export function hideRouletteOverlay() {
  if (!current) return;
  const state = current;
  current = null;
  tokenCounter++; // скасовує всі асинхронні кроки, що ще чекають (визначення режиму)
  state.timers.forEach(clearTimeout);
  state.cleanups.forEach(cleanup => cleanup());
  state.reel?.destroy();
  document.removeEventListener('keydown', state.onKeydown, true);
  state.overlay.remove();
  if (typeof state.restore === 'function') {
    state.restore();
    state.restore = null;
  }
  // Оверлей закрили зовні до штатного завершення: сповіщаємо викликача (onFinish({ cancelled: true })),
  // інакше проміс, який чекає на фініш (survival-roulette), завис би назавжди
  state.cancel?.();
}

// Для виклику з жесту користувача (клік): дозволяє браузеру програти звук рулетки, що стартує пізніше
export function primeRouletteAudio() {
  unlockAudio();
}

// Запускає оверлей. Повертає true, якщо оверлей показано, і false, якщо показувати вже нічого (час минув).
// onFinish викликається один раз, коли інтерфейс розблоковано (або спрацювала аварійна страховка).
//   timeline — { startAt, unlockAt } у годиннику now(): початок кручення й кінець паузи після зупинки (стрічка зупиняється в startAt + reel.durationMs)
//   reel     — параметри createRouletteReel (pool, fillers, result, seed, stopIndex, durationMs, easingPower, fillerZone, suspense, scatter)
//   mode     — 'auto' | 'full' | 'light' (див. resolveReelMode); sounds — { enabled, volume }
export async function playRouletteOverlay({
  ariaLabel = 'Рулетка',
  texts = {},
  title = '',
  timeline,
  now = Date.now,
  reel: reelOptions,
  mode: modePreference = 'auto',
  sounds = {},
  preload = [],
  onFinish = null
}) {
  hideRouletteOverlay();
  if (!timeline || !reelOptions || now() >= timeline.unlockAt) return false;

  const myToken = ++tokenCounter;
  const kickerStart = texts.kicker ?? 'Визначається…';
  const kickerTease = texts.tease ?? 'Невже це він…';
  const kickerDone = texts.done ?? 'Визначено';

  soundsEnabled = sounds.enabled !== false;
  soundsVolume = Math.min(1, Math.max(0, Number(sounds.volume ?? 0.5) || 0));
  configureSfx({ enabled: soundsEnabled, volume: sounds.volume }); // лише для серцебиття

  // ----- Розмітка -----
  const overlay = el('div', OVERLAY_CLASS);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', ariaLabel);
  overlay.tabIndex = -1;

  const backdrop = el('div', 'cr-backdrop');
  const vignette = el('div', 'cr-vignette'); // темні краї: з'являються, коли наростає напруження
  const pulse = el('div', 'cr-pulse');       // світіння в такт серцебиттю й спалах під час ривку
  const stage = el('div', 'cr-stage');
  const fxBack = el('div', 'cr-fx cr-fx--back');
  const fxFront = el('div', 'cr-fx cr-fx--front');
  const panel = el('div', 'cr-panel');
  const kicker = el('p', 'cr-kicker', kickerStart);
  const reelHost = el('div', 'cr-reel');
  const titleEl = el('p', 'cr-title');
  titleEl.setAttribute('role', 'status');
  titleEl.setAttribute('aria-live', 'polite');

  panel.append(kicker, reelHost, titleEl);
  stage.append(fxBack, panel, fxFront);
  overlay.append(backdrop, vignette, pulse, stage);
  document.body.appendChild(overlay);

  const restore = lockPage(overlay);
  const onKeydown = event => trapFocus(event, overlay);
  document.addEventListener('keydown', onKeydown, true);
  overlay.focus({ preventScroll: true });

  const state = { overlay, backdrop, stage, reel: null, timers: [], cleanups: [], restore, onKeydown, fxBack, fxFront, beatTimer: 0 };
  state.cleanups.push(() => clearTimeout(state.beatTimer));
  current = state;

  preloadIcons(preload);

  // Аварійний ліміт від показу, а не від таймлайну: навіть при зламаному годиннику інтерфейс розблокується
  state.timers.push(setTimeout(() => finish({ immediate: true }), EMERGENCY_LIMIT_MS));

  let finished = false;
  state.cancel = () => {
    if (finished) return;
    finished = true;
    runCallback(onFinish, { cancelled: true });
  };
  function finish({ immediate = false } = {}) {
    if (finished) return;
    finished = true;
    const callback = onFinish;

    const overlay = state.overlay;
    const isReduced = prefersReducedMotion();

    if (immediate || isReduced || !overlay || !overlay.isConnected) {
      hideRouletteOverlay();
      runCallback(callback);
      return;
    }

    state.fading = true;
    overlay.classList.add('is-fading-out');
    overlay.style.pointerEvents = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('inert', '');

    // Web Animations API: апаратно розчиняємо розмиття фону (backdrop-filter) і сцену без різких обривів
    try {
      if (typeof overlay.animate === 'function') {
        overlay.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: FADE_OUT_DURATION_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
        );
      }
      if (state.backdrop && typeof state.backdrop.animate === 'function') {
        state.backdrop.animate(
          [
            { opacity: 1, backdropFilter: 'blur(14px) saturate(0.85)', webkitBackdropFilter: 'blur(14px) saturate(0.85)' },
            { opacity: 0, backdropFilter: 'blur(0px) saturate(1)', webkitBackdropFilter: 'blur(0px) saturate(1)' }
          ],
          { duration: FADE_OUT_DURATION_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
        );
      }
      if (state.stage && typeof state.stage.animate === 'function') {
        state.stage.animate(
          [
            { opacity: 1, transform: 'scale(1) translateY(0)' },
            { opacity: 0, transform: 'scale(0.92) translateY(-12px)' }
          ],
          { duration: FADE_OUT_DURATION_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
        );
      }
    } catch {
      // WAAPI необов'язковий — паралельно працюють чисті CSS-переходи
    }

    // Знімаємо блокування клавіатури й сторінки одразу, щоб інтерфейс ожив під оверлеєм
    document.removeEventListener('keydown', state.onKeydown, true);
    if (typeof state.restore === 'function') {
      state.restore();
      state.restore = null;
    }

    // Таймер прибирання ставимо до виклику колбека: збій у зовнішньому коді не має лишити оверлей у DOM
    const fadeTimer = setTimeout(() => {
      if (current === state) {
        hideRouletteOverlay();
      } else {
        overlay.remove();
      }
    }, FADE_OUT_DURATION_MS);
    state.timers.push(fadeTimer);

    // Сповіщаємо гру про розблокування (дошка оновлюється під оверлеєм)
    runCallback(callback);
  }

  // ----- Режим (LDM) -----
  // На визначення режиму є вся пауза перед стартом, мінус запас; після старту рулетка вже не змінює режим
  const leadMs = timeline.startAt - now();
  const mode = await resolveReelMode({ preference: modePreference, probeMs: Math.min(600, Math.max(0, leadMs - 300)) });
  if (myToken !== tokenCounter || current !== state) return true;

  if (mode === 'light') overlay.classList.add('is-light'); // LDM: без розмиття фону — це найважчий ефект

  // ----- Стрічка -----
  const reelConfig = {
    ...reelOptions,
    mode,
    onTick: ({ speed }) => playRouletteTick(speed),
    onPhase: (phase, { missed, swaps }) => {
      if (current !== state || mode === 'light' || prefersReducedMotion()) return;
      if (phase === 'approach') {
        setTension(overlay, 'is-tense');
        if (!missed) startHeartbeat(state); // хто приєднався посеред цього, звук уже не наздожене: лише картинка
      } else if (phase === 'hold') {
        setTension(overlay, 'is-teasing');
        kicker.textContent = kickerTease;
      } else if (phase === 'snap') {
        stopHeartbeat(state);
        setTension(overlay, swaps ? 'is-snapping' : 'is-relieved'); // підсунулась — яскравий спалах, лишилась — напруження спадає
      }
    },
    onFinish: ({ late }) => {
      if (current !== state) return;
      stopHeartbeat(state); // на випадок, якщо ривок не було оголошено (вкладка була у фоні)
      setTension(overlay, null);
      kicker.textContent = kickerDone;
      setTitle(titleEl, String(title ?? ''), mode !== 'light');
      if (late) overlay.classList.add('is-late'); // тим, хто зайшов після зупинки, ефекти вже ні до чого: одразу кінцевий стан
      if (mode !== 'light') revealHero(state, late); // LDM: без «героя», променів і іскор
      overlay.classList.add('is-revealed');
      if (!late) playRouletteReveal();
    }
  };
  // Збій створення стрічки (наприклад, помилка в buildRibbon) не має блокувати сторінку до аварійного ліміту
  try {
    state.reel = createRouletteReel(reelHost, reelConfig);
    state.reel.start({ startAt: timeline.startAt, now });
  } catch (err) {
    console.error('Не вдалося запустити рулетку:', err);
    if (current === state) hideRouletteOverlay();
    return false;
  }

  // Розблокування за часом таймлайну: пауза після зупинки однакова в усіх
  state.timers.push(setTimeout(finish, Math.max(0, timeline.unlockAt + UNLOCK_PAD_MS - now())));
  return true;
}
