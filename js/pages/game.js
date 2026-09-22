import { supabase } from '../services/supabase.js';
import { catastrophe } from '../game-moduls/catastrophe.js';
import { bunkerInfo } from '../game-moduls/bunker-info.js';
import { playerCharacteristics } from '../game-moduls/player-characteristics.js';
import { playersTable } from '../game-moduls/players-table.js';
import { specialAbilitiesTable } from '../game-moduls/special-abilities-table.js';

let currentRoomCode = null;
let realtimeSubscription = null;
let currentUserId = null;

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

    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('room_code', currentRoomCode)
      .single();

    if (error || !room) throw new Error("Кімнату не знайдено");

    updateGameBoard(room, boardEl);
    statusEl.style.display = 'none';
    boardEl.style.display = 'block';

    subscribeToRoomUpdates(boardEl);
    setupActionListeners();

  } catch (err) {
    statusEl.textContent = "Помилка: " + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

// Конвертує складний JSON гравця у плаский список для UI
function mapPlayerState(rawPlayer) {
  const chars = [];
  const abilities = [];
  
  const add = (label, val, rev, path) => chars.push({ label, value: val, open: rev, dbPath: path });

  if (rawPlayer.gender) add("Стать", rawPlayer.gender.value, rawPlayer.gender.is_revealed, 'gender.is_revealed');
  if (rawPlayer.age) add("Вік", rawPlayer.age.value + ' р.', rawPlayer.age.is_revealed, 'age.is_revealed');
  if (rawPlayer.childfree) add("Чайлдфрі", rawPlayer.childfree.value ? "Так" : "Ні", rawPlayer.childfree.is_revealed, 'childfree.is_revealed');
  
  if (rawPlayer.body) {
    add("Тілобудова", `${rawPlayer.body.type}, ${rawPlayer.body.height_cm} см`, rawPlayer.body.is_revealed, 'body.is_revealed');
  }

  if (rawPlayer.professions) {
    rawPlayer.professions.forEach((p, i) => add(`Професія ${i+1}`, `${p.title} (${p.stage})`, p.is_revealed, `professions.${i}.is_revealed`));
  }
  if (rawPlayer.health) {
    rawPlayer.health.forEach((h, i) => add(`Здоров'я ${i+1}`, `${h.disease} (${h.severity})`, h.is_revealed, `health.${i}.is_revealed`));
  }
  if (rawPlayer.hobbies) {
    rawPlayer.hobbies.forEach((h, i) => add(`Хобі ${i+1}`, `${h.title} (${h.stage})`, h.is_revealed, `hobbies.${i}.is_revealed`));
  }
  if (rawPlayer.traits) {
    rawPlayer.traits.forEach((t, i) => add(`Риса ${i+1}`, t.value, t.is_revealed, `traits.${i}.is_revealed`));
  }
  if (rawPlayer.phobias) {
    rawPlayer.phobias.forEach((p, i) => add(`Фобія ${i+1}`, p.value, p.is_revealed, `phobias.${i}.is_revealed`));
  }
  if (rawPlayer.backpack) {
    rawPlayer.backpack.forEach((b, i) => add(`Багаж ${i+1}`, b.item, b.is_revealed, `backpack.${i}.is_revealed`));
  }
  
  if (rawPlayer.special_abilities) {
    rawPlayer.special_abilities.forEach((a, i) => {
      abilities.push({ label: `Спец можливість №${i+1}`, value: a.text, open: a.is_revealed, dbPath: `special_abilities.${i}.is_revealed` });
    });
  }

  return { name: rawPlayer.name, characteristics: chars, abilities: abilities };
}

function updateGameBoard(roomData, container) {
  const pState = roomData.players_state || {};
  const bState = roomData.bunker_state || {};
  
  const bunkerData = bState.capacity ? {
    description: `${bState.history}. ${bState.rooms_description}. Розташування: ${bState.location}`,
    size: bState.size,
    yearsInBunker: bState.stay_time,
    foodSupply: bState.food_and_water,
    capacity: bState.capacity,
    features: bState.items || []
  } : null;

  const cataclysmData = bState.cataclysm ? {
    icon: "☢",
    title: bState.cataclysm.text,
    desc: `Час до удару: ${bState.cataclysm.timer_minutes} хв.`
  } : null;

  const parsedPlayers = [];
  const parsedAbilities = [];
  const allCharLabels = new Set();

  for (const [id, rawPlayer] of Object.entries(pState)) {
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

  const myData = pState[currentUserId] ? mapPlayerState(pState[currentUserId]) : { name: "Глядач", characteristics: [], abilities: [] };

  const order = [
    catastrophe(cataclysmData), 
    bunkerInfo(bunkerData),
    playerCharacteristics({ ownerName: myData.name, characteristics: myData.characteristics, abilities: myData.abilities }),
    playersTable(columns.length ? columns : ["Очікування роздачі..."], tableRows),
    specialAbilitiesTable(parsedAbilities)
  ];

  container.innerHTML = order.join("");
}

function subscribeToRoomUpdates(container) {
  if (realtimeSubscription) supabase.removeChannel(realtimeSubscription);
  realtimeSubscription = supabase
    .channel(`room-${currentRoomCode}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `room_code=eq.${currentRoomCode}` }, (payload) => {
      updateGameBoard(payload.new, container);
    }).subscribe();
}