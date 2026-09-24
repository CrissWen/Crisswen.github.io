import { supabase } from '../services/supabase.js';
import { catastrophe } from '../game-moduls/catastrophe.js';
import { bunkerInfo } from '../game-moduls/bunker-info.js';
import { playerCharacteristics } from '../game-moduls/player-characteristics.js';
import { playersTable } from '../game-moduls/players-table.js';
import { specialAbilitiesTable } from '../game-moduls/special-abilities-table.js';
import { mapPlayerState } from '../utils/player-parser.js';
import { waitingRoom } from '../game-moduls/waiting-room.js';
import { mountGameTimer, unmountGameTimer } from '../game-moduls/game-timer.js';
import { generateGameState } from '../utils/game-generator.js';
import * as HostActions from '../utils/host-actions.js';
import {
  renderHostPanel,
  refreshHostPanel,
  fillStageOptions,
  getHostPanelRoot,
  removeHostPanel,
  setHostPanelOpen,
  showHostToast,
  setHostDiceResult
} from '../game-moduls/host-panel.js';

let currentRoomCode = null;
let realtimeSubscription = null;
let currentUserId = null;
let currentUserName = null;
let localRoomState = null;

export function renderGame() {
  return `
    <div id="game-status" style="text-align: center; padding: 20px; color: var(--text-mute);">
      Завантаження кімнати...
    </div>
    <div id="game-board" style="display: none;"></div>
  `;
}

export async function initGame() {
  const statusEl = document.getElementById('game-status');
  const boardEl = document.getElementById('game-board');
  const hashParts = window.location.hash.split('?room=');
  
  if (hashParts.length < 2 || !hashParts[1]) {
    window.location.hash = '#/lobby';
    return;
  }
  currentRoomCode = hashParts[1].toUpperCase();

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Ви не авторизовані");
    currentUserId = user.id;
    currentUserName = user.user_metadata?.username || "Гравець";

    const { data: room, error } = await supabase.from('rooms').select('*').eq('room_code', currentRoomCode).single();
    if (error || !room) throw new Error("Кімнату не знайдено");

    localRoomState = room;

    const isGameStarted = Object.keys(room.bunker_state || {}).length > 0;
    const isPlayerInRoom = room.players_state && room.players_state[currentUserId];

    
    if (isGameStarted && !isPlayerInRoom) {
      statusEl.textContent = "Гра вже почалася. Приєднання нових гравців закрито.";
      statusEl.style.color = 'var(--danger)';
      return;
    }

    
    if (!isGameStarted && !isPlayerInRoom) {
      const updatedPlayersState = room.players_state || {};
      
      updatedPlayersState[currentUserId] = { name: currentUserName };
      
      await supabase.from('rooms').update({ players_state: updatedPlayersState }).eq('room_code', currentRoomCode);
      room.players_state = updatedPlayersState;
    }

    updateGameBoard(localRoomState, boardEl);
    statusEl.style.display = 'none';
    boardEl.style.display = 'block';

    subscribeToRoomUpdates();
    setupActionListeners();
    mountGameTimer(() => localRoomState?.bunker_state);

  } catch (err) {
    statusEl.textContent = "Помилка: " + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

function updateGameBoard(roomData, container) {
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  const isHost = roomData.host_id === currentUserId;
  syncHostPanel(roomData);

  if (!isGameStarted) {
    container.innerHTML = waitingRoom({
      roomCode: currentRoomCode,
      playersState: roomData.players_state,
      isHost: isHost
    });
    
    if (isHost) {
      document.getElementById('start-game-btn')?.addEventListener('click', handleStartGame);
    }
  } else {
    renderActiveGame(roomData, container);
  }
}

async function handleStartGame(e) {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = "Генерація...";

  try {
    
    const { data: room } = await supabase.from('rooms').select('players_state').eq('room_code', currentRoomCode).single();
    const pState = room.players_state || {};
    const playersList = Object.entries(pState).map(([id, p]) => ({ id, name: p.name }));

    
    const { data: pack, error: packError } = await supabase
      .from('packs')
      .select('id, config')
      .eq('title', 'default')
      .single();

    if (packError || !pack) throw new Error("Не вдалося завантажити конфігурацію пака з бази");

    const { data: cardsRows, error: cardsError } = await supabase
      .from('pack_cards')
      .select('pool_type, category, value, meta')
      .eq('pack_id', pack.id); 

    if (cardsError || !cardsRows || cardsRows.length === 0) {
      throw new Error("Не знайдено жодної картки для цього пака");
    }

    
    const cardsData = {
      bunker: {},
      character: {}
    };

    cardsRows.forEach(row => {
      const pool = row.pool_type; 
      const cat = row.category;   
      
      if (!cardsData[pool][cat]) {
        cardsData[pool][cat] = [];
      }
      
      cardsData[pool][cat].push({
        value: row.value,
        meta: row.meta || {}
      });
    });

    const { bunkerState, playersState } = generateGameState(playersList, cardsData, pack.config);
    
    await supabase.from('rooms').update({ 
      bunker_state: bunkerState,
      players_state: playersState 
    }).eq('room_code', currentRoomCode);

  } catch (err) {
    console.error("Помилка старту:", err);
    alert(err.message);
    btn.disabled = false;
    btn.textContent = "Почати гру";
  }
}


function renderActiveGame(roomData, container) {
  const pState = roomData.players_state || {};
  const bState = roomData.bunker_state || {};
  
const descriptionParts = [
    bState.history,
    bState.rooms_description,
    bState.location,
    (bState.problem && bState.problem !== "Відсутня") ? bState.problem : null
  ]
  .filter(Boolean)
  .map(text => {
    const trimmed = text.trim();
    return trimmed.match(/[.!?]$/) ? trimmed : trimmed + ".";
  });

  const bunkerData = bState.capacity ? {
    description: descriptionParts.join(" "),
    size: bState.size,
    yearsInBunker: bState.stay_time,
    foodSupply: bState.food_and_water,
    capacity: bState.capacity,
    features: bState.items || []
  } : null;

  const cataclysmData = bState.cataclysm ? {
    icon: "☢",
    title: bState.cataclysm.text,
    desc: bState.cataclysm.description
  } : null;

  const parsedPlayers = [];
  const parsedAbilities = [];
  const allCharLabels = new Set();

  for (const [id, rawPlayer] of Object.entries(pState)) {
    
    if (!rawPlayer.gender) continue; 

    // Помилка парсингу одного гравця не повинна ламати весь стіл
    try {
      const flatPlayer = mapPlayerState(rawPlayer);
      flatPlayer.characteristics.forEach(c => allCharLabels.add(c.label));

      parsedAbilities.push({
        name: flatPlayer.name,
        ability1: flatPlayer.abilities[0]?.open ? flatPlayer.abilities[0].value : null,
        ability2: flatPlayer.abilities[1]?.open ? flatPlayer.abilities[1].value : null
      });

      parsedPlayers.push(flatPlayer);
    } catch (err) {
      console.error(`Не вдалося розібрати стан гравця ${id}:`, err);
    }
  }

  const columns = Array.from(allCharLabels);
  
  const tableRows = parsedPlayers.map(p => {
    const cells = columns.map(colName => {
      const char = p.characteristics.find(c => c.label === colName);
      return (char && char.open) ? char.value : null; 
    });
    return { name: p.name, cells: cells };
  });

  let myData = { name: pState[currentUserId]?.name || "Глядач", characteristics: [], abilities: [] };
  try {
    if (pState[currentUserId] && pState[currentUserId].gender) {
      myData = mapPlayerState(pState[currentUserId]);
    }
  } catch (err) {
    console.error('Не вдалося розібрати власні характеристики:', err);
  }

  // Кожен блок рендериться окремо: помилка в одному не ламає решту столу
  const safe = (title, fn) => {
    try {
      return fn();
    } catch (err) {
      console.error(`Помилка рендеру блоку «${title}»:`, err);
      return `<div style="padding:12px;color:var(--text-mute);">Не вдалося відобразити блок «${title}»</div>`;
    }
  };

  const order = [
    safe('Катаклізм', () => catastrophe(cataclysmData)),
    safe('Бункер', () => bunkerInfo(bunkerData)),
    safe('Мої характеристики', () => playerCharacteristics({ ownerName: myData.name, characteristics: myData.characteristics, abilities: myData.abilities })),
    safe('Гравці', () => playersTable(columns.length ? columns : ["Очікування роздачі..."], tableRows)),
    safe('Спец. можливості', () => specialAbilitiesTable(parsedAbilities))
  ];

  container.innerHTML = order.join("");
}

function subscribeToRoomUpdates() {
  if (realtimeSubscription) supabase.removeChannel(realtimeSubscription);
  
  realtimeSubscription = supabase
    .channel(`room-${currentRoomCode}`)
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'rooms', 
      filter: `room_code=eq.${currentRoomCode}` 
    }, (payload) => {
      // Supabase Realtime у payload.new НЕ передає великі (TOAST) jsonb-колонки, які не змінювались
      // в цьому UPDATE. Тому таймер/голосування (міняють лише bunker_state) приходили без players_state,
      // і характеристики зникали. Зливаємо зміни поверх попереднього стану замість повної заміни.
      localRoomState = { ...localRoomState, ...payload.new };

      // Ведучий закрив кімнату: повертаємо всіх у лобі
      if (localRoomState.bunker_state?.room_closed) {
        if (localRoomState.host_id !== currentUserId) alert('Ведучий закрив кімнату.');
        window.location.hash = '#/lobby';
        return;
      } 
      
      const boardEl = document.getElementById('game-board');
      if (boardEl) {
        updateGameBoard(localRoomState, boardEl);
      }
    }).subscribe();
}

function setupActionListeners() {
  document.removeEventListener("click", handleGlobalClick);
  document.addEventListener("click", handleGlobalClick);
}

let isUpdatingLock = false;

async function handleGlobalClick(e) {
  if (isUpdatingLock) return;

  const lockBtn = e.target.closest(".char-lock");
  if (!lockBtn) return;

  const item = lockBtn.closest(".char-item");
  if (!item) return;

  const dbKey = item.dataset.dbkey;
  const idxStr = item.dataset.idx;
  if (!dbKey) return;

  isUpdatingLock = true;

  try {
    if (!localRoomState || !localRoomState.players_state[currentUserId]) return;
    
    const state = localRoomState.players_state;
    const targetRef = state[currentUserId][dbKey];

    // Порожню характеристику ("Пусто") ховати/відкривати нема сенсу — і немає чого перемикати
    // Немає чого перемикати, лише якщо поле взагалі відсутнє або порожній масив без маркера (напр. після deleteInventory).
    // Маркер isEmpty (напр. після крадіжки) має свій is_revealed і перемикається як звичайна характеристика.
    if (!targetRef || (Array.isArray(targetRef) && targetRef.length === 0)) return;

    if (Array.isArray(targetRef)) {
      if (idxStr !== "" && idxStr !== undefined) {
        const i = parseInt(idxStr);
        targetRef[i].is_revealed = !targetRef[i].is_revealed;
      } else {
        const newState = !targetRef[0].is_revealed;
        targetRef.forEach(x => x.is_revealed = newState);
      }
    } else {
      targetRef.is_revealed = !targetRef.is_revealed;
      
      if (dbKey === 'gender') {
        const newState = targetRef.is_revealed;
        if (state[currentUserId].age) state[currentUserId].age.is_revealed = newState;
        if (state[currentUserId].is_childfree) state[currentUserId].is_childfree.is_revealed = newState;
        if (state[currentUserId].childfree) state[currentUserId].childfree.is_revealed = newState;
      }
    }

    updateGameBoard(localRoomState, document.getElementById('game-board'));

    await supabase.rpc('update_single_player_state', {
      room_code_val: currentRoomCode,
      user_id_val: currentUserId,
      player_data: state[currentUserId]
    });
    
  } catch (err) {
    console.error("Помилка оновлення:", err);
  } finally {
    isUpdatingLock = false; 
  }
}

// ===== Панель ведучого: монтування, події, виклик дій =====

function getPlayersList(playersState) {
  return Object.entries(playersState || {}).map(([id, p]) => ({ id, name: p.name || 'Гравець' }));
}

function hostPanelData(roomData) {
  return {
    players: getPlayersList(roomData.players_state),
    currentUserId,
    capacity: roomData.bunker_state?.capacity,
    canUndo: HostActions.canUndo()
  };
}

// Панель живе поза #game-board, тож перемальовування дошки її не зачіпає.
// Показуємо лише ведучому і лише після старту гри (до роздачі карт дії не мають сенсу).
function syncHostPanel(roomData) {
  const isHost = roomData.host_id === currentUserId;
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  let root = getHostPanelRoot();

  if (!isHost || !isGameStarted) {
    if (root) removeHostPanel();
    return;
  }

  if (!root) {
    document.body.insertAdjacentHTML('beforeend', renderHostPanel({
      capacity: roomData.bunker_state.capacity,
      canUndo: HostActions.canUndo()
    }));
    root = getHostPanelRoot();
    bindHostEvents(root);
    HostActions.getStageOptions()
      .then(stages => fillStageOptions(getHostPanelRoot(), stages))
      .catch(err => console.error('Не вдалося завантажити стадії:', err));
  }

  refreshHostPanel(root, hostPanelData(roomData));
}

const HOST_ACTIONS = {
  timer:     { run: (f, arg) => HostActions.setGlobalTimer(currentRoomCode, Number(arg)), ok: (r, f, arg) => `Таймер на ${arg} с запущено` },
  cataclysm: { run: () => HostActions.changeCataclysm(currentRoomCode), ok: 'Катаклізм змінено' },
  voting:    { run: () => HostActions.startVoting(currentRoomCode), ok: 'Голосування розпочато' },
  capacity:  {
    run: (f, arg) => HostActions.changeBunkerCapacity(currentRoomCode, Number(arg)),
    ok: (r) => `Місць у бункері: ${r}`,
    after: (root, r) => { const el = root.querySelector('[data-hp-capacity]'); if (el) el.textContent = r; }
  },

  changeCharacteristic: { run: f => HostActions.changeCharacteristic(currentRoomCode, f.target, f.charType), ok: 'Характеристику змінено' },
  changeExperience:     { run: f => HostActions.changeExperience(currentRoomCode, f.target, f.level), ok: 'Стаж змінено' },
  changeDiseaseSeverity:{ run: f => HostActions.changeDiseaseSeverity(currentRoomCode, f.target, f.level), ok: 'Ступінь хвороби змінено' },
  invertGender:        { run: f => HostActions.invertGender(currentRoomCode, f.target), ok: 'Стать змінено' },
  swapCharacteristics: { run: f => HostActions.swapCharacteristics(currentRoomCode, f.charType, f.target), ok: 'Обмін виконано' },
  stealCharacteristic: { run: f => HostActions.stealCharacteristic(currentRoomCode, f.thief, f.victim, f.charType), ok: 'Характеристику викрадено' },
  healPlayer:          { run: f => HostActions.healPlayer(currentRoomCode, f.target, f.heal), ok: 'Лікування застосовано' },
  addExtraCharacteristic: {
    // Якщо текстове поле не порожнє — передаємо його як кастомне значення, інакше береться випадкова картка
    run: f => HostActions.addExtraCharacteristic(currentRoomCode, f.target, f.category, (f.customExtra || '').trim()),
    ok: 'Картку додано',
    after: root => { const el = root.querySelector('[data-field="customExtra"]'); if (el) el.value = ''; }
  },
  deleteInventory:     { run: (f, arg) => HostActions.deleteInventory(currentRoomCode, f.target, arg), ok: 'Інвентар видалено' },
  shift:               { run: (f, arg) => HostActions.shiftAnnulCharacteristics(currentRoomCode, f.charType, arg), ok: 'Характеристики зсунуто' },
  changeBunker: {
    run: f => HostActions.changeBunker(currentRoomCode, f.bunkerField, f.customValue),
    ok: 'Параметр бункера змінено',
    after: root => { const el = root.querySelector('[data-field="customValue"]'); if (el) el.value = ''; }
  },

  dice: {
    run: (f, arg) => HostActions.rollDice(Number(arg)),
    ok: (r, f, arg) => `Кубик D${arg}: ${r}`,
    after: (root, r) => setHostDiceResult(root, r)
  },

  changeHost: {
    confirm: 'Передати права ведучого обраному гравцю? Ви втратите доступ до цієї панелі.',
    run: f => HostActions.changeHost(currentRoomCode, f.newHost),
    ok: 'Права ведучого передано'
  },
  undo:    { run: () => HostActions.undoLastAction(currentRoomCode), ok: 'Дію скасовано' },
  restart: {
    confirm: 'Почати гру наново? Усі картки буде скинуто, гравці повернуться до кімнати очікування.',
    run: () => HostActions.restartGame(currentRoomCode),
    ok: 'Гру скинуто'
  },
  closeRoom: {
    confirm: 'Закрити кімнату? Усіх гравців буде відключено, дію не можна скасувати.',
    run: () => HostActions.closeRoom(currentRoomCode),
    ok: 'Кімнату закрито',
    after: () => { window.location.hash = '#/lobby'; }
  }
};

// Збирає значення всіх [data-field] всередині того ж акордеона, що й натиснута кнопка
function readHostFields(btn) {
  const scope = btn.closest('.hp-acc-body');
  const fields = {};
  scope?.querySelectorAll('[data-field]').forEach(el => { fields[el.dataset.field] = el.value; });
  return fields;
}

async function runHostAction(root, btn) {
  const def = HOST_ACTIONS[btn.dataset.action];
  if (!def) return;
  if (def.confirm && !window.confirm(def.confirm)) return;

  const arg = btn.dataset.arg;
  btn.disabled = true;
  try {
    const result = await def.run(readHostFields(btn), arg);
    const msg = typeof def.ok === 'function' ? def.ok(result, null, arg) : def.ok;
    showHostToast(root, msg);
    def.after?.(root, result);
  } catch (err) {
    console.error('Помилка дії ведучого:', err);
    showHostToast(root, err.message || 'Не вдалося виконати дію', true);
  } finally {
    btn.disabled = false;
    // Оновлюємо лише стан кнопки undo; решту панелі перемалює подія з WebSocket
    const undoBtn = root.querySelector('[data-action="undo"]');
    if (undoBtn) undoBtn.disabled = !HostActions.canUndo();
  }
}

function bindHostEvents(root) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-hp-toggle]')) {
      setHostPanelOpen(root, !root.classList.contains('hp-open'));
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn && !btn.disabled) runHostAction(root, btn);
  });
}

export function cleanupGame() {
  removeHostPanel();
  unmountGameTimer();
  if (realtimeSubscription) {
    supabase.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }
  document.removeEventListener("click", handleGlobalClick);
}