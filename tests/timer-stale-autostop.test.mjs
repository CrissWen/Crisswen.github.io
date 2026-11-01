import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from './helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 30, updateDelayMs: 30 });
const { setGlobalTimer, stopGlobalTimer, clearTimerAutoStop } = await import('../js/utils/host/actions-timer.js');

test('C3: застарілий auto-stop попереднього таймера не гасить новий таймер', async () => {
  fake.__seedRoom({
    room_code: 'TIM01',
    status: 'in_progress',
    bunker_state: {
      logs: [],
    },
    players_state: {
      'host-1': { name: 'Ведучий', is_alive: true },
    },
  });

  // Перший таймер запущено
  await setGlobalTimer('TIM01', 10);
  const firstEnd = fake.__getRoomRaw('TIM01').bunker_state.global_timer_end;
  assert.ok(firstEnd > 0);

  // Ведучий одразу перезапускає новий таймер на 60 секунд
  await setGlobalTimer('TIM01', 60);
  const secondEnd = fake.__getRoomRaw('TIM01').bunker_state.global_timer_end;
  assert.ok(secondEnd > firstEnd);

  // Імітуємо спрацювання запізнілого auto-stop від ПЕРШОГО таймера (expectedEnd = firstEnd)
  await stopGlobalTimer('TIM01', true, firstEnd);
  clearTimerAutoStop();

  const finalRoom = fake.__getRoomRaw('TIM01');
  assert.equal(
    finalRoom.bunker_state.global_timer_end,
    secondEnd,
    'Новий таймер не повинен бути скинутий застарілим auto-stop колбеком'
  );
});

