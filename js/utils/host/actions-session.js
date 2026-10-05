import { pushLog } from '../log-writer.js';
import { randInt } from '../random.js';
import { getRoom, saveRoom, snapshot, clearSnapshot } from './room-store.js';
import { setHostEvent, nameOf } from './common.js';

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
  await saveRoom(roomCode, { bunker_state: bState });
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
  await saveRoom(roomCode, { bunker_state: bState });
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
  const id = Date.now();
  bState.latest_dice = { id, type, value };
  // Запис у лозі має id кидка: клієнти ховають його до зупинки кубика (див. game.js), щоб не видати результат раніше анімації
  pushLog(bState, `Ведучий кинув кубик ${type}, випало ${value}`, id);
  await saveRoom(roomCode, { bunker_state: bState });
  return { type, value };
}

export async function changeHost(roomCode, newHostId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!newHostId || !pState[newHostId]) throw new Error('Гравця не знайдено в кімнаті');
  if (newHostId === room.host_id) throw new Error('Цей гравець уже ведучий');
  snapshot(room);
  const bState = room.bunker_state || {};
  setHostEvent(bState, `Ведучий передав права ведучого гравцю ${nameOf(pState, newHostId)}`);
  await saveRoom(roomCode, { host_id: newHostId, bunker_state: bState });
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

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function kickPlayerFromLobby(roomCode, playerId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!playerId || !pState[playerId]) return;
  
  delete pState[playerId];
  
  await saveRoom(roomCode, { players_state: pState });
}

export async function restartGame(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const resetPlayers = {};
  Object.entries(pState).forEach(([id, p]) => { resetPlayers[id] = { name: p.name }; });
  await saveRoom(roomCode, { players_state: resetPlayers, bunker_state: {} });
}

export async function closeRoom(roomCode, stoppedTimer = null) {
  // Статус пишемо разом із bunker_state: додаємо в нього stopped_timer (рядок типу "01:25:30" з екрана ведучого), щоб у закритій
  // кімнаті таймер показував зафіксований час. Інші поля bunker_state лишаються як є (історія гри).
  // Realtime завжди передає змінений status в payload.new, тому game.js визначає закриття саме по status === 'closed'.
  // lobby.js вже відфільтровує кімнати зі status IN ('finished','closed').
  const patch = { status: 'closed' };
  if (stoppedTimer) {
    const room = await getRoom(roomCode);
    patch.bunker_state = { ...(room.bunker_state || {}), stopped_timer: stoppedTimer };
  }
  await saveRoom(roomCode, patch);
  clearSnapshot();
}
