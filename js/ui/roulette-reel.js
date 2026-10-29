import { buildRibbon, createTravelCurve, landingOffsetFromSeed } from '../utils/roulette-ribbon.js';

// ===== Універсальна рулетка-стрічка («крутка кейса») =====
// Не знає про катаклізми: приймає елементи, результат і час старту, малює горизонтальну стрічку, що розганяється,
// гальмує й зупиняється на результаті. Результат визначає той, хто викликає, рулетка лише його показує.
//
// Положення стрічки — функція ЧАСУ (nowFn() − startAt), а не накопичення кадрів. Тому:
//   • усі клієнти з однаковим startAt бачать однакову картинку в той самий момент;
//   • хто зайшов посеред кручення, одразу бачить правильне місце, а хто спізнився — кінцевий стан;
//   • завислі кадри (вкладка у фоні) нічого не ламають: наступний кадр просто покаже актуальну позицію.
//
// Режими:
//   'full'  — стрічка з іконками, що їде
//   'light' — LDM: без руху й без важких ефектів, лише заглушка «?», смужка прогресу й поява результату в потрібний момент.
//             Той самий таймлайн, тож усі розкривають результат одночасно.
//
// Приклад:
//   const reel = createRouletteReel(hostEl, { pool, fillers, result, seed, stopIndex: 48, durationMs: 5000, mode });
//   reel.start({ startAt: serverMs, now: getGlobalTime });   // startAt — у тому ж годиннику, що й now()
//   reel.destroy();

const MODE_OVERRIDE_KEY = 'bunker-roulette-mode';       // localStorage: 'full' | 'light' — ручне перевизначення для перевірки/налагодження
const MODE_CACHE_KEY = 'bunker-roulette-auto-mode';     // sessionStorage: результат автовизначення на час сесії вкладки
const FALLBACK_STEP_PX = 110;                           // крок стрічки, якщо виміряти не вдалося (елемент прихований)
const LATE_JOIN_MS = 250;                               // старт, що вже минув довше, вважається «запізнілим»: без ефектів початку
const SETTLE_MS = 450;                                  // м'яке вирівнювання результату по центру після зупинки

// ===== Визначення режиму (LDM) =====

function safeStorage(kind) {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

const readStorage = (kind, key) => {
  try {
    return safeStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStorage = (kind, key, value) => {
  try {
    safeStorage(kind)?.setItem(key, value);
  } catch { /* сховище недоступне — автовизначення просто повториться */ }
};

const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Міряє частоту кадрів (кадр/с) за maxMs. Повертає null, якщо виміряти не вдалося (вкладка у фоні, замало кадрів)
function measureFrameRate(maxMs) {
  return new Promise(resolve => {
    const deltas = [];
    const startedAt = performance.now();
    let last = 0;
    let rafId = 0;
    let timer = 0;

    function finish() {
      clearTimeout(timer);
      cancelAnimationFrame(rafId);
      const settled = deltas.slice(3); // перші кадри після рендеру сторінки завжди повільні й нічого не кажуть про пристрій
      resolve(settled.length >= 5 ? 1000 / median(settled) : null);
    }
    function step(timestamp) {
      if (last) deltas.push(timestamp - last);
      last = timestamp;
      if (timestamp - startedAt >= maxMs || deltas.length >= 40) return finish();
      rafId = requestAnimationFrame(step);
    }

    timer = setTimeout(finish, maxMs + 250); // у фоновій вкладці rAF не викликається, тож без цього проміс завис би
    rafId = requestAnimationFrame(step);
  });
}

// Який режим вмикати на цьому пристрої. preference: 'auto' | 'full' | 'light' (з конфігу).
// У 'auto' одразу light для «зменшити анімацію» й режиму економії трафіку; для інших пристроїв міряється реальна частота кадрів
// (probeMs — скільки часу є на вимір; 0 — міряти ніколи, тоді вирішують лише апаратні підказки). Вердикт кешується на сесію.
// Ручне перевизначення: localStorage.setItem('bunker-roulette-mode', 'light' | 'full').
export async function resolveReelMode({ preference = 'auto', probeMs = 0 } = {}) {
  const override = readStorage('localStorage', MODE_OVERRIDE_KEY);
  const forced = override === 'full' || override === 'light' ? override : preference;
  if (forced === 'full' || forced === 'light') return forced;

  if (prefersReducedMotion()) return 'light';
  if (navigator.connection?.saveData) return 'light';

  const cached = readStorage('sessionStorage', MODE_CACHE_KEY);
  if (cached === 'full' || cached === 'light') return cached;

  const memory = Number(navigator.deviceMemory);
  const cores = Number(navigator.hardwareConcurrency);
  const weakHardware = (memory > 0 && memory <= 2) || (cores > 0 && cores <= 2);

  if (probeMs <= 0) return weakHardware ? 'light' : 'full';

  const fps = await measureFrameRate(probeMs);
  if (fps === null) return weakHardware ? 'light' : 'full';

  // На «підозрілому» залізі вимоги до плавності вищі: слабкий пристрій, що ледве тягне 30 кадр/с, з важкою стрічкою ще й просяде
  const mode = fps < (weakHardware ? 45 : 24) ? 'light' : 'full';
  writeStorage('sessionStorage', MODE_CACHE_KEY, mode);
  return mode;
}

// ===== Компонент =====

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// Стандартна відмальовка елемента: іконка-маска (колір бере з теми), як на дошці гри. item.src — шлях до SVG.
// Шлях має бути перевірений викликачем: він потрапляє в CSS url().
function defaultRenderItem(item, node) {
  const icon = el('span', 'rr-icon');
  if (typeof item.src === 'string' && /^[\w\-./]+$/.test(item.src)) {
    const url = `url("${item.src}")`;
    icon.style.webkitMaskImage = url; // inline-стиль, а не змінна: відносний шлях тоді рахується від документа, як і на дошці
    icon.style.maskImage = url;
  }
  node.appendChild(icon);
}

// host — елемент, куди монтується рулетка. options:
//   pool, fillers, result, seed, stopIndex, fillerZone, scatter — див. buildRibbon (utils/roulette-ribbon.js); item = { key, src, ... }
//   durationMs    — скільки триває кручення; easingPower — різкість гальмування (3 за замовчуванням)
//   mode          — 'full' | 'light' (визначте через resolveReelMode)
//   renderItem    — (item, node) => void, власна відмальовка елемента (за замовчуванням іконка)
//   onTick        — ({ index, speed }) => void, стрілка пройшла повз елемент (speed 0..1): для звуку
//   onFinish      — ({ late }) => void, стрічка зупинилась; late: true, якщо клієнт зайшов уже після зупинки
//   suspense      — інтрига наприкінці: стрічка «зупиняється», зависає й або лишається, або (шанс 20%) підсовується на сусідній елемент
//                   (false | true | налаштування, див. createTravelCurve). Тільки режим 'full'
//   onPhase       — (name, { missed, untilSnapMs, swaps }) => void, swaps: чи стрічка підсунеться на сусіда (false — лишиться там, де стала); фази інтриги рівно один раз кожна, у порядку:
//                   'approach' (наростає напруження) → 'hold' («зупинилась») → 'snap' (розв'язка: підсув або полегшення); missed: true, якщо момент уже минув
// Повертає { start({ startAt, now }), destroy(), getMode(), isFinished() }.
export function createRouletteReel(host, options) {
  const {
    pool,
    fillers = [],
    result,
    seed,
    stopIndex,
    durationMs,
    easingPower = 3,
    fillerZone = 0.55,
    scatter = false,
    mode = 'full',
    renderItem = defaultRenderItem,
    onTick = null,
    onPhase = null,
    suspense = false,
    onFinish = null
  } = options;

  const isFull = mode !== 'light';
  const root = el('div', `rr rr--${isFull ? 'full' : 'light'}`);
  root.setAttribute('aria-hidden', 'true'); // результат озвучує оверлей (aria-live), а не ~60 іконок стрічки
  host.appendChild(root);

  let started = false;
  let destroyed = false;
  let finished = false;
  let startAt = 0;
  let nowFn = Date.now;
  let rafId = 0;
  let waitTimer = 0;
  let fallbackTimer = 0; // доводить рулетку до результату вчасно, коли rAF не викликається (вкладка у фоні)
  let lateJoin = false;
  let resizeObserver = null;
  let curve = null;      // createTravelCurve: положення стрічки як функція часу (режим 'full')
  const phaseSeen = {};  // які фази інтриги вже оголошено в onPhase

  // Стан режиму 'full'
  let trackEl = null;
  let itemEls = [];
  let ribbon = null;
  let metrics = null; // { step, x0, finalX, distance }
  let travelled = 0;  // скільки пікселів стрічка вже проїхала (для перерахунку після зміни розміру)
  let lastIndex = -1;
  const landingOffset = landingOffsetFromSeed(seed);

  // Стан режиму 'light'
  let slotEl = null;

  // ----- Режим 'full' -----

  function measureStepOf(node) {
    const width = node.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(node).marginRight) || 0;
    return width > 0 ? width + gap : FALLBACK_STEP_PX;
  }

  function measure() {
    // Центр рахуємо від внутрішньої ширини в'юпорта (без рамки), а не від root: стрілка стоїть рівно посередині в'юпорта
    const viewportW = trackEl.parentElement?.clientWidth || root.clientWidth || 640;
    const step = itemEls.length > 1 && itemEls[1].offsetLeft > itemEls[0].offsetLeft
      ? itemEls[1].offsetLeft - itemEls[0].offsetLeft
      : FALLBACK_STEP_PX;
    // Центр самого елемента, а не «елемент + проміжок»: інакше результат зміщується від стрілки на половину проміжку
    const half = (itemEls[0]?.offsetWidth || step) / 2;
    metrics = {
      step,
      // Стрічка стартує так, щоб елемент startIndex стояв рівно під стрілкою (по центру вікна)
      x0: viewportW / 2 - (ribbon.startIndex * step + half),
      finalX: viewportW / 2 - (ribbon.stopIndex * step + half)
    };
  }

  function placeTrack() {
    if (finished) {
      // У спокої стрічка стоїть на цілому фізичному пікселі: дробове зміщення розмиває іконки-маски й дає «дрижання» на краях
      const dpr = window.devicePixelRatio || 1;
      const restX = Math.round(metrics.finalX * dpr) / dpr;
      trackEl.style.transform = `translate3d(${restX.toFixed(2)}px,0,0)`;
    } else {
      trackEl.style.transform = `translate3d(${(metrics.x0 - travelled).toFixed(2)}px,0,0)`;
    }
  }

  function buildFull() {
    const viewport = el('div', 'rr-viewport');
    trackEl = el('div', 'rr-track');
    viewport.appendChild(trackEl);
    const marker = el('div', 'rr-marker');
    root.append(viewport, marker);

    // Крок і ширину міряємо на пробному елементі: скільки елементів додати ліворуч і праворуч, залежить від ширини екрана
    const probe = el('div', 'rr-item');
    trackEl.appendChild(probe);
    const step = measureStepOf(probe);
    trackEl.removeChild(probe);
    const around = Math.ceil((root.clientWidth || 640) / 2 / step) + 2;

    // Криву рахуємо ДО стрічки: у режимі scatter стрічка має знати, в який бік підсунеться (decoyOffset),
    // щоб з того боку гарантовано стояв «інший» елемент. stopRel збігається з ribbon.stopIndex - ribbon.startIndex
    curve = createTravelCurve({
      stopRel: Math.max(1, Math.floor(stopIndex)),
      landingOffset,
      seed,
      power: easingPower,
      durationMs,
      suspense
    });
    ribbon = buildRibbon({
      pool, fillers, result, seed, stopIndex, head: around, tail: around, fillerZone,
      scatter, decoySide: curve.decoyOffset
    });

    const fragment = document.createDocumentFragment();
    itemEls = ribbon.items.map(item => {
      const node = el('div', 'rr-item');
      renderItem(item, node);
      fragment.appendChild(node);
      return node;
    });
    trackEl.appendChild(fragment);

    measure();
    placeTrack();

    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        if (destroyed) return;
        measure();
        placeTrack();
      });
      resizeObserver.observe(root);
    }
  }

  // Стрілка пройшла повз елемент: індекс змінюється, коли центр стрічки перетинає межу між елементами
  function reportTick(t) {
    const index = Math.round(ribbon.startIndex + travelled / metrics.step);
    if (index === lastIndex) return;
    const first = lastIndex === -1;
    lastIndex = index;
    if (!first && onTick) onTick({ index, speed: curve.speedAt(t) });
  }

  // ----- Режим 'light' -----

  function buildLight() {
    slotEl = el('div', 'rr-slot');
    const placeholder = el('div', 'rr-item rr-item--slot');
    const mark = el('span', 'rr-qmark');
    mark.textContent = '?';
    placeholder.appendChild(mark);
    slotEl.appendChild(placeholder);

    const progress = el('div', 'rr-progress');
    progress.appendChild(el('span'));
    root.append(slotEl, progress);
  }

  function revealLight() {
    const node = el('div', 'rr-item rr-item--slot is-winner');
    renderItem({ ...result, isResult: true }, node);
    slotEl.replaceChildren(node);
  }

  // ----- Життєвий цикл -----

  function complete() {
    if (finished || destroyed) return;
    finished = true;
    cancelAnimationFrame(rafId);
    clearTimeout(waitTimer);
    // «Запізнився» — тільки той, хто зайшов уже ПІСЛЯ зупинки. Хто приєднався посеред кручення, бачить розкриття з усіма ефектами
    const late = lateJoin && nowFn() - (startAt + durationMs) > LATE_JOIN_MS;

    if (isFull) {
      // Стрічка зупинилась трохи збоку від центру (landingOffset): м'яко вирівнюємо результат під стрілку
      // opacity у списку теж: після зупинки оверлей гасить усю стрічку одним шаром (css/components/roulette.css)
      trackEl.style.transition = late ? 'none' : `transform ${SETTLE_MS}ms cubic-bezier(.2, 1.15, .3, 1), opacity .5s ease`;
      placeTrack();
      trackEl.classList.add('is-done');
      itemEls[ribbon.stopIndex].classList.add('is-winner');
    } else {
      revealLight();
    }
    root.classList.add('is-done');
    onFinish?.({ late });
  }

  // Фази інтриги: кожна оголошується один раз, коли стрічка дійшла до її позначки (позначки — з кривої, тож однакові в усіх)
  function emitPhases(t) {
    if (!curve?.marks || !onPhase) return;
    for (const name of ['approach', 'hold', 'snap']) {
      if (phaseSeen[name] || t < curve.marks[name]) continue;
      phaseSeen[name] = true;
      const missed = nowFn() - (startAt + curve.marks[name] * durationMs) > LATE_JOIN_MS;
      const untilSnapMs = Math.max(0, startAt + curve.marks.snap * durationMs - nowFn());
      onPhase(name, { missed, untilSnapMs, swaps: curve.swaps });
    }
  }

  function frame() {
    rafId = 0;
    if (destroyed || finished) return;

    const elapsed = nowFn() - startAt;
    if (elapsed < 0) { // ще пауза перед стартом: стрічка стоїть на місці
      waitTimer = setTimeout(frame, Math.max(10, -elapsed - 10));
      return;
    }

    const t = Math.min(1, elapsed / durationMs);
    travelled = curve.at(t) * metrics.step;
    placeTrack();
    reportTick(t);
    emitPhases(t);

    if (t >= 1) {
      complete();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function startLight() {
    const elapsed = nowFn() - startAt;
    if (elapsed >= durationMs) {
      complete();
      return;
    }
    // Смужка прогресу — CSS-анімація на transform: відлік уже минулого часу робить від'ємна затримка
    root.style.setProperty('--rr-duration', `${durationMs}ms`);
    root.style.setProperty('--rr-elapsed', `${Math.max(0, elapsed)}ms`);
    const wait = -elapsed;
    if (wait > 0) {
      waitTimer = setTimeout(() => root.classList.add('is-running'), wait);
    } else {
      root.classList.add('is-running');
    }
    clearTimeout(waitTimer && 0); // (лише щоб не плутати наступний таймер із попереднім)
    const finishTimer = setTimeout(complete, Math.max(0, startAt + durationMs - nowFn()));
    const previous = waitTimer;
    waitTimer = finishTimer;
    if (previous) root._startTimer = previous;
  }

  if (isFull) buildFull();
  else buildLight();

  return {
    // startAt — момент початку кручення, now — функція поточного часу в ТОМУ Ж годиннику (getGlobalTime)
    start({ startAt: at, now = Date.now }) {
      if (started || destroyed) return;
      started = true;
      startAt = Number(at);
      nowFn = now;
      lateJoin = nowFn() - startAt > LATE_JOIN_MS;

      if (isFull) {
        rafId = requestAnimationFrame(frame);
        // Вкладка у фоні не викликає rAF: страхувальний таймер розкриває результат за розкладом (complete ідемпотентний)
        fallbackTimer = setTimeout(complete, Math.max(0, startAt + durationMs - nowFn()) + 80);
      } else {
        startLight();
      }
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(waitTimer);
      if (root._startTimer) clearTimeout(root._startTimer);
      clearTimeout(fallbackTimer);
      resizeObserver?.disconnect();
      root.remove();
    },
    getMode: () => (isFull ? 'full' : 'light'),
    isFinished: () => finished
  };
}
