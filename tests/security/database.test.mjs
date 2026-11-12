import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(new URL('../../supabase/migrations/202611120001_security.sql', import.meta.url), 'utf8');
const ids = {
  host: '00000000-0000-4000-8000-000000000001',
  player: '00000000-0000-4000-8000-000000000002',
  outsider: '00000000-0000-4000-8000-000000000003',
  spectator: '00000000-0000-4000-8000-000000000004'
};
const defaultId = '16ea0906-5874-4471-aa38-aef1513e82c6';
async function as(role, id, sql, params = []) {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  try { return await db.query(sql, params); }
  finally { await db.exec('RESET ROLE'); }
}
const user = (who, sql, params) => as('authenticated', ids[who], sql, params);
const admin = (sql, params) => as('postgres', null, sql, params);
async function makeRoom(code) {
  await user('host', "INSERT INTO public.rooms(room_code, host_id) VALUES($1,$2)", [code, ids.host]);
  await user('host', 'SELECT public.join_room($1,$2)', [code, 'forged host']);
  await user('player', 'SELECT public.join_room($1,$2)', [code, 'forged player']);
}
async function startRoom(code) {
  const players = {
    [ids.host]: { name: 'Host', gender: { value: 'HOST_SECRET', is_revealed: false }, professions: [{ title: 'Engineer', is_revealed: false }], is_alive: true },
    [ids.player]: { name: 'Player', gender: { value: 'PLAYER_SECRET', meta: { secret: 'NESTED_SECRET' }, is_revealed: false },
      traits: [{ value: 'PUBLIC_TRAIT', is_revealed: true }, { value: 'HIDDEN_TRAIT', is_revealed: false }], is_alive: true }
  };
  await user('host', "UPDATE public.rooms SET players_state=$2::jsonb, bunker_state=$3::jsonb, status='in_progress' WHERE room_code=$1",
    [code, JSON.stringify(players), JSON.stringify({ capacity: 1, cataclysm: { text: 'Test' }, logs: [], voting: { isActive: true, votes: {} } })]);
}
before(async () => {
  await db.exec(await readFile(new URL('./fixture.sql', import.meta.url), 'utf8'));
  await db.exec(migration);
  for (const [name, id] of Object.entries(ids)) {
    await db.query('INSERT INTO auth.users VALUES($1)', [id]);
    await db.query('INSERT INTO public.users(id,username) VALUES($1,$2)', [id, name]);
  }
  await db.query('INSERT INTO public.admins VALUES($1)', [ids.host]);
});
after(async () => { await db.close(); });

test('clients cannot self-assign admin, truncate, create triggers, or write counters/history', async () => {
  await assert.rejects(user('outsider', 'INSERT INTO public.admins VALUES($1)', [ids.outsider]), /permission denied/);
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['admins', 'rooms']) {
      await assert.rejects(as(role, ids.outsider, `TRUNCATE public.${table}`), /permission denied/);
      const r = await admin('SELECT has_table_privilege($1,$2,$3) AS allowed', [role, `public.${table}`, 'TRIGGER']);
      assert.equal(r.rows[0].allowed, false);
    }
  }
  await assert.rejects(user('outsider', 'UPDATE public.users SET games_won=999 WHERE id=$1', [ids.outsider]), /permission denied/);
  await assert.rejects(user('outsider', 'INSERT INTO public.user_game_history(user_id,room_code) VALUES($1,$2)', [ids.outsider, 'FAKE']), /permission denied/);
  const publications = (await admin("SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime'")).rows.map(r => r.tablename);
  assert.deepEqual(publications, ['room_events']);
  await assert.rejects(user('outsider', 'CREATE TABLE public.evil(id integer)'), /permission denied/);
});

test('private packs/cards cannot be read or modified by another user or anonymous visitor', async () => {
  const pack = '10000000-0000-4000-8000-000000000001';
  await admin("INSERT INTO public.packs(id,author_id,title) VALUES($1,$2,'Private')", [pack, ids.host]);
  await admin("INSERT INTO public.pack_cards VALUES(gen_random_uuid(),$1,'character','trait','SECRET_CARD','{}')", [pack]);
  for (const [role, id] of [['anon', null], ['authenticated', ids.player]]) {
    const packs = await as(role,id,'SELECT id FROM public.packs WHERE id=$1',[pack]);
    const cards = await as(role,id,'SELECT value FROM public.pack_cards WHERE pack_id=$1',[pack]);
    assert.equal(packs.rows.length, 0); assert.equal(cards.rows.length, 0);
  }
  assert.equal((await user('host','SELECT value FROM public.pack_cards WHERE pack_id=$1',[pack])).rows.length,1);
  await assert.rejects(user('player', 'UPDATE public.pack_cards SET value=$1 WHERE pack_id=$2', ['hacked',pack]), /permission denied/);
});

test('raw room reads and Realtime event access are restricted; server redacts other players and spectators', async () => {
  await makeRoom('SECRETAA'); await startRoom('SECRETAA');
  assert.equal((await user('outsider', 'SELECT * FROM public.rooms')).rows.length, 0);
  assert.equal((await user('player', 'SELECT * FROM public.rooms')).rows.length, 0);
  assert.equal((await user('outsider', 'SELECT * FROM public.room_events')).rows.length, 0);
  await assert.rejects(user('outsider', "SELECT public.get_room_view('SECRETAA')"), /немає доступу/);
  const player = (await user('player', "SELECT public.get_room_view('SECRETAA') AS room")).rows[0].room;
  assert.equal(JSON.stringify(player).includes('HOST_SECRET'),false);
  assert.equal(player.players_state[ids.player].gender.value,'PLAYER_SECRET');
  await user('spectator', "SELECT public.join_room('SECRETAA','fake')");
  const view=(await user('spectator', "SELECT public.get_room_view('SECRETAA') AS room")).rows[0].room;
  for(const secret of ['HOST_SECRET','PLAYER_SECRET','HIDDEN_TRAIT','NESTED_SECRET']) assert.equal(JSON.stringify(view).includes(secret),false,secret);
  assert.equal(JSON.stringify(view).includes('PUBLIC_TRAIT'),true);
  assert.deepEqual(Object.keys((await user('spectator','SELECT * FROM public.room_events')).rows[0]).sort(),['room_code','version']);
});

test('host cannot inject outsider UUIDs, bypass start minimum, or create a finished room', async () => {
  await makeRoom('GUARDAAA');
  await assert.rejects(user('host',"UPDATE public.rooms SET players_state=players_state || jsonb_build_object($2::text,'{}'::jsonb) WHERE room_code=$1",['GUARDAAA',ids.outsider]),/іншого користувача/);
  await assert.rejects(user('player',"INSERT INTO public.rooms(room_code,host_id,status) VALUES('FORGEDAA',$1,'finished')",[ids.player]),/порожньою/);
  // Host temporarily loses admin status: server must enforce six players, independently of JS.
  await admin('DELETE FROM public.admins WHERE user_id=$1',[ids.host]);
  await assert.rejects(startRoom('GUARDAAA'),/від 6/);
  await assert.rejects(user('host', `SELECT public.save_default_pack($1,'test','','{}','[]')`,[defaultId]),/Лише адміністратори/);
  await admin('INSERT INTO public.admins VALUES($1)',[ids.host]);
  await as('authenticated',ids.outsider,'CREATE TEMP TABLE admins(user_id uuid)');
  await as('authenticated',ids.outsider,'INSERT INTO pg_temp.admins VALUES($1)',[ids.outsider]);
  await assert.rejects(user('outsider', `SELECT public.save_default_pack($1,'test','','{}','[]')`,[defaultId]),/Лише адміністратори/);
  await as('authenticated',ids.outsider,'DROP TABLE pg_temp.admins');
});

test('maintenance and statistics cannot be invoked by anon or an unrelated account', async () => {
  await assert.rejects(as('anon',null,'SELECT public.handle_room_lifecycle()'),/permission denied/);
  await assert.rejects(user('player','SELECT public.handle_room_lifecycle()'),/permission denied/);
  await assert.rejects(as('anon',null,"SELECT public.record_game_results('SECRETAA')"),/permission denied/);
  await assert.rejects(user('outsider',"SELECT public.record_game_results('SECRETAA')"),/Лише ведучий/);
});

test('reveals update only the caller and create bounded server-authored logs; p_max cannot erase logs', async () => {
  await user('player', 'SELECT public.set_my_reveals($1,$2)', ['SECRETAA',JSON.stringify([{path:['gender'],value:true}])]);
  const visible=(await user('spectator',"SELECT public.get_room_view('SECRETAA') AS room")).rows[0].room;
  assert.equal(visible.players_state[ids.player].gender.value,'PLAYER_SECRET');
  assert.equal(visible.players_state[ids.host].gender.value,undefined);
  assert.equal(visible.bunker_state.logs[0].actor_id,ids.player);
  await assert.rejects(user('player',"SELECT public.append_log('SECRETAA','Ведучий завершив гру',1)"),/Лише ведучий/);
  await user('host',"SELECT public.append_log('SECRETAA','Test',1)");
  const raw=(await user('host',"SELECT bunker_state FROM public.rooms WHERE room_code='SECRETAA'")).rows[0].bunker_state;
  assert.equal(raw.logs.length,2);
  for(let i=0;i<105;i++)await user('host',"SELECT public.append_log('SECRETAA','Test',2147483647)");
  assert.equal((await user('host',"SELECT jsonb_array_length(bunker_state->'logs') AS n FROM public.rooms WHERE room_code='SECRETAA'")).rows[0].n,100);
});

test('only verified participants get results, terminal rooms are immutable and results are idempotent', async () => {
  await assert.rejects(user('host', "UPDATE public.rooms SET status='finished' WHERE room_code='SECRETAA'"), /Живих гравців більше/);
  await user('host', "UPDATE public.rooms SET players_state=jsonb_set(players_state, ARRAY[$1,'is_alive'], 'false') WHERE room_code='SECRETAA'", [ids.player]);
  await user('host',"UPDATE public.rooms SET status='finished' WHERE room_code='SECRETAA'");
  const first=(await user('host',"SELECT public.record_game_results('SECRETAA') AS result")).rows[0].result;
  assert.equal(first.success,true); assert.equal(first.recorded_players,2);
  const second=(await user('host',"SELECT public.record_game_results('SECRETAA') AS result")).rows[0].result;
  assert.equal(second.already_recorded,true);
  assert.equal((await user('player','SELECT games_played FROM public.users WHERE id=$1',[ids.player])).rows[0].games_played,1);
  assert.equal((await user('outsider','SELECT * FROM public.user_game_history')).rows.length,0);
  assert.equal((await user('player','SELECT * FROM public.user_game_history')).rows.length,1);
  await assert.rejects(user('host',"UPDATE public.rooms SET status='lobby' WHERE room_code='SECRETAA'"),/вже завершено/);
});

test('legitimate pack RPC saves work while foreign card IDs and spoofed authors cannot modify data', async () => {
  const defaultCard = '20000000-0000-4000-8000-000000000001';
  const personal = '20000000-0000-4000-8000-000000000002';
  await user('host', 'SELECT public.save_default_pack($1,$2,$3,$4,$5)', [defaultId,'default','',{},[
    {id:defaultCard,pool_type:'character',category:'profession',value:'Protected',meta:{}}
  ]]);
  await user('player','SELECT public.save_personal_pack($1,$2,$3,$4,$5,$6)',[personal,ids.player,'My pack','',{},[
    {id:defaultCard,pool_type:'character',category:'profession',value:'Hacked',meta:{}}
  ]]);
  assert.equal((await admin('SELECT value FROM public.pack_cards WHERE id=$1',[defaultCard])).rows[0].value,'Protected');
  await assert.rejects(user('player','SELECT public.save_personal_pack($1,$2,$3,$4,$5,$6)',[personal,ids.host,'Spoof','',{},[]]),/іншого користувача/);
  await assert.rejects(user('player','SELECT public.delete_personal_pack($1)',[defaultId]),/не можна видалити/);
  await user('player','SELECT public.delete_personal_pack($1)',[personal]);
  const archivedPack='20000000-0000-4000-8000-000000000003';
  await user('host','SELECT public.save_personal_pack($1,$2,$3,$4,$5,$6)',[archivedPack,ids.host,'Archive pack','',{},[]]);
  await makeRoom('ARCHIVED');
  await user('host',"UPDATE public.rooms SET selected_pack_id=$1 WHERE room_code='ARCHIVED'",[archivedPack]);
  await startRoom('ARCHIVED');
  await user('host',"UPDATE public.rooms SET players_state=jsonb_set(players_state,ARRAY[$1,'is_alive'],'false') WHERE room_code='ARCHIVED'",[ids.player]);
  await user('host',"UPDATE public.rooms SET status='finished' WHERE room_code='ARCHIVED'");
  await user('host','SELECT public.delete_personal_pack($1)',[archivedPack]);
  assert.equal((await user('host',"SELECT selected_pack_id FROM public.rooms WHERE room_code='ARCHIVED'")).rows[0].selected_pack_id,defaultId);
});

test('NULL votes, outsider votes and cross-player reveal paths cannot corrupt room state', async () => {
  await makeRoom('VOTETEST'); await startRoom('VOTETEST');
  await assert.rejects(user('player',"SELECT public.cast_vote('VOTETEST',NULL)"),/Оберіть кандидата/);
  await assert.rejects(user('outsider',"SELECT public.cast_vote('VOTETEST',$1)",[ids.host]),/не можете голосувати/);
  await user('player',"SELECT public.cast_vote('VOTETEST',$1)",[ids.host]);
  const before=(await user('host',"SELECT players_state FROM public.rooms WHERE room_code='VOTETEST'")).rows[0].players_state;
  await user('player','SELECT public.set_my_reveals($1,$2)',['VOTETEST',JSON.stringify([
    {path:[ids.host,'gender'],value:true}, {path:['gender','value'],value:true}
  ])]);
  const after=(await user('host',"SELECT players_state,bunker_state FROM public.rooms WHERE room_code='VOTETEST'")).rows[0];
  assert.deepEqual(after.players_state,before);
  assert.equal(after.bunker_state.voting.votes[ids.player],ids.host);
});

test('kicked lobby users cannot rejoin and a spectator can become a player after a restart', async () => {
  await makeRoom('KICKTEST');
  await user('host',"UPDATE public.rooms SET players_state=players_state-$1 WHERE room_code='KICKTEST'",[ids.player]);
  await assert.rejects(user('player',"SELECT public.join_room('KICKTEST','fake')"),/Доступ.*закрито/);
  await makeRoom('RESTARTA'); await startRoom('RESTARTA');
  await user('spectator',"SELECT public.join_room('RESTARTA','fake')");
  await user('host',"UPDATE public.rooms SET bunker_state='{}' WHERE room_code='RESTARTA'");
  await user('spectator',"SELECT public.join_room('RESTARTA','fake')");
  const row=(await user('host',"SELECT players_state FROM public.rooms WHERE room_code='RESTARTA'")).rows[0];
  assert.equal(row.players_state[ids.spectator].name,'spectator');
});

test('authenticated users can update only their own avatar, not another profile or private columns', async () => {
  await user('player',"UPDATE public.users SET avatar_url=NULL WHERE id=$1",[ids.player]);
  const result=await user('player',"UPDATE public.users SET avatar_url='bad' WHERE id=$1 RETURNING id",[ids.host]);
  assert.equal(result.rows.length,0);
  await assert.rejects(user('player','SELECT private_email FROM public.users'),/permission denied/);
});

test('transfer removes previous host raw access and grants it to an authenticated participant', async () => {
  await makeRoom('TRANSFER'); await startRoom('TRANSFER');
  const pack='10000000-0000-4000-8000-000000000001';
  // A selected personal pack remains usable by the new host. Select it in a
  // separate lobby, since changing packs after dealing is intentionally blocked.
  await makeRoom('PACKHOST');
  await user('host', "UPDATE public.rooms SET selected_pack_id=$1 WHERE room_code='PACKHOST'",[pack]);
  await user('host', "SELECT public.transfer_room_host('PACKHOST',$1)",[ids.player]);
  assert.equal((await user('player','SELECT id FROM public.packs WHERE id=$1',[pack])).rows.length,1);
  assert.equal((await user('outsider','SELECT id FROM public.packs WHERE id=$1',[pack])).rows.length,0);
  await assert.rejects(user('outsider',"SELECT public.transfer_room_host('TRANSFER',$1)",[ids.outsider]),/Лише ведучий/);
  await user('host',"SELECT public.transfer_room_host('TRANSFER',$1)",[ids.player]);
  assert.equal((await user('host',"SELECT * FROM public.rooms WHERE room_code='TRANSFER'")).rows.length,0);
  assert.equal((await user('player',"SELECT * FROM public.rooms WHERE room_code='TRANSFER'")).rows.length,1);
});

test('migration is repeatable without losing rooms, cards or history', async () => {
  const before=(await admin('SELECT count(*)::int AS n FROM public.user_game_history')).rows[0].n;
  await db.exec(migration);
  assert.equal((await admin('SELECT count(*)::int AS n FROM public.user_game_history')).rows[0].n,before);
  const verification = await readFile(new URL('../../supabase/verify-security.sql', import.meta.url), 'utf8');
  const checks = await admin(verification);
  assert.ok(checks.rows.length > 0);
  for (const check of checks.rows) assert.equal(check.ok, true, check.name);
});
