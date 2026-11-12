import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const state = { user: null, authError: null, member: false, dbError: null, queries: 0, rawReads: 0, rpc: null };
let eventHandler;
let removed = 0;
const client = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: state.authError }) },
  from(table) {
    if (table !== 'admins') { state.rawReads++; throw new Error('Raw read forbidden'); }
    return {
      select() { return this; }, eq(column, value) { this.id = value; return this; },
      async maybeSingle() { state.queries++; return { data: state.member ? { user_id: this.id } : null, error: state.dbError }; }
    };
  },
  rpc: (...args) => state.rpc(...args),
  channel() {
    return {
      on(type, filter, handler) { assert.equal(filter.table, 'room_events'); eventHandler = handler; return this; },
      subscribe() { return this; }
    };
  },
  removeChannel() { removed++; }
};
globalThis.window = { supabase: { createClient: () => client } };
const { checkIsAdmin } = await import('../../js/services/packs-store.js');
const { getRoomView } = await import('../../js/services/room-access.js');
const { subscribeToRoom } = await import('../../js/services/room-subscription.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('metadata cannot grant admin and revocation survives logout/relogin without reloading', async () => {
  state.user = { id: 'user', user_metadata: { is_admin: true }, app_metadata: { claims_admin: true } };
  state.member = false;
  assert.equal(await checkIsAdmin(), false);
  state.member = true;
  assert.equal(await checkIsAdmin(), true);
  state.member = false;
  assert.equal(await checkIsAdmin(), false);
  state.user = null;
  assert.equal(await checkIsAdmin(), false);
  state.user = { id: 'user' };
  assert.equal(await checkIsAdmin(), false);
  state.member = true; state.authError = { message: 'Invalid auth' };
  assert.equal(await checkIsAdmin(), false);
  state.authError = null; state.dbError = { message: 'Denied' };
  const orig = console.error; console.error = () => {};
  try { assert.equal(await checkIsAdmin(), false); } finally { console.error = orig; state.dbError = null; }
});

test('room RPC failures never fall back to unfiltered rooms', async () => {
  state.rpc = async name => {
    assert.equal(name, 'get_room_view');
    return { data: null, error: { code: '42501', message: 'Forbidden' } };
  };
  await assert.rejects(getRoomView('ROOM'), { code: '42501' });
  assert.equal(state.rawReads, 0);
});

test('Realtime accepts no row payload and drops pending data after unsubscription', async () => {
  const updates = [];
  let resolve;
  state.rpc = async () => new Promise(r => { resolve = r; });
  const stop = subscribeToRoom('ROOM', room => updates.push(room));
  await flush();
  resolve({ data: { room_code: 'ROOM', version: 1, players_state: {} }, error: null });
  await flush();
  assert.equal(updates.length, 1);
  eventHandler({ new: { version: 999, players_state: { leaked: 'SECRET' } } });
  await flush();
  stop();
  resolve({ data: { room_code: 'ROOM', version: 2, players_state: {} }, error: null });
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(JSON.stringify(updates).includes('SECRET'), false);
  assert.equal(removed, 1);
});

function accessGate(html, kind, check) {
  const start = html.indexOf('async function initAccessGate()');
  let i = html.indexOf('{', start) + 1, depth = 1;
  for (; depth; i++) { if (html[i] === '{') depth++; if (html[i] === '}') depth--; }
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { hidden: true, style: {}, textContent: '' });
      return nodes.get(id);
    },
    querySelectorAll: () => []
  };
  const init = new Function('checkIsAdmin', 'document', 'initAudioLab', 'initCuratorApp', 'stopAllAudio',
    'let gateEpoch=0; let isLabInitialized=false; let isCuratorInitialized=false;' + html.slice(start,i) + ';return initAccessGate;')(
    check, document, () => {}, async () => {}, () => {}
  );
  return { init, app: document.getElementById(kind === 'audio' ? 'audio-lab-app' : 'curator-app') };
}

for (const [kind, file] of [['audio','audio-lab.html'], ['curator','cataclysm-icon-curator.html']]) {
  test(`${kind}: dev/localStorage bypasses removed, denied/error checks hide app, stale checks cannot reopen it`, async () => {
    const html = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.equal(/btn-dev-bypass|isDevBypass|tb_is_admin|claims_admin|user_metadata\?\.is_admin/.test(html), false);
    let allow = false;
    const gate = accessGate(html, kind, async () => allow);
    await gate.init(); assert.equal(gate.app.hidden, true);
    allow = true; await gate.init(); assert.equal(gate.app.hidden, false);
    allow = false; await gate.init(); assert.equal(gate.app.hidden, true);
    let resolve, n = 0;
    const race = accessGate(html, kind, () => ++n === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(false));
    const first = race.init(); await race.init(); resolve(true); await first;
    assert.equal(race.app.hidden, true);
    const failure = accessGate(html,kind,async () => { throw new Error('Offline'); });
    await failure.init(); assert.equal(failure.app.hidden,true);
  });
}
