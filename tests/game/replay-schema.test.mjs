import assert from 'node:assert';

// I-8: XOR + FNV-1a з публічним ключем не захищають від підробки (хто знає схему, перерахує суму),
// тому структура реплею має перевірятись окремо: і при читанні файлу, і перед записом у sessionStorage.

const stored = [];
globalThis.sessionStorage = { setItem: (k, v) => stored.push([k, v]), getItem: () => null };
globalThis.window = { location: { hash: '' } };

const { encodeReplayData, decodeReplayData, launchOfflineReplay, validateReplayPayload } =
  await import('../../js/services/replay-service.js');

const validRoom = () => ({
  room_code: 'ABCD12',
  status: 'closed',
  host_id: 'host-1',
  selected_pack_id: 'pack-1',
  selected_pack_title: 'Базовий',
  players_state: {
    p1: { name: 'Гравець 1', is_alive: true, special_abilities: [{ text: 'Швидке лікування', is_revealed: false }] },
    p2: { name: 'Гравець 2', is_alive: false, special_abilities: null },
  },
  bunker_state: { round: 3 },
  some_future_field: { anything: true },
});

let failed = 0;
function check(name, fn) {
  try { stored.length = 0; globalThis.window.location.hash = ''; fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('Running replay-schema tests...');

check('валідна кімната проходить перевірку (невідомі поля не відкидаються)', () => {
  assert.strictEqual(validateReplayPayload(validRoom()), null);
});

check('кругова перевірка encode -> decode повертає ті самі дані', () => {
  const room = validRoom();
  assert.deepStrictEqual(decodeReplayData(encodeReplayData(room)), room);
});

check('кімната без bunker_state та з порожнім lobby-станом приймається', () => {
  const room = validRoom();
  delete room.bunker_state;
  room.status = 'lobby';
  assert.strictEqual(validateReplayPayload(room), null);
  assert.strictEqual(validateReplayPayload({ ...room, bunker_state: null }), null);
});

const BAD = [
  ['масив замість об’єкта', () => []],
  ['рядок замість об’єкта', () => 'room'],
  ['число замість об’єкта', () => 42],
  ['без players_state', () => { const r = validRoom(); delete r.players_state; return r; }],
  ['players_state — масив', () => ({ ...validRoom(), players_state: [{ name: 'A' }] })],
  ['players_state — рядок', () => ({ ...validRoom(), players_state: 'x' })],
  ['гравець — не об’єкт', () => ({ ...validRoom(), players_state: { p1: 5 } })],
  ['гравець — null', () => ({ ...validRoom(), players_state: { p1: null } })],
  ['ім’я гравця — не рядок', () => ({ ...validRoom(), players_state: { p1: { name: { a: 1 } } } })],
  ['ім’я гравця задовге', () => ({ ...validRoom(), players_state: { p1: { name: 'x'.repeat(200) } } })],
  ['special_abilities — не масив', () => ({ ...validRoom(), players_state: { p1: { name: 'A', special_abilities: 'x' } } })],
  ['room_code — не рядок', () => ({ ...validRoom(), room_code: { a: 1 } })],
  ['room_code із HTML', () => ({ ...validRoom(), room_code: '<img src=x onerror=alert(1)>' })],
  ['room_code задовгий', () => ({ ...validRoom(), room_code: 'A'.repeat(40) })],
  ['status — не рядок', () => ({ ...validRoom(), status: ['closed'] })],
  ['bunker_state — масив', () => ({ ...validRoom(), bunker_state: [] })],
  ['bunker_state — рядок', () => ({ ...validRoom(), bunker_state: 'x' })],
  ['надто багато гравців', () => {
    const ps = {};
    for (let i = 0; i < 500; i++) ps[`p${i}`] = { name: `P${i}` };
    return { ...validRoom(), players_state: ps };
  }],
  ['ключ __proto__ у корені', () => JSON.parse('{"room_code":"A","players_state":{},"__proto__":{"polluted":true}}')],
  ['ключ __proto__ у вкладеному об’єкті', () => JSON.parse('{"room_code":"A","players_state":{"p1":{"name":"A","__proto__":{"x":1}}}}')],
  ['ключ constructor у вкладеному об’єкті', () => ({ ...validRoom(), bunker_state: { constructor: { prototype: { x: 1 } } } })],
  ['надто глибока вкладеність', () => {
    let deep = {};
    for (let i = 0; i < 60; i++) deep = { n: deep };
    return { ...validRoom(), bunker_state: deep };
  }],
];

for (const [label, make] of BAD) {
  check(`validateReplayPayload відхиляє: ${label}`, () => {
    const err = validateReplayPayload(make());
    assert.strictEqual(typeof err, 'string', 'очікували текст помилки');
    assert.ok(err.length > 0);
  });
}

// Підроблений файл: контрольна сума правильна (її можна перерахувати), структура — ні
for (const [label, make] of BAD.slice(0, 18)) {
  check(`decodeReplayData відхиляє підроблений файл із правильною сумою: ${label}`, () => {
    let file;
    try { file = encodeReplayData(make()); } catch (_) { return; } // encode міг не впоратись зі сміттям — теж ок
    assert.throws(() => decodeReplayData(file), /структур|некоректн|недійсн|не є дійсним/i);
  });
}

check('launchOfflineReplay: невалідна структура не потрапляє в sessionStorage', () => {
  assert.throws(() => launchOfflineReplay({ room_code: 'A', players_state: [1, 2, 3] }), /структур|некоректн/i);
  assert.strictEqual(stored.length, 0, 'у sessionStorage нічого не мало бути записано');
  assert.strictEqual(globalThis.window.location.hash, '', 'перехід у режим перегляду не мав статись');
});

check('launchOfflineReplay: надмірно великий реплей відхиляється до запису', () => {
  const room = validRoom();
  room.players_state.p1.notes = 'x'.repeat(5_000_000);
  assert.throws(() => launchOfflineReplay(room), /завеликий|великий|розмір/i);
  assert.strictEqual(stored.length, 0);
});

check('launchOfflineReplay: валідний реплей записується як закрита кімната і запускає перегляд', () => {
  launchOfflineReplay(validRoom());
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(JSON.parse(stored[0][1]).status, 'closed');
  assert.match(globalThis.window.location.hash, /offline_replay/);
});

check('launchOfflineReplay: без даних кидає помилку як і раніше', () => {
  assert.throws(() => launchOfflineReplay(null), /відсутні/);
});

if (failed) {
  console.error(`FAIL: replay-schema (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all replay-schema tests passed!');
