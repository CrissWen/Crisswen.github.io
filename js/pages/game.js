import { supabase } from '../services/supabase.js';
import { catastrophe } from '../game-moduls/catastrophe.js';
import { bunkerInfo } from '../game-moduls/bunker-info.js';
import { playerCharacteristics } from '../game-moduls/player-characteristics.js';
import { playersTable } from '../game-moduls/players-table.js';
import { specialAbilitiesTable } from '../game-moduls/special-abilities-table.js';
import { mapPlayerState } from '../utils/player-parser.js';
import { waitingRoom } from '../game-moduls/waiting-room.js';
import { generateGameState } from '../utils/game-generator.js';

let currentRoomCode = null;
let realtimeSubscription = null;
let currentUserId = null;
let currentUserName = null;

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

    updateGameBoard(room, boardEl);
    statusEl.style.display = 'none';
    boardEl.style.display = 'block';

    subscribeToRoomUpdates();
    setupActionListeners();

  } catch (err) {
    statusEl.textContent = "Помилка: " + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

function updateGameBoard(roomData, container) {
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  const isHost = roomData.host_id === currentUserId;

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
  
  const problemText = bState.problem && bState.problem !== "Відсутня" 
    ? ` ${bState.problem}` 
    : "";

  const bunkerData = bState.capacity ? {
    description: `${bState.history || ''}. ${bState.rooms_description || ''}. ${bState.location || ''} ${problemText}.`,
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

    const flatPlayer = mapPlayerState(rawPlayer);
    flatPlayer.characteristics.forEach(c => allCharLabels.add(c.label));
    
    parsedAbilities.push({
      name: flatPlayer.name,
      ability1: flatPlayer.abilities[0]?.open ? flatPlayer.abilities[0].value : null,
      ability2: flatPlayer.abilities[1]?.open ? flatPlayer.abilities[1].value : null
    });
    
    parsedPlayers.push(flatPlayer);
  }

  const columns = Array.from(allCharLabels);
  
  const tableRows = parsedPlayers.map(p => {
    const cells = columns.map(colName => {
      const char = p.characteristics.find(c => c.label === colName);
      return (char && char.open) ? char.value : null; 
    });
    return { name: p.name, cells: cells };
  });

  const myData = (pState[currentUserId] && pState[currentUserId].gender) 
    ? mapPlayerState(pState[currentUserId]) 
    : { name: pState[currentUserId]?.name || "Глядач", characteristics: [], abilities: [] };

  const order = [
    catastrophe(cataclysmData), 
    bunkerInfo(bunkerData),
    playerCharacteristics({ ownerName: myData.name, characteristics: myData.characteristics, abilities: myData.abilities }),
    playersTable(columns.length ? columns : ["Очікування роздачі..."], tableRows),
    specialAbilitiesTable(parsedAbilities)
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
      const boardEl = document.getElementById('game-board');
      if (boardEl) {
        updateGameBoard(payload.new, boardEl);
      }
    }).subscribe();
}

function setupActionListeners() {
  document.removeEventListener("click", handleGlobalClick);
  document.addEventListener("click", handleGlobalClick);
}

async function handleGlobalClick(e) {
  const lockBtn = e.target.closest(".char-lock");
  if (!lockBtn) return;

  const item = lockBtn.closest(".char-item");
  if (!item) return;

  const dbKey = item.dataset.dbkey;
  const idxStr = item.dataset.idx;
  if (!dbKey) return;

  try {
    const { data: room, error } = await supabase.from('rooms').select('*').eq('room_code', currentRoomCode).single();
    if (error || !room || !room.players_state[currentUserId]) return;

    const state = room.players_state;
    const targetRef = state[currentUserId][dbKey];

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

    room.players_state = state;
    updateGameBoard(room, document.getElementById('game-board'));

    await supabase.from('rooms').update({ players_state: state }).eq('room_code', currentRoomCode);
    
  } catch (err) {
    console.error("Помилка оновлення:", err);
  }
}

export function cleanupGame() {
  if (realtimeSubscription) {
    supabase.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }
  document.removeEventListener("click", handleGlobalClick);
}