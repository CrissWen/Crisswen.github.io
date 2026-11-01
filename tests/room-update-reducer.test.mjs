import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from './helpers/fake-supabase.mjs';

installFakeSupabaseEnv();
const { computeRoomUpdateEffects } = await import('../js/game-modules/room-update-reducer.js');

test('I1: computeRoomUpdateEffects визначає вигнання гравця з лобі', () => {
  const prev = {
    room_code: 'RM1',
    host_id: 'host-1',
    status: 'lobby',
    bunker_state: {},
    players_state: {
      'host-1': { name: 'Ведучий' },
      'p-2': { name: 'Гравець 2' },
    },
  };

  const patch = {
    players_state: {
      'host-1': { name: 'Ведучий' },
    },
  };

  const fx = computeRoomUpdateEffects(prev, patch, { currentUserId: 'p-2' });
  assert.equal(fx.kickedFromLobby, true);
  assert.equal(fx.isGameStartedNow, false);
});

test('I1: computeRoomUpdateEffects запускає бронедвері на старті та на фіналі гри рівно один раз', () => {
  const lobbyState = {
    room_code: 'RM2',
    host_id: 'host-1',
    status: 'lobby',
    bunker_state: {},
    players_state: { 'host-1': { name: 'Ведучий' } },
  };

  const startFx = computeRoomUpdateEffects(
    lobbyState,
    { status: 'in_progress', bunker_state: { capacity: 1, cataclysm: { text: 'Ядерна зима' } } },
    { currentUserId: 'host-1' }
  );
  assert.equal(startFx.playStartDoor, true);
  assert.equal(startFx.shouldClearSnapshot, true);

  const finishFx = computeRoomUpdateEffects(
    startFx.nextState,
    { status: 'finished' },
    { currentUserId: 'host-1' }
  );
  assert.equal(finishFx.roomFinished, true);
  assert.equal(finishFx.playFinishDoor, true);

  // Повторний патч у вже завершеній грі не запускає двері вдруге
  const secondFinishFx = computeRoomUpdateEffects(
    finishFx.nextState,
    { status: 'finished' },
    { currentUserId: 'host-1' }
  );
  assert.equal(secondFinishFx.playFinishDoor, false);
});

test('I1: computeRoomUpdateEffects відрізняє нові події ведучого та кидки кубика за id', () => {
  const state = {
    room_code: 'RM3',
    host_id: 'host-1',
    status: 'in_progress',
    bunker_state: {
      capacity: 2,
      latest_host_event: { id: 100, text: 'Стара подія' },
      latest_dice: { id: 200, type: 'd20', value: 14 },
    },
    players_state: {},
  };

  // Той самий id — не показуємо вдруге
  const sameFx = computeRoomUpdateEffects(state, {}, { currentUserId: 'p-1' });
  assert.equal(sameFx.hostEventText, null);
  assert.equal(sameFx.newDiceRoll, null);

  // Новий id — повертаємо текст події та кидок
  const nextFx = computeRoomUpdateEffects(
    state,
    {
      bunker_state: {
        ...state.bunker_state,
        latest_host_event: { id: 101, text: 'Нова подія' },
        latest_dice: { id: 201, type: 'd6', value: 5 },
      },
    },
    { currentUserId: 'p-1' }
  );
  assert.equal(nextFx.hostEventText, 'Нова подія');
  assert.deepEqual(nextFx.newDiceRoll, { id: 201, type: 'd6', value: 5 });
});
