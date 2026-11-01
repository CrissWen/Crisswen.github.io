import assert from 'node:assert';
import {
  createRng,
  easeOutPower,
  landingOffsetFromSeed,
  createTravelCurve,
  buildRibbon
} from '../../js/utils/roulette-ribbon.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map(k => ({ key: k, label: k.toUpperCase() }));
const fillers = ['x', 'y', 'z'].map(k => ({ key: k, filler: true }));
const result = pool[2];
const base = { pool, fillers, result, stopIndex: 40, head: 8, tail: 14 };
const keys = ribbon => ribbon.items.map(i => i.key).join(',');

console.log('Running roulette-ribbon tests...');

check('createRng: однаковий seed дає однакову послідовність', () => {
  const a = createRng(12345), b = createRng(12345);
  for (let i = 0; i < 50; i++) assert.strictEqual(a(), b());
});

check('createRng: значення в [0, 1), різні seed дають різні послідовності', () => {
  const a = createRng(1), b = createRng(2);
  let same = 0;
  for (let i = 0; i < 50; i++) {
    const x = a(), y = b();
    assert.ok(x >= 0 && x < 1 && y >= 0 && y < 1);
    if (x === y) same++;
  }
  assert.ok(same < 5, 'послідовності різних seed не мають збігатися');
});

check('buildRibbon: однаковий seed дає ідентичну стрічку', () => {
  assert.strictEqual(keys(buildRibbon({ ...base, seed: 777 })), keys(buildRibbon({ ...base, seed: 777 })));
});

check('buildRibbon: різні seed дають різні стрічки', () => {
  assert.notStrictEqual(keys(buildRibbon({ ...base, seed: 1 })), keys(buildRibbon({ ...base, seed: 2 })));
});

check('buildRibbon: результат стоїть рівно на stopIndex і помічений isResult', () => {
  for (const seed of [1, 2, 3, 99, 4242]) {
    const r = buildRibbon({ ...base, seed });
    assert.strictEqual(r.items[r.stopIndex].key, result.key);
    assert.strictEqual(r.items[r.stopIndex].isResult, true);
    assert.strictEqual(r.stopIndex - r.startIndex, base.stopIndex);
  }
});

check('buildRibbon: startIndex дорівнює head, довжина = head + stop + 7 + (tail - 6)', () => {
  const r = buildRibbon({ ...base, seed: 5 });
  assert.strictEqual(r.startIndex, base.head);
  assert.strictEqual(r.items.length, base.head + base.stopIndex + 7 + (base.tail - 6));
});

check('buildRibbon: сусіди результату не повторюють результат', () => {
  for (const seed of [1, 2, 3, 10, 11, 12, 500]) {
    const r = buildRibbon({ ...base, seed });
    assert.notStrictEqual(r.items[r.stopIndex - 1].key, result.key);
    assert.notStrictEqual(r.items[r.stopIndex + 1].key, result.key);
  }
});

check('buildRibbon: після результату лише справжні елементи (без декоративних)', () => {
  const r = buildRibbon({ ...base, seed: 31 });
  for (let i = r.stopIndex + 1; i < r.items.length; i++) assert.ok(!r.items[i].filler, `index ${i}`);
});

check('buildRibbon: спільна частина не залежить від ширини екрана (head/tail)', () => {
  const narrow = buildRibbon({ ...base, seed: 8, head: 2, tail: 6 });
  const wide = buildRibbon({ ...base, seed: 8, head: 12, tail: 20 });
  const mainOf = (r, head) => keys({ items: r.items.slice(head, head + base.stopIndex + 7) });
  assert.strictEqual(mainOf(narrow, 2), mainOf(wide, 12));
});

check('buildRibbon: без результату кидає помилку', () => {
  assert.throws(() => buildRibbon({ pool, seed: 1, stopIndex: 10 }), /результат/);
});

check('buildRibbon scatter: серія однакових не довша за 3 у спільній частині', () => {
  const two = [{ key: 'p' }, { key: 'q' }];
  const r = buildRibbon({ pool: two, result: two[0], seed: 9, stopIndex: 60, head: 0, tail: 6, scatter: true });
  let run = 1, maxRun = 1;
  for (let i = 1; i < r.stopIndex - 1; i++) {
    run = r.items[i].key === r.items[i - 1].key ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  assert.ok(maxRun <= 3, `maxRun=${maxRun}`);
});

check('buildRibbon scatter: з боку підсуву поруч із результатом стоїть інший елемент', () => {
  const two = [{ key: 'p' }, { key: 'q' }];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const left = buildRibbon({ pool: two, result: two[0], seed, stopIndex: 30, scatter: true, decoySide: -1 });
    assert.notStrictEqual(left.items[left.stopIndex - 1].key, 'p');
    const right = buildRibbon({ pool: two, result: two[0], seed, stopIndex: 30, scatter: true, decoySide: 1 });
    assert.notStrictEqual(right.items[right.stopIndex + 1].key, 'p');
  }
});

check('easeOutPower: 0 → 0, 1 → 1, монотонно зростає, обмежує вхід', () => {
  assert.strictEqual(easeOutPower(0), 0);
  assert.strictEqual(easeOutPower(1), 1);
  assert.strictEqual(easeOutPower(-5), 0);
  assert.strictEqual(easeOutPower(7), 1);
  let prev = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const v = easeOutPower(t);
    assert.ok(v >= prev);
    prev = v;
  }
});

check('landingOffsetFromSeed: детермінований і в межах ±maxFraction', () => {
  for (const seed of [0, 1, 2, 12345, 0xFFFFFFFF]) {
    const v = landingOffsetFromSeed(seed, 0.25);
    assert.strictEqual(v, landingOffsetFromSeed(seed, 0.25));
    assert.ok(Math.abs(v) <= 0.25);
  }
});

check('createTravelCurve: at(0)=0 і at(1)=stopRel+landingOffset (без інтриги)', () => {
  const c = createTravelCurve({ stopRel: 40, landingOffset: 0.1, seed: 3 });
  assert.strictEqual(c.at(0), 0);
  assert.ok(Math.abs(c.at(1) - 40.1) < 1e-9);
  assert.strictEqual(c.marks, null);
  assert.strictEqual(c.swaps, false);
});

check('createTravelCurve з інтригою: фінал збігається з результатом і час подій упорядкований', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const c = createTravelCurve({ stopRel: 40, landingOffset: -0.15, seed, durationMs: 6000, suspense: true });
    assert.ok(Math.abs(c.at(1) - 39.85) < 1e-9, `seed ${seed}`);
    assert.ok(c.marks.approach < c.marks.hold && c.marks.hold < c.marks.snap && c.marks.snap < 1, `seed ${seed}`);
  }
});

check('createTravelCurve з інтригою: однаковий seed — те саме рішення про підсув на всіх клієнтах', () => {
  for (const seed of [1, 2, 3, 100, 2024]) {
    const a = createTravelCurve({ stopRel: 40, seed, suspense: true });
    const b = createTravelCurve({ stopRel: 40, seed, suspense: true });
    assert.strictEqual(a.decoyOffset, b.decoyOffset);
    assert.strictEqual(a.swaps, b.swaps);
    for (const t of [0.1, 0.5, 0.85, 0.95]) assert.strictEqual(a.at(t), b.at(t));
  }
});

check('createTravelCurve: swapChance 1 завжди підсуває на сусіда, 0 — ніколи', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const always = createTravelCurve({ stopRel: 40, seed, suspense: { swapChance: 1 } });
    assert.ok(always.decoyOffset === -1 || always.decoyOffset === 1);
    const never = createTravelCurve({ stopRel: 40, seed, suspense: { swapChance: 0 } });
    assert.strictEqual(never.decoyOffset, 0);
  }
});

check('createTravelCurve: у фазі зависання стрічка стоїть на місці', () => {
  const c = createTravelCurve({ stopRel: 40, seed: 5, durationMs: 6000, suspense: { swapChance: 1 } });
  const mid = (c.marks.hold + c.marks.snap) / 2;
  assert.strictEqual(c.at(c.marks.hold + 1e-6), c.at(mid));
});

check('createTravelCurve: speedAt у межах 0..1 і наприкінці майже 0', () => {
  const c = createTravelCurve({ stopRel: 40, seed: 5, durationMs: 6000 });
  for (let t = 0; t <= 1; t += 0.05) {
    const s = c.speedAt(t);
    assert.ok(s >= 0 && s <= 1);
  }
  assert.ok(c.speedAt(0.99) < 0.1);
});

check('createTravelCurve: інтрига ігнорується, якщо результат ближче за 3 кроки', () => {
  const c = createTravelCurve({ stopRel: 2, seed: 5, suspense: true });
  assert.strictEqual(c.marks, null);
});

if (failed) {
  console.error(`FAIL: roulette-ribbon (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all roulette-ribbon tests passed!');
