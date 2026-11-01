import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from './helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 25, updateDelayMs: 25 });
const { handleVoteSubmit } = await import('../js/game-modules/controllers/voting-controller.js');

function makeVoteButton(candidateId) {
  return {
    disabled: false,
    textContent: 'Проголосувати',
    closest() {
      return {
        querySelector() {
          return { value: candidateId };
        },
      };
    },
  };
}

function makeCtx(roomCode, userId, roomStateRef) {
  return {
    isSpectator: () => false,
    getRoomCode: () => roomCode,
    getUserId: () => userId,
    getRoomState: () => roomStateRef,
    refreshBoard: () => {},
  };
}

test('C1: паралельне голосування двох гравців не губить жодного голосу (no Lost Update)', async () => {
  fake.__seedRoom({
    room_code: 'RACE01',
    status: 'in_progress',
    bunker_state: {
      voting: { isActive: true, votes: {} },
    },
    players_state: {
      p1: { name: 'Гравець 1', is_alive: true },
      p2: { name: 'Гравець 2', is_alive: true },
      p3: { name: 'Гравець 3', is_alive: true },
    },
  });

  const stateP1 = structuredClone(fake.__getRoomRaw('RACE01'));
  const stateP2 = structuredClone(fake.__getRoomRaw('RACE01'));

  await Promise.all([
    fake.__runAsUser('p1', () => handleVoteSubmit(makeVoteButton('p3'), makeCtx('RACE01', 'p1', stateP1))),
    fake.__runAsUser('p2', () => handleVoteSubmit(makeVoteButton('p3'), makeCtx('RACE01', 'p2', stateP2))),
  ]);

  const finalRoom = fake.__getRoomRaw('RACE01');
  assert.deepEqual(finalRoom.bunker_state.voting.votes, {
    p1: 'p3',
    p2: 'p3',
  });
});

