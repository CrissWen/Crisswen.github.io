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

    const { data: room, error } = await supabase.from('rooms').select('*').eq('room_code', currentRoomCode).single();
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

// Парсер, що форматує дані для UI (з'єднує масиви через кому)
function mapPlayerState(rawPlayer) {
  const chars = [];
  
  const add = (key, label, formatFunc) => {
    if (!rawPlayer[key]) return;
    const data = rawPlayer[key];
    let val, rev;
    
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      val = data.map(formatFunc).join(", "); 
      rev = data[0].is_revealed; 
    } else {
      val = formatFunc(data);
      rev = data.is_revealed;
    }
    chars.push({ label, value: val, open: rev, dbKey: key });
  };

  // 1. Обробка нового комплексного об'єкта біології
  if (rawPlayer.gender_info) {
    const g = rawPlayer.gender_info;
    const childStr = g.is_childfree ? " | Чайлдфрі" : "";
    chars.push({
      label: "Стать",
      value: `${g.gender}, ${g.age} р.${childStr}`,
      open: g.is_revealed,
      dbKey: 'gender_info'
    });
  }

  // 2. Обробка решти характеристик
  add('body', 'Статура', d => `${d.height_cm} см (${d.type})`);
  add('professions', 'Професія', d => `${d.title} (${d.stage})`);
  add('health', "Здоров'я", d => `${d.disease} (${d.severity})`);
  add('hobbies', 'Хобі/Навички', d => `${d.title} (${d.stage})`);
  add('traits', 'Риса характеру', d => d.value);
  add('phobias', 'Фобія', d => d.value);
  add('backpack', 'Рюкзак', d => d.item);
  add('large_inventory', 'Крупний інвентар', d => d.item);
  add('extra_info', 'Дод. відомості', d => d.value);

  // Спец можливостей ЗАВЖДИ рівно 2
  const abilities = [];
  const sa = rawPlayer.special_abilities || [];
  for (let i = 0; i < 2; i++) {
    const a = sa[i];
    if (a) {
      abilities.push({ label: `Спец можливість №${i+1}`, value: a.text, open: a.is_revealed, dbKey: 'special_abilities', index: i });
    } else {
      abilities.push({ label: `Спец можливість №${i+1}`, value: "Немає", open: false });
    }
  }

  return { name: rawPlayer.name, characteristics: chars, abilities: abilities };
}
function updateGameBoard(roomData, container) {
  const pState = roomData.players_state || {};
  const bState = roomData.bunker_state || {};
  
  // Мапимо бункер
  const bunkerData = bState.capacity ? {
    description: `${bState.history}. ${bState.rooms_description}. Розташування: ${bState.location}`,
    size: bState.size,
    yearsInBunker: bState.stay_time,
    foodSupply: bState.food_and_water,
    capacity: bState.capacity,
    features: bState.items || []
  } : null;

  // Мапимо катаклізм (використовуємо description, ігноруємо timer_minutes)
  const cataclysmData = bState.cataclysm ? {
    icon: "☢",
    title: bState.cataclysm.text,
    desc: bState.cataclysm.description
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
      console.log("Отримано оновлення від іншого гравця!", payload.new);
      // Завжди беремо свіжий елемент зі сторінки, щоб уникнути втрати контексту
      const boardEl = document.getElementById('game-board');
      if (boardEl) {
        updateGameBoard(payload.new, boardEl);
      }
    }).subscribe();
}
// ЄДИНИЙ глобальний слухач кліків для всієї сторінки гри
function setupActionListeners() {
  document.removeEventListener("click", handleGlobalClick);
  document.addEventListener("click", handleGlobalClick);
}

// Пряме оновлення бази даних та інтерфейсу при кліку на замок
async function handleGlobalClick(e) {
  const lockBtn = e.target.closest(".char-lock");
  if (!lockBtn) return;

  const item = lockBtn.closest(".char-item");
  if (!item) return;

  const dbKey = item.dataset.dbkey;
  const idxStr = item.dataset.idx;
  if (!dbKey) return;

  try {
    // 1. Беремо актуальний стан із бази
    const { data: room, error } = await supabase.from('rooms').select('*').eq('room_code', currentRoomCode).single();
    if (error || !room || !room.players_state[currentUserId]) return;

    const state = room.players_state;
    const targetRef = state[currentUserId][dbKey];

    // 2. Змінюємо стан is_revealed локально
    if (Array.isArray(targetRef)) {
      if (idxStr !== "" && idxStr !== undefined) {
        // Конкретний елемент (напр. спецможливість №1)
        const i = parseInt(idxStr);
        targetRef[i].is_revealed = !targetRef[i].is_revealed;
      } else {
        // Масив цілком (напр. дві професії відкриваються разом)
        const newState = !targetRef[0].is_revealed;
        targetRef.forEach(x => x.is_revealed = newState);
      }
    } else {
      // Простий об'єкт (напр. gender_info)
      targetRef.is_revealed = !targetRef.is_revealed;
    }

    // 3. МИТТЄВЕ ОНОВЛЕННЯ ІНТЕРФЕЙСУ (до запиту на сервер)
    // Оновлюємо об'єкт кімнати і одразу перемальовуємо все (замки + всі таблиці)
    room.players_state = state;
    updateGameBoard(room, document.getElementById('game-board'));

    // 4. Зберігаємо змінений стан у базу (у фоні)
    await supabase.from('rooms').update({ players_state: state }).eq('room_code', currentRoomCode);
    
  } catch (err) {
    console.error("Помилка оновлення:", err);
  }
}