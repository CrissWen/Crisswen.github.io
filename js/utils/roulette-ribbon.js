// ===== Чиста математика рулетки (без DOM і без залежностей) =====
// Спільна для всіх рулеток гри (ui/roulette-reel.js): будує стрічку елементів за seed і задає криву гальмування.
// Однаковий seed дає однакову стрічку на всіх пристроях, тож кожен гравець бачить ту саму прокрутку.
// Елементи — довільні об'єкти { key, ...дані }: key потрібен лише для порівняння («не клади однакові поруч»).

// Детермінований генератор випадкових чисел (mulberry32): seed (uint32) → функція, що щоразу повертає число з [0, 1)
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Крива гальмування: 0 → 1, на старті найшвидша, наприкінці «доповзає». Чим більший power, тим різкіше гальмування
// (3 — як у відкритті кейсів: остання секунда з п'яти зсуває стрічку менш ніж на пів елемента).
export function easeOutPower(t, power = 3) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  return 1 - Math.pow(1 - x, Math.max(1, power));
}

// Зсув приземлення в частках кроку стрічки (−maxFraction…+maxFraction): результат зупиняється не рівно по центру,
// а трохи збоку, як у справжніх кейсах, а потім м'яко вирівнюється (див. ui/roulette-reel.js). Детермінований за seed.
export function landingOffsetFromSeed(seed, maxFraction = 0.25) {
  const r = createRng((seed ^ 0x9E3779B9) >>> 0)();
  return (r * 2 - 1) * maxFraction;
}

// ===== Крива проїзду стрічки =====
// Положення стрічки як функція часу: at(t) — скільки КРОКІВ (елементів) вона проїхала від старту, t — частка тривалості 0..1.
// Без DOM: однакова на всіх клієнтах, бо залежить лише від seed і параметрів.
//
// Звичайна крива — одне плавне гальмування до результату. З інтригою (suspense) стрічка гальмує й майже зупиняється, на мить
// зависає, а далі або ЛИШАЄТЬСЯ там, де стала, або ПІДСОВУЄТЬСЯ на сусідній елемент:
//
//   0 ─── гальмування ─── stopAt ── зависання ── snapAt ── ривок (або нічого) ── 1
//          ↑ marks.approach: тут починає наростати напруження (серцебиття, темніють краї)
//
// Рішення «лишається чи підсувається» — одне кидання за seed (swapChance, за замовчуванням 20%), тож у всіх клієнтів однакове і
// гравець не може вгадати його наперед. Якщо випало «підсувається», сторона (вліво чи вправо) — ще одне кидання 50/50.
// Тоді стрічка зупиняється на сусідньому елементі (приманка), а потім доїжджає (або відкочується) на справжній результат.
// У buildRibbon сусіди результату завжди справжні варіанти пака, а не повтор результату, тож приманка виглядає як інший катаклізм.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// stopRel — на скільки кроків від старту стоїть результат; landingOffset — зсув приземлення (див. landingOffsetFromSeed);
// power — різкість гальмування; durationMs — повна тривалість;
// suspense — false | true | { holdMs, snapMs, approachMs, decoyReach, powerBoost, swapChance (0..1, за замовчуванням 0.2) }.
// Повертає { at(t), speedAt(t) (0..1, для звуку), marks: { approach, hold, snap } | null,
//            decoyOffset: 0 (лишається на результаті) | -1 (приманка ДО нього) | 1 (приманка ПІСЛЯ нього), swaps: чи буде підсув }
export function createTravelCurve({ stopRel, landingOffset = 0, seed = 0, power = 3, durationMs = 6000, suspense = false }) {
  const target = stopRel + landingOffset;
  const duration = Math.max(1, Number(durationMs) || 1);

  let at = t => target * easeOutPower(t, power);
  let marks = null;
  let decoyOffset = 0; // 0 — стрічка лишається там, де стала; ±1 — підсувається з сусіднього елемента

  if (suspense && stopRel >= 3) {
    const cfg = typeof suspense === 'object' ? suspense : {};
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

    let holdMs = clamp(num(cfg.holdMs, duration * 0.09), 320, 650);   // «зупинилась»: стоїть на приманці
    let snapMs = clamp(num(cfg.snapMs, duration * 0.07), 240, 420);   // ривок на справжній результат
    const tail = holdMs + snapMs;
    const maxTail = duration * 0.5; // на коротких рулетках інтрига не з'їдає більше половини часу
    if (tail > maxTail) {
      holdMs *= maxTail / tail;
      snapMs *= maxTail / tail;
    }
    const snapAt = 1 - snapMs / duration;
    const stopAt = snapAt - holdMs / duration;
    const approachMs = clamp(num(cfg.approachMs, 1300), 400, duration * 0.4);
    const approachAt = clamp(snapAt - approachMs / duration, 0.2, stopAt - 0.05);

    const rng = createRng((seed ^ 0x7E57ED1) >>> 0);
    const swaps = rng() < clamp(num(cfg.swapChance, 0.2), 0, 1); // загальний шанс підсуву, а не по кожній стороні окремо
    if (swaps) decoyOffset = rng() < 0.5 ? -1 : 1;                // і лише тоді сторона: вліво чи вправо 50/50
    const reach = clamp(num(cfg.decoyReach, 0.12), 0, 0.25);
    // Підсув: зупинка майже по центру сусіда, щоб вона виглядала переконливо. Без підсуву: зупиняємось рівно там, де зупиниться
    // результат, тож ривку немає, а стрічка далі лише м'яко вирівнюється під стрілку
    const decoy = swaps ? stopRel + decoyOffset + (rng() * 2 - 1) * reach : target;
    const runPower = Math.max(1.5, power + num(cfg.powerBoost, 0.25));

    at = t => {
      if (t <= 0) return 0;
      if (t < stopAt) return decoy * easeOutPower(t / stopAt, runPower);
      if (t < snapAt) return decoy;
      if (t >= 1) return target;
      return decoy + (target - decoy) * easeOutPower((t - snapAt) / (1 - snapAt), 2.6);
    };
    marks = { approach: approachAt, hold: stopAt, snap: snapAt };
  }

  // Миттєва швидкість, нормована на початкову: 1 — стрічка летить, 0 — стоїть. Для звуку «клацань» (висота й гучність)
  const step = 0.004;
  const v0 = Math.max(1e-6, Math.abs(at(0.01) - at(0)) / 0.01);
  const speedAt = t => clamp(Math.abs(at(Math.min(1, t + step)) - at(Math.max(0, t - step))) / (2 * step) / v0, 0, 1);

  return { at, speedAt, marks, decoyOffset, swaps: decoyOffset !== 0 };
}

// Скільки елементів ПІСЛЯ результату входять у «спільну» частину стрічки (однакову на будь-якому екрані).
// Решта хвоста, потрібна лише широким екранам, добудовується окремим генератором.
const SHARED_TAIL = 6;
const NO_KEYS = new Set();

// Збирає стрічку: [head елементів] + [від старту до результату і SHARED_TAIL після нього] + [додатковий хвіст].
//   pool        — «справжні» елементи (реальні варіанти); у фінальній, повільній частині стрічки є лише вони
//   fillers     — декоративні елементи: домішуються у швидку фазу, коли їх однаково не розгледіти
//   result      — елемент, на якому стрічка зупиняється (ставиться на позицію head + stopIndex)
//   stopIndex   — на скільки елементів стрічка проїжджає від старту до результату
//   head / tail — скільки елементів додати ліворуч від старту й праворуч від результату (залежить від ширини екрана)
//   fillerZone  — частка шляху від старту (0..1), у межах якої дозволені декоративні елементи
//   fillerShare — ймовірність обрати декоративний елемент у цій зоні
// Повертає { items, startIndex, stopIndex }: індекси — у масиві items.
export function buildRibbon({
  pool,
  fillers = [],
  result,
  seed,
  stopIndex,
  head = 0,
  tail = 0,
  fillerZone = 0.55,
  fillerShare = 0.6
}) {
  if (!result) throw new Error('buildRibbon: потрібен результат рулетки');

  const real = Array.isArray(pool) && pool.length > 0 ? pool : [result];
  const decor = Array.isArray(fillers) ? fillers : [];
  const stop = Math.max(1, Math.floor(stopIndex));
  const resultKey = result.key;

  // Вибір елемента: не такий самий, як попередній; біля результату — ще й не такий самий, як результат.
  // Якщо за кілька спроб не вийшло (мізерний пул), беремо декоративний, а за його відсутності погоджуємось на повтор.
  function pick(rng, prevKey, forbidden, allowFillers) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const list = allowFillers && decor.length > 0 && rng() < fillerShare ? decor : real;
      const item = list[Math.floor(rng() * list.length)];
      if (item.key !== prevKey && !forbidden.has(item.key)) return item;
    }
    const list = decor.length > 0 ? decor : real;
    return list[Math.floor(rng() * list.length)];
  }

  // Основна частина: однакова для всіх клієнтів, бо залежить лише від seed
  const rng = createRng(seed);
  const main = [];
  const mainLength = stop + SHARED_TAIL + 1;
  for (let i = 0; i < mainLength; i++) {
    if (i === stop) {
      main.push({ ...result, isResult: true });
      continue;
    }
    const nearResult = Math.abs(i - stop) <= 1;
    const prevKey = i > 0 ? main[i - 1].key : null;
    const allowFillers = i / stop < fillerZone; // після результату i / stop > 1, тож там лише справжні
    main.push(pick(rng, prevKey, nearResult ? new Set([resultKey]) : NO_KEYS, allowFillers));
  }

  // Голова (ліворуч від старту): на старті вона видна, але стрічка одразу від'їжджає, тож тут дозволені будь-які елементи
  const headItems = new Array(Math.max(0, head));
  const headRng = createRng((seed ^ 0xA5A5A5A5) >>> 0);
  let prevKey = main[0].key;
  for (let i = headItems.length - 1; i >= 0; i--) {
    headItems[i] = pick(headRng, prevKey, NO_KEYS, true);
    prevKey = headItems[i].key;
  }

  // Додатковий хвіст для широких екранів: після результату на екрані лишаються лише справжні елементи
  const extraTail = [];
  const tailRng = createRng((seed ^ 0x5A5A5A5A) >>> 0);
  prevKey = main[main.length - 1].key;
  for (let i = 0; i < Math.max(0, tail - SHARED_TAIL); i++) {
    const item = pick(tailRng, prevKey, NO_KEYS, false);
    extraTail.push(item);
    prevKey = item.key;
  }

  return {
    items: [...headItems, ...main, ...extraTail],
    startIndex: headItems.length,
    stopIndex: headItems.length + stop
  };
}
