// Внутрішній мок Supabase у пам'яті з підтримкою затримок мережі (для відтворення Lost Update / TOCTOU)
// та емуляцією серверних тригерів і RPC.

import { AsyncLocalStorage } from 'node:async_hooks';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function createFakeSupabase({ selectDelayMs = 0, updateDelayMs = 0 } = {}) {
  const rooms = new Map(); // room_code -> row object
  let activeUserId = 'host-1';
  const userStore = new AsyncLocalStorage();
  const currentUid = (params) => params?.__userId || userStore.getStore() || activeUserId;
  let latency = { selectDelayMs, updateDelayMs };

  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  function seedRoom(row) {
    const code = String(row.room_code).toUpperCase();
    rooms.set(code, {
      id: row.id || '00000000-0000-0000-0000-000000000001',
      room_code: code,
      host_id: row.host_id || 'host-1',
      status: row.status || 'lobby',
      version: row.version ?? 0,
      bunker_state: clone(row.bunker_state || {}),
      players_state: clone(row.players_state || {}),
      selected_pack_id: row.selected_pack_id || '16ea0906-5874-4471-aa38-aef1513e82c6',
      selected_pack_title: row.selected_pack_title || 'Базовий пак',
    });
  }

  function getRoomRaw(code) {
    return rooms.get(String(code).toUpperCase()) || null;
  }

  function matchesFilters(row, filters) {
    if (!row) return false;
    for (const f of filters) {
      if (f.type === 'eq') {
        if (row[f.col] !== f.val) return false;
      } else if (f.type === 'not_in') {
        if (f.values.includes(String(row[f.col]))) return false;
      }
    }
    return true;
  }

  function makeQueryBuilder(table) {
    let op = 'select';
    let patchData = null;
    let insertRows = null;
    let returnSelect = false;
    let expectSingle = false;
    let expectMaybeSingle = false;
    const filters = [];

    const builder = {
      select(cols = '*') {
        if (op === 'update' || op === 'insert') {
          returnSelect = cols;
        } else {
          op = 'select';
        }
        return builder;
      },
      update(patch) {
        op = 'update';
        patchData = clone(patch);
        return builder;
      },
      insert(rows) {
        op = 'insert';
        insertRows = clone(Array.isArray(rows) ? rows : [rows]);
        return builder;
      },
      eq(col, val) {
        filters.push({ type: 'eq', col, val });
        return builder;
      },
      not(col, operator, val) {
        if (operator === 'in') {
          const parsed = String(val)
            .replace(/^\(|\)$/g, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          filters.push({ type: 'not_in', col, values: parsed });
        }
        return builder;
      },
      single() {
        expectSingle = true;
        return builder;
      },
      maybeSingle() {
        expectMaybeSingle = true;
        return builder;
      },
      then(onFulfilled, onRejected) {
        return execute().then(onFulfilled, onRejected);
      },
    };

    async function execute() {
      if (table !== 'rooms') {
        return { data: expectSingle || expectMaybeSingle ? null : [], error: null };
      }

      if (op === 'select') {
        await sleep(latency.selectDelayMs);
        const matched = [];
        for (const r of rooms.values()) {
          if (matchesFilters(r, filters)) matched.push(clone(r));
        }
        if (expectSingle) {
          if (matched.length === 0) {
            return { data: null, error: { code: 'PGRST116', message: 'Кімнату не знайдено' } };
          }
          return { data: matched[0], error: null };
        }
        if (expectMaybeSingle) {
          return { data: matched[0] || null, error: null };
        }
        return { data: matched, error: null };
      }

      if (op === 'update') {
        await sleep(latency.updateDelayMs);
        const updated = [];
        for (const [code, r] of rooms.entries()) {
          if (matchesFilters(r, filters)) {
            const next = {
              ...r,
              ...clone(patchData),
              version: (r.version ?? 0) + 1,
            };
            rooms.set(code, next);
            updated.push(clone(next));
          }
        }
        if (expectSingle) {
          if (updated.length === 0) {
            return { data: null, error: { code: 'PGRST116', message: 'No rows updated' } };
          }
          return { data: updated[0], error: null };
        }
        return { data: returnSelect ? updated : null, error: null };
      }

      if (op === 'insert') {
        const inserted = [];
        for (const row of insertRows) {
          seedRoom(row);
          inserted.push(clone(getRoomRaw(row.room_code)));
        }
        return { data: expectSingle ? inserted[0] : inserted, error: null };
      }

      return { data: null, error: null };
    }

    return builder;
  }

  async function rpc(name, params = {}) {
    await sleep(latency.updateDelayMs);

    if (name === 'get_server_time') {
      return { data: new Date().toISOString(), error: null };
    }

    if (name === 'record_game_results') {
      const r = getRoomRaw(params.p_room_code);
      if (!r) return { data: { success: false, error: 'Room not found' }, error: null };
      if (r.status !== 'finished') return { data: { success: false, error: 'Game is not finished' }, error: null };
      return { data: { success: true, recorded_players: Object.keys(r.players_state || {}).length }, error: null };
    }

    if (name === 'cast_vote') {
      const uid = currentUid(params);
      const r = getRoomRaw(params.p_room);
      if (!r) return { data: null, error: { message: 'Кімнату не знайдено' } };
      if (r.status === 'finished' || r.status === 'closed') {
        return { data: null, error: { message: 'Гру вже завершено' } };
      }
      if (!r.bunker_state?.voting?.isActive) {
        return { data: null, error: { message: 'Голосування вже завершено' } };
      }
      const voter = r.players_state?.[uid];
      if (!voter || voter.is_alive === false || voter.is_kicked) {
        return { data: null, error: { message: 'Ви не можете голосувати' } };
      }
      const cand = r.players_state?.[params.p_candidate];
      if (!cand || cand.is_alive === false || cand.is_kicked) {
        return { data: null, error: { message: 'Цього гравця виключено з голосування' } };
      }
      r.bunker_state.voting.votes = {
        ...(r.bunker_state.voting.votes || {}),
        [uid]: params.p_candidate,
      };
      r.version = (r.version ?? 0) + 1;
      return { data: null, error: null };
    }

    if (name === 'append_log') {
      const uid = currentUid(params);
      const r = getRoomRaw(params.p_room);
      if (!r || !r.bunker_state || Object.keys(r.bunker_state).length === 0) {
        return { data: null, error: null };
      }
      if (!r.players_state?.[uid] && r.host_id !== uid) {
        return { data: null, error: { message: 'Немає доступу до кімнати' } };
      }
      const max = params.p_max ?? 100;
      const now = Date.now();
      const seq = (r.bunker_state.event_seq ?? 0) + 1;
      r.bunker_state.event_seq = seq;
      const entry = { id: now * 1000 + (seq % 1000), t: now, text: String(params.p_text ?? '').trim().slice(0, 300) };
      const logs = Array.isArray(r.bunker_state.logs) ? [...r.bunker_state.logs, entry] : [entry];
      r.bunker_state.logs = logs.slice(-max);
      r.version = (r.version ?? 0) + 1;
      return { data: null, error: null };
    }

    if (name === 'set_my_reveals') {
      const uid = currentUid(params);
      const r = getRoomRaw(params.p_room);
      if (!r || !r.players_state?.[uid] || r.status === 'finished' || r.status === 'closed') {
        return { data: null, error: { message: 'Кімнату не знайдено або немає доступу' } };
      }
      const pObj = r.players_state[uid];
      for (const ch of params.p_changes || []) {
        const path = ch.path || [];
        let cursor = pObj;
        for (let i = 0; i < path.length; i++) {
          if (cursor == null) break;
          cursor = cursor[path[i]];
        }
        if (cursor && typeof cursor === 'object') {
          cursor.is_revealed = Boolean(ch.value);
        }
      }
      r.version = (r.version ?? 0) + 1;
      return { data: null, error: null };
    }

    if (name === 'join_room') {
      const uid = currentUid(params);
      const r = getRoomRaw(params.p_room);
      if (!r) return { data: null, error: { message: 'Кімнату не знайдено' } };
      if (r.status === 'finished' || r.status === 'closed') {
        return { data: null, error: { message: 'Кімнату закрито' } };
      }
      if (r.players_state?.[uid]) return { data: null, error: null };
      if (r.bunker_state && Object.keys(r.bunker_state).length > 0) return { data: null, error: null };
      const limit = Math.min(Math.max(params.p_max ?? 15, 1), 15);
      if (Object.keys(r.players_state || {}).length >= limit) {
        return { data: null, error: { message: `Ця кімната вже переповнена (максимум ${limit} гравців)` } };
      }
      r.players_state[uid] = { name: String(params.p_name ?? '').trim().slice(0, 40) };
      r.version = (r.version ?? 0) + 1;
      return { data: null, error: null };
    }

    if (name === 'update_single_player_state') {
      const r = getRoomRaw(params.room_code_val);
      if (!r) return { data: null, error: { message: 'Кімнату не знайдено' } };
      r.players_state[params.user_id_val] = clone(params.player_data);
      r.version = (r.version ?? 0) + 1;
      return { data: null, error: null };
    }

    return { data: null, error: { code: 'PGRST202', message: `Unknown RPC ${name}` } };
  }

  const client = {
    from: (table) => makeQueryBuilder(table),
    rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: activeUserId, user_metadata: { username: activeUserId } } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: activeUserId } } }, error: null }),
    },
    __seedRoom: seedRoom,
    __getRoomRaw: getRoomRaw,
    __setActiveUser(id) {
      activeUserId = id;
    },
    __runAsUser(id, fn) {
      return userStore.run(id, fn);
    },
    __setLatency(next) {
      latency = { ...latency, ...next };
    },
  };

  return client;
}

export function installFakeSupabaseEnv(options = {}) {
  const fake = createFakeSupabase(options);
  globalThis.window = globalThis.window || {};
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
  globalThis.window.supabase = { createClient: () => fake };

  globalThis.document = globalThis.document || {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: {
      insertAdjacentHTML: () => {},
      appendChild: () => {},
      classList: { add: () => {}, remove: () => {}, contains: () => false },
    },
  };
  return fake;
}
