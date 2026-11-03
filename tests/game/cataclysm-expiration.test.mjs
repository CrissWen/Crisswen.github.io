import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from '../helpers/fake-supabase.mjs';

const fake = installFakeSupabaseEnv({ selectDelayMs: 10, updateDelayMs: 10 });
const { finishGameOnCataclysmTimeout } = await import('../../js/utils/host/actions-session.js');

describe('Cataclysm Timeout Expiration', () => {
  it('повинен позначити всіх гравців як is_kicked, встановити finish_reason: cataclysm_timeout та status: finished', async () => {
    fake.__seedRoom({
      room_code: 'CATA01',
      status: 'in_progress',
      host_id: 'host-1',
      bunker_state: {
        cataclysm_timer_end: Date.now() - 1000,
        logs: [],
        voting: { isActive: true }
      },
      players_state: {
        'p1': { name: 'Player 1', is_alive: true, is_kicked: false },
        'p2': { name: 'Player 2', is_alive: true, is_kicked: false },
        'host-1': { name: 'Host', is_alive: true, is_kicked: false }
      }
    });

    await finishGameOnCataclysmTimeout('CATA01', '00:00:00');

    const updated = fake.__getRoomRaw('CATA01');
    assert.strictEqual(updated.status, 'finished', 'Статус кімнати має бути finished');
    assert.strictEqual(updated.bunker_state.finish_reason, 'cataclysm_timeout', 'finish_reason має бути cataclysm_timeout');
    assert.strictEqual(updated.bunker_state.stopped_timer, '00:00:00');
    assert.strictEqual(updated.bunker_state.voting.isActive, false, 'Голосування має бути зупинене');

    // Перевіряємо, що всі гравці позначені як вигнані
    assert.strictEqual(updated.players_state['p1'].is_kicked, true);
    assert.strictEqual(updated.players_state['p2'].is_kicked, true);
    assert.strictEqual(updated.players_state['host-1'].is_kicked, true);

    // Лог
    const hasLog = updated.bunker_state.logs.some(l => l.text.includes('Час катаклізму вичерпано'));
    assert.ok(hasLog, 'Лог про катаклізм має бути доданий');
  });
});

