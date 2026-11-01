import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from '../helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 25, updateDelayMs: 25 });
const { finishGame, closeRoom } = await import('../../js/utils/host/actions-session.js');

test('C2: паралельний виклик closeRoom з іншої вкладки не перезаписує status="finished" на "closed"', async () => {
  fake.__seedRoom({
    room_code: 'FIN01',
    status: 'in_progress',
    bunker_state: {
      capacity: 1,
      logs: [],
    },
    players_state: {
      p1: { name: 'Вцілілий', is_alive: true },
      p2: { name: 'Вибувший', is_alive: false },
    },
  });

  // Обидві вкладки читають status = 'in_progress', але finishGame фіксує фінал першим,
  // а closeRoom намагається записати status = 'closed' одразу слідом.
  const finishPromise = finishGame('FIN01', '00:05:00');
  await new Promise((r) => setTimeout(r, 10)); // closeRoom стартує до того, як finishGame встиг закінчити update
  const closeRejection = assert.rejects(closeRoom('FIN01', '00:05:01'), /Гру вже завершено/);

  await Promise.all([finishPromise, closeRejection]);

  const finalRoom = fake.__getRoomRaw('FIN01');
  assert.equal(finalRoom.status, 'finished');
});
