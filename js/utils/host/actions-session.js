import { supabase } from '../../services/supabase.js';
import { pushLog, nextEventId } from '../game/log-writer.js';
import { randInt } from '../common/random.js';
import { getRoom, saveRoom, snapshot, clearSnapshot } from './room-store.js';
import { setHostEvent, nameOf } from './common.js';
import { clearTimerAutoStop } from './actions-timer.js';

// ===== Голосування, кубик та керування кімнатою =====

// bunker_state.voting — джерело правди для голосування, спільне для всіх гравців:
//   isActive: boolean — чи триває зараз збір голосів
//   votes:    { "ID_виборця": "ID_кандидата" } — словник відданих голосів
// Стопер-захист: повторний запуск, поки попереднє голосування ще триває, кидає помилку і не чіпає votes.
// Перевірка ДО snapshot(), щоб невдала спроба не затирала точку скасування попередньої дії.
export async function startVoting(roomCode) {
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};

  if (bState.voting?.isActive === true) {
    throw new Error('Голосування вже почате!');
  }

  snapshot(room);
  bState.voting = { isActive: true, votes: {} };
  setHostEvent(bState, 'Ведучий запустив голосування');
  await saveRoom(roomCode, { bunker_state: bState }, room.version);
}

// Автозавершення голосування: викликається клієнтом ведучого (game.js -> maybeAutoFinishVoting), коли проголосували всі живі.
// Ідемпотентна: якщо голосування вже неактивне — мовчазний но-оп. Свідомо НЕ викликаємо snapshot() —
// це автоматичний системний крок, він не має затирати точку скасування останньої ручної дії ведучого.
// Не пише і latest_host_event — автозавершення по кількості голосів вже видно всім із таблиці результатів, тост тут зайвий.
export async function finishVoting(roomCode) {
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};
  if (!bState.voting?.isActive) return;

  const pState = room.players_state || {};
  let totalVoters = 0;
  for (const id in pState) {
    const p = pState[id];
    if (p && p.is_alive !== false && !p.is_kicked) {
      totalVoters++;
    }
  }

  bState.voting = { ...bState.voting, isActive: false, totalVoters };
  await saveRoom(roomCode, { bunker_state: bState }, room.version);
}

// Кількість граней для кожного типу кубика: незалежні кидки d20 і d6.
const DICE_SIDES = { d20: 20, d6: 6 };

// Кидає ОДИН кубик заданого типу ('d20' або 'd6') і пише результат у bunker_state.latest_dice = { id, type, value }.
// Текстовий latest_host_event тут НЕ пишеться (кидок не потрапляє в тост): клієнти бачать новий id через Realtime (game.js)
// і запускають локальну анімацію в dice-overlay.js — так всі гравці бачать її одночасно.
// snapshot() навмисно немає: кидок не змінює стан гри, а скасування повернуло б старий latest_dice з іншим id
// і в усіх гравців заново програвся б попередній кидок.
export async function rollDice(roomCode, type) {
  const sides = DICE_SIDES[type];
  if (!sides) throw new Error('Невідомий тип кубика: ' + type);
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};
  const value = randInt(1, sides);
  const prevDiceId = Number(bState.latest_dice?.id) || 0;
  const id = Math.max(nextEventId(), prevDiceId + 1);
  bState.latest_dice = { id, type, value };
  // Запис у лозі має id кидка: клієнти ховають його до зупинки кубика (див. game.js), щоб не видати результат раніше анімації
  pushLog(bState, `Ведучий кинув кубик ${type}, випало ${value}`, id);
  await saveRoom(roomCode, { bunker_state: bState }, room.version);
  return { type, value };
}

export async function changeHost(roomCode, newHostId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!newHostId || !pState[newHostId]) throw new Error('Гравця не знайдено в кімнаті');
  if (newHostId === room.host_id) throw new Error('Цей гравець уже ведучий');
  const bState = room.bunker_state || {};
  setHostEvent(bState, `Ведучий передав права ведучого гравцю ${nameOf(pState, newHostId)}`);
  await saveRoom(roomCode, { host_id: newHostId, bunker_state: bState }, room.version);
  // Передачу ролі скасувати не можна (панель зникає в колишнього ведучого одразу), тому знімка ця дія не робить, а старий скидає.
  // Інакше після повернення ролі (А -> Б -> А) «Скасувати» відкотило б усе, що зробив Б. Новий ведучий починає без знімка:
  // «Скасувати» неактивне до його першої дії.
  clearSnapshot();
}

// Вигнати / повернути гравця. Просто інвертує players_state[id].is_kicked — рядок гравця
// лишається в БД (характеристики не губляться), UI лише "сіріє" його (players-table.js / styles.css).
export async function toggleKickPlayer(roomCode, playerId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!playerId || !pState[playerId]) throw new Error('Гравця не знайдено в кімнаті');
  snapshot(room);
  const bState = room.bunker_state || {};

  const wasKicked = !!pState[playerId].is_kicked;
  pState[playerId].is_kicked = !wasKicked;

  // Якщо гравця вигнали посеред активного голосування — прибираємо його голос і всі голоси проти нього,
  // щоб вигнаний не впливав на підсумок (і не потрапив у таблицю результатів).
  if (!wasKicked && bState.voting?.isActive && bState.voting.votes) {
    const cleaned = {};
    Object.entries(bState.voting.votes).forEach(([voterId, candidateId]) => {
      if (voterId !== playerId && candidateId !== playerId) cleaned[voterId] = candidateId;
    });
    bState.voting = { ...bState.voting, votes: cleaned };
  }

  setHostEvent(bState, wasKicked
    ? `Ведучий повернув гравця ${nameOf(pState, playerId)}`
    : `Ведучий вигнав гравця ${nameOf(pState, playerId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState }, room.version);
}

export async function kickPlayerFromLobby(roomCode, playerId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!playerId || !pState[playerId]) return;

  delete pState[playerId];

  await saveRoom(roomCode, { players_state: pState }, room.version);
}

export async function restartGame(roomCode) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const resetPlayers = {};
  Object.entries(pState).forEach(([id, p]) => { resetPlayers[id] = { name: p.name }; });
  await saveRoom(roomCode, { players_state: resetPlayers, bunker_state: {} }, room.version);
  // Після скидання панель ведучого зникає, тож скасувати його неможливо. Старий знімок не лишаємо:
  // інакше в новій грі «Скасувати» була б активна й відкотила б її до минулої гри.
  clearSnapshot();
}

export async function closeRoom(roomCode, stoppedTimer = null) {
  // Статус пишемо разом із bunker_state: додаємо в нього stopped_timer (рядок типу "01:25:30" з екрана ведучого), щоб у закритій
  // кімнаті таймер показував зафіксований час. Інші поля bunker_state лишаються як є (історія гри).
  // Realtime завжди передає змінений status в payload.new, тому game.js визначає закриття саме по status === 'closed'.
  // Статистику («Закрити кімнату») НЕ зараховуємо: вона нараховується лише у finishGame() нижче.
  // Завершену гру (finished) закрити не можна: стара вкладка ведучого не повинна викидати гравців із фіналу, а статистика вже зарахована.
  const room = await getRoom(roomCode);
  if (room.status === 'finished' || room.status === 'closed') {
    throw new Error('Гру вже завершено: гравці переглядають підсумки');
  }

  const patch = { status: 'closed' };
  if (stoppedTimer) {
    patch.bunker_state = { ...(room.bunker_state || {}), stopped_timer: stoppedTimer };
  }
  const { data, error } = await supabase
    .from('rooms')
    .update(patch)
    .eq('room_code', roomCode)
    .not('status', 'in', '(finished,closed)')
    .select('room_code');
  if (error) throw new Error(error.message || 'Не вдалося закрити кімнату');
  if (!data || data.length === 0) {
    throw new Error('Гру вже завершено: гравці переглядають підсумки');
  }
  clearSnapshot();
}

// ===== Завершення гри =====

// Живий гравець — той, хто не вибув і не вигнаний (та сама умова, що й у голосуванні). Офлайн на підрахунок не впливає.
export function countAlivePlayers(playersState) {
  return Object.values(playersState || {}).filter(p => p && p.is_alive !== false && !p.is_kicked).length;
}

// Кількість місць у бункері: bunker_state.capacity; якщо його ще немає — гравців / 2 з округленням вниз (але не менше 1, як при старті гри).
export function getBunkerCapacity(room) {
  const raw = room?.bunker_state?.capacity;
  if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) return Number(raw);
  return Math.max(1, Math.floor(Object.keys(room?.players_state || {}).length / 2));
}

// true — живих не більше, ніж місць: ведучий бачить «Завершити гру», інакше «Закрити кімнату».
export function canFinishGame(room) {
  return countAlivePlayers(room?.players_state) <= getBunkerCapacity(room);
}

// Зараховує статистику кожному учаснику через RPC record_game_results (ідемпотентність лежить на самій функції в БД).
async function recordGameResults(roomCode) {
  try {
    const { data: rpcRes, error: rpcError } = await supabase.rpc('record_game_results', { p_room_code: roomCode });
    if (rpcError) {
      console.error('Помилка фіксації результатів гри в історії:', rpcError.message || rpcError);
      return false;
    } else {
      // В БД помилки повертаються всередині jsonb (success: false), а не як rpcError
      if (!rpcRes || rpcRes.success !== true) {
        console.error('record_game_results повернув помилку:', rpcRes);
        return false;
      }
      console.log('Результат фіксації гри в історії (record_game_results):', rpcRes);
      if (rpcRes && rpcRes.recorded_players === 0 && !rpcRes.already_recorded) {
        console.warn('Жодного гравця не було зафіксовано в історії. Деталі помилок:', JSON.stringify(rpcRes.errors, null, 2));
      }
      return true;
    }
  } catch (err) {
    console.error('Не вдалося викликати record_game_results:', err);
    return false;
  }
}

// Завершує гру: status -> 'finished', таймери зупиняються, статистика зараховується ОДИН раз.
// Гравців не відключаємо: усі клієнти бачать фінал через Realtime (game.js). Статус змінюємо умовним UPDATE
// (лише якщо кімната ще не finished/closed), тому подвійний клік або дві вкладки ведучого не зарахують гру двічі:
// RPC викликає лише той запит, що реально змінив рядок.
export async function finishGame(roomCode, stoppedTimer = null) {
  const room = await getRoom(roomCode);
  if (room.status === 'finished' || room.status === 'closed') throw new Error('Гру вже завершено');

  const bState = { ...(room.bunker_state || {}) };
  if (Object.keys(bState).length === 0) throw new Error('Гру ще не розпочато');
  if (!canFinishGame(room)) throw new Error('Живих гравців більше, ніж місць у бункері. Продовжуйте гру або закрийте кімнату.');

  // Зупиняємо загальний таймер (активний і на паузі), таймер катаклізму фіксуємо текстом, як при закритті
  // Голосування візуальне й нікого не виганяє, тому не блокує завершення; просто закриваємо його, щоб воно не лишилось активним на фіналі
  if (bState.voting?.isActive === true) bState.voting = { ...bState.voting, isActive: false };
  clearTimerAutoStop();
  bState.global_timer_end = null;
  bState.timer_paused_left = null;
  if (stoppedTimer) bState.stopped_timer = stoppedTimer;
  pushLog(bState, 'Ведучий завершив гру');

  const { data, error } = await supabase
    .from('rooms')
    .update({ status: 'finished', bunker_state: bState })
    .eq('room_code', roomCode)
    .not('status', 'in', '(finished,closed)')
    .select('room_code');
  if (error) throw new Error(error.message || 'Не вдалося завершити гру');
  if (!data || data.length === 0) throw new Error('Гру вже завершено');

  clearSnapshot();
  // Гра вже завершена для всіх, тож у разі збою статистики лише голосно попереджаємо ведучого (помилка в тості панелі)
  const recorded = await recordGameResults(roomCode);
  if (!recorded) throw new Error('Гру завершено, але статистику не вдалося зарахувати. Повідомте адміністратора');
}
