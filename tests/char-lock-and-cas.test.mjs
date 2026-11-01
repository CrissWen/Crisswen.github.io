import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from './helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 5, updateDelayMs: 5 });
const { toggleCharacteristicReveal, buildRevealChanges, revertRevealChanges } = await import(
  '../js/game-modules/controllers/char-lock.js'
);
const { withRoomAction, undoLastAction, snapshot } = await import('../js/utils/host/room-store.js');
const { nextEventId } = await import('../js/utils/log-writer.js');
const { setHostEvent } = await import('../js/utils/host/common.js');

test('I6: buildRevealChanges та revertRevealChanges змінюють лише прапорці is_revealed і не затирають вкрадену картку', () => {
  const player = {
    name: 'Гравець',
    gender: { value: 'Чоловік', is_revealed: false },
    age: { value: 28, is_revealed: false },
    childfree: { value: true, is_revealed: false },
    professions: [{ title: 'Інженер', is_revealed: false }],
  };

  // Відкриваємо стать (разом із віком і childfree)
  assert.equal(toggleCharacteristicReveal(player, 'gender'), true);
  const genderChanges = buildRevealChanges(player, 'gender');
  assert.deepEqual(genderChanges, [
    { path: ['gender'], value: true },
    { path: ['age'], value: true },
    { path: ['childfree'], value: true },
  ]);

  // Імітуємо, що поки йшов RPC, ведучий змінив значення віку та професії через Realtime
  player.age.value = 45;
  player.professions[0].title = 'Хірург';

  // Помилка мережі: відкочуємо лише прапорці is_revealed
  revertRevealChanges(player, genderChanges);
  assert.equal(player.gender.is_revealed, false);
  assert.equal(player.age.is_revealed, false);
  assert.equal(player.childfree.is_revealed, false);
  assert.equal(player.age.value, 45, 'Новий вік від ведучого не затертий старим snapshot');
  assert.equal(player.professions[0].title, 'Хірург', 'Нова професія не затерта старим snapshot');
});

test('I3: undoLastAction зберігає голоси, подані під час активного голосування після дії з карткою', async () => {
  const initialRoom = {
    room_code: 'UNDO01',
    status: 'in_progress',
    version: 1,
    bunker_state: {
      capacity: 2,
      voting: { isActive: true, votes: { p1: 'p2' } },
      logs: [],
    },
    players_state: {
      p1: { name: 'Аня', traits: [{ value: 'Спокійна', is_revealed: false }] },
      p2: { name: 'Богдан', traits: [{ value: 'Сміливий', is_revealed: false }] },
    },
  };
  fake.__seedRoom(initialRoom);

  // Ведучий робить знімок перед дією з характеристикою
  snapshot(initialRoom);

  // Ведучий змінив рису p1, а тим часом p2 теж проголосував у активному голосуванні
  const currentRoom = fake.__getRoomRaw('UNDO01');
  currentRoom.players_state.p1.traits[0].value = 'Панікер';
  currentRoom.bunker_state.voting.votes.p2 = 'p1';

  await undoLastAction('UNDO01');

  const afterUndo = fake.__getRoomRaw('UNDO01');
  assert.equal(afterUndo.players_state.p1.traits[0].value, 'Спокійна', 'Характеристика p1 повернулась до стану зі знімка');
  assert.deepEqual(
    afterUndo.bunker_state.voting.votes,
    { p1: 'p2', p2: 'p1' },
    'Голос p2 не загубився при скасуванні дії з карткою'
  );
});

test('I5: nextEventId та setHostEvent генерують строго монотонно зростаючі id у межах однієї мілісекунди', () => {
  const bState = { logs: [] };
  setHostEvent(bState, 'Подія 1');
  const firstEventId = bState.latest_host_event.id;
  setHostEvent(bState, 'Подія 2');
  const secondEventId = bState.latest_host_event.id;

  assert.ok(secondEventId > firstEventId, 'Друга подія в ту саму мс має більший id');
  assert.ok(bState.logs[1].id > bState.logs[0].id, 'Записи логу мають строго зростаючі id');
  assert.ok(nextEventId() > secondEventId);
});

test('CAS: withRoomAction автоматично повторює спробу при VERSION_CONFLICT', async () => {
  fake.__seedRoom({
    room_code: 'CAS01',
    status: 'in_progress',
    version: 0,
    bunker_state: { capacity: 2 },
    players_state: {},
  });

  let attempts = 0;
  await withRoomAction('CAS01', async (room) => {
    attempts++;
    if (attempts === 1) {
      // Імітуємо, що інший запит встиг підняти version у БД до saveRoom
      fake.__getRoomRaw('CAS01').version += 1;
    }
    return { bunker_state: { ...room.bunker_state, capacity: 3 } };
  });

  assert.equal(attempts, 2, 'Друга спроба успішно застосувала патч після VERSION_CONFLICT');
  assert.equal(fake.__getRoomRaw('CAS01').bunker_state.capacity, 3);
});

