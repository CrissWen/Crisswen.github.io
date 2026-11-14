import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from '../helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 5, updateDelayMs: 5 });
const { toggleCharacteristicReveal, buildRevealChanges, revertRevealChanges, handleCharLockClick } = await import(
  '../../js/game-modules/controllers/char-lock.js'
);
const { withRoomAction, undoLastAction, snapshot } = await import('../../js/utils/host/room-store.js');
const { nextEventId } = await import('../../js/utils/game/log-writer.js');
const { setHostEvent } = await import('../../js/utils/host/common.js');

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

test('set_my_reveals atomically updates player reveal and appends log in single version increment', async () => {
  const room = {
    room_code: 'ATOMIC01',
    status: 'in_progress',
    version: 1,
    bunker_state: { capacity: 2, logs: [] },
    players_state: {
      'user-1': { name: 'Юзер', traits: [{ value: 'Спокійний', is_revealed: false }] }
    }
  };
  fake.__seedRoom(room);

  const { error } = await fake.rpc('set_my_reveals', {
    __userId: 'user-1',
    p_room: 'ATOMIC01',
    p_changes: [{ path: ['traits', '0'], value: true }],
    p_log_text: 'Гравець Юзер відкрив характеристику Риса',
    p_max_logs: 100
  });

  assert.equal(error, null);
  const updated = fake.__getRoomRaw('ATOMIC01');
  assert.equal(updated.version, 2, 'Version should increment only once');
  assert.equal(updated.players_state['user-1'].traits[0].is_revealed, true);
  assert.equal(updated.bunker_state.logs.length, 1);
  assert.match(updated.bunker_state.logs[0].text, /відкрив характеристику Риса/);
});

test('set_my_reveals with empty bunker_state updates reveal without failing or adding logs', async () => {
  fake.__seedRoom({
    room_code: 'ATOMIC_EMPTY',
    status: 'lobby',
    version: 1,
    bunker_state: {},
    players_state: {
      'user-1': { name: 'Юзер', traits: [{ value: 'Спокійний', is_revealed: false }] }
    }
  });

  const { error } = await fake.rpc('set_my_reveals', {
    __userId: 'user-1',
    p_room: 'ATOMIC_EMPTY',
    p_changes: [{ path: ['traits', '0'], value: true }],
    p_log_text: 'Гравець Юзер відкрив характеристику Риса',
    p_max_logs: 100
  });

  assert.equal(error, null);
  const updated = fake.__getRoomRaw('ATOMIC_EMPTY');
  assert.equal(updated.version, 2);
  assert.equal(updated.players_state['user-1'].traits[0].is_revealed, true);
  assert.deepEqual(updated.bunker_state, {});
});

test('handleCharLockClick triggers single set_my_reveals RPC with both changes and logText (single version bump)', async () => {
  fake.__setActiveUser('user-1');
  const roomData = {
    room_code: 'LOCK_CLICK_01',
    status: 'in_progress',
    version: 1,
    bunker_state: { capacity: 2, logs: [] },
    players_state: {
      'user-1': {
        name: 'Олексій',
        gender: { value: 'Чоловік', is_revealed: false },
        age: { value: 30, is_revealed: false },
        childfree: { value: false, is_revealed: false }
      }
    }
  };
  fake.__seedRoom(roomData);

  const localState = structuredClone(roomData);
  let refreshCount = 0;
  const ctx = {
    getRoomCode: () => 'LOCK_CLICK_01',
    getUserId: () => 'user-1',
    getUserName: () => 'Олексій',
    getRoomState: () => localState,
    refreshBoard: () => { refreshCount++; }
  };

  const charItem = {
    dataset: { dbkey: 'gender' },
    classList: { contains: () => false },
    querySelector: (sel) => (sel === '.char-label' ? { textContent: 'Стать і вік' } : null)
  };
  const lockBtn = {
    classList: { add: () => {}, remove: () => {} },
    closest: (sel) => (sel === '.char-item' ? charItem : null)
  };

  await handleCharLockClick(lockBtn, ctx, async () => true);

  const updated = fake.__getRoomRaw('LOCK_CLICK_01');
  assert.equal(updated.version, 2, 'Room version must increment exactly once (no separate append_log update)');
  assert.equal(updated.players_state['user-1'].gender.is_revealed, true);
  assert.equal(updated.players_state['user-1'].age.is_revealed, true);
  assert.equal(updated.players_state['user-1'].childfree.is_revealed, true);
  assert.equal(updated.bunker_state.logs.length, 1);
  assert.equal(updated.bunker_state.logs[0].text, 'Гравець Олексій відкрив характеристику Стать і вік');
  assert.equal(refreshCount, 1);
});

test('handleCharLockClick rolls back local reveal flags and appends no log when room is closed', async () => {
  fake.__setActiveUser('user-1');
  const roomData = {
    room_code: 'LOCK_CLOSED_01',
    status: 'closed',
    version: 1,
    bunker_state: { capacity: 2, logs: [] },
    players_state: {
      'user-1': {
        name: 'Олексій',
        traits: [{ value: 'Спокійний', is_revealed: false }]
      }
    }
  };
  fake.__seedRoom(roomData);

  const localState = structuredClone(roomData);
  let refreshCount = 0;
  const ctx = {
    getRoomCode: () => 'LOCK_CLOSED_01',
    getUserId: () => 'user-1',
    getUserName: () => 'Олексій',
    getRoomState: () => localState,
    refreshBoard: () => { refreshCount++; }
  };

  const charItem = {
    dataset: { dbkey: 'traits', idx: '0' },
    classList: { contains: () => false },
    querySelector: (sel) => (sel === '.char-label' ? { textContent: 'Риса' } : null)
  };
  const lockBtn = {
    classList: { add: () => {}, remove: () => {} },
    closest: (sel) => (sel === '.char-item' ? charItem : null)
  };

  await handleCharLockClick(lockBtn, ctx, async () => true);

  assert.equal(localState.players_state['user-1'].traits[0].is_revealed, false, 'Local flag must revert on RPC error');
  assert.equal(fake.__getRoomRaw('LOCK_CLOSED_01').bunker_state.logs.length, 0, 'No log entry must be written on RPC error');
  assert.equal(refreshCount, 2, 'Optimistic refresh + rollback refresh');
});




