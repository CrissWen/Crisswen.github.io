import { supabase } from '../services/supabase.js';
import { cataclysm } from '../game-moduls/cataclysm.js';
import { bunkerInfo } from '../game-moduls/bunker-info.js';
import { playerCharacteristics } from '../game-moduls/player-characteristics.js';
import { playersTable } from '../game-moduls/players-table.js';
import { specialAbilitiesTable } from '../game-moduls/special-abilities-table.js';
import { votingSection, captureVoteSelection, restoreVoteSelection } from '../game-moduls/voting.js';
import { mapPlayerState } from '../utils/player-parser.js';
import { waitingRoom } from '../game-moduls/waiting-room.js';
import { mountGameTimer, unmountGameTimer } from '../game-moduls/game-timer.js';
import { mountCataclysmTimer, unmountCataclysmTimer, syncCataclysmTimer, freezeCataclysmTimer, getCataclysmTimerText } from '../game-moduls/cataclysm-timer.js';
import { generateGameState } from '../utils/game-generator.js';
import { getGameConfig, getGameConfigSync } from '../config/config-manager.js';
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
import { showCustomConfirm } from '../game-moduls/confirm-dialog.js';
import { showGlobalToast } from '../game-moduls/global-toast.js';
import { showDiceRoll, ROLL_MS as DICE_ROLL_MS } from '../game-moduls/dice-overlay.js';
import { eventLog, toggleEventLog, scrollEventLogToBottom } from '../game-moduls/event-log.js';
import { personalNotes, captureNotesFocus, restoreNotesFocus } from '../game-moduls/personal-notes.js';
import { addLog } from '../utils/event-log.js';

let currentRoomCode = null;
let realtimeSubscription = null;
let currentUserId = null;
let currentUserName = null;
let isSpectator = false; // глядач: гра вже йде, а гравця немає в players_state (виводиться в updateGameBoard на кожне оновлення)
let localRoomState = null;
let hasSeenCataclysmEnd = false; // флаг в пам'яті вкладки: щоб модалка "Час сплив" не вискакала повторно
let trackedCataclysmTimerEnd = null; // останнє відоме cataclysm_timer_end (для скидання флага при НОВОМУ катаклізмі)
let wasVotingActive = false; // щоб автоскрол до #voting-section спрацював рівно один раз на кожне запускання голосування, а не при кожному рендері
let votingFinishInFlight = false; // щоб декілька швидких postgres_changes підряд не відправили кілька паралельних finishVoting
let pendingDiceLogId = null; // id запису в лозі про кидок, який прихований до зупинки кубика
let pendingDiceLogTimer = null;

// Закрита кімната — режим лише для читання для будь-кого (навіть колишнього хоста/гравця): host_id ігнорується, панель ведучого не рендериться.
function isHostOf(roomData) {
  if (roomData.status === 'closed') return false;
  return roomData.host_id === currentUserId;
}

// Синхронізує віджет-таймер катаклізму і скидає флаг модалки "Час сплив", коли ведучий ставить
// новий катаклізм (інше значення cataclysm_timer_end) — щоб модалка могла показатись знову для наступного відліку.
function syncCataclysm(bunkerState, roomStatus) {
  const end = bunkerState?.cataclysm_timer_end ?? null;
  if (end !== trackedCataclysmTimerEnd) {
    trackedCataclysmTimerEnd = end;
    hasSeenCataclysmEnd = false;
  }
  syncCataclysmTimer(bunkerState, roomStatus);
}

// Захист від спаму: відлік досягає нуля рівно один раз (цей колбек викликає модуль
// cataclysm-timer.js рівно один раз на кожне окреме end), але додатково перевіряємо флаг
// так, як це описано в ТЗ (без нього модалка вискочила б при кожному рендері сторінки).
function onCataclysmTimerExpired() {
  if (hasSeenCataclysmEnd) return;
  hasSeenCataclysmEnd = true;
  showCataclysmEndModal();
}

function showCataclysmEndModal() {
  if (document.getElementById('cataclysm-end-modal')) return; // вже показана — другої не створюємо
  document.body.insertAdjacentHTML('beforeend', `
    <div id="cataclysm-end-modal" class="cataclysm-end-modal" role="alertdialog" aria-modal="true">
      <div class="cataclysm-end-modal__card">
        <div class="cataclysm-end-modal__icon" aria-hidden="true">☠</div>
        <p class="cataclysm-end-modal__text">Час сплив. Ви не потрапили у бункер :(</p>
        <button type="button" class="cataclysm-end-modal__btn" data-cata-modal-close>Закрити</button>
      </div>
    </div>
  `);

  const root = document.getElementById('cataclysm-end-modal');
  requestAnimationFrame(() => root.classList.add('is-open'));

  const close = () => {
    root.classList.remove('is-open');
    setTimeout(() => root.remove(), 200);
    root.removeEventListener('click', onRootClick);
    document.removeEventListener('keydown', onKeydown);
  };
  function onRootClick(e) {
    // Закрити кнопкою або кліком по підкладці за межами картки — гра при цьому не блокується, це лише DOM-оверлей
    if (e.target === root || e.target.closest('[data-cata-modal-close]')) close();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  root.addEventListener('click', onRootClick);
  document.addEventListener('keydown', onKeydown);
}

export function renderGame() {
  return `
    <div class="layout-large-centered">
      <div id="game-status" style="text-align: center; padding: 20px; color: var(--text-mute);">
        Завантаження кімнати...
      </div>
      <div id="game-board" style="display: none;"></div>
    </div>
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

    
    // Гра вже йде, а гравця в кімнаті немає — не відкидаємо, а пускаємо як глядача (isSpectator виставляє updateGameBoard).
    // Ліміт на місця (bc.maxPlayersInLobby, config-manager.js) діє виключно на етапі лобі: якщо гра вже йде, цю перевірку повністю ігноруємо.
    // Дочекуємось конфігу (base + можливий game-config.local.js) ДО першого рендеру кімнати. Інакше при прямому заході по посиланню
    // вейтінг-рум міг би побачити лише базові ліміти, поки локальний файл ще вантажиться (getGameConfigSync дає базу).
    const bc = await getGameConfig();
    if (!isGameStarted && !isPlayerInRoom) {
      const playersCount = Object.keys(room.players_state || {}).length;
      if (playersCount >= bc.maxPlayersInLobby) {
        showGlobalToast('Ця кімната вже переповнена');
        window.location.hash = '#/lobby';
        return;
      }
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
    mountCataclysmTimer(onCataclysmTimerExpired);
    syncCataclysm(localRoomState.bunker_state, localRoomState.status);

  } catch (err) {
    statusEl.textContent = "Помилка: " + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

function updateGameBoard(roomData, container) {
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  const isHost = isHostOf(roomData);
  // Закрита кімната — кожен, навіть колишній гравець/ведучий, примусово глядач (режим лише для читання)
  isSpectator = roomData.status === 'closed' || (isGameStarted && !roomData.players_state?.[currentUserId]);
  document.getElementById('spectator-badge')?.classList.toggle('is-hidden', !isSpectator);
  syncHostPanel(roomData);
  syncCataclysm(roomData.bunker_state, roomData.status);

  if (!isGameStarted) {
    // Із цього моменту конфіг вже завантажено (див. await getGameConfig() у initGame), тому синхронного читання досить
    const bc = getGameConfigSync();
    container.innerHTML = waitingRoom({
      roomCode: currentRoomCode,
      playersState: roomData.players_state,
      isHost: isHost,
      minPlayers: bc.minPlayersToStart,
      maxPlayers: bc.maxPlayersInLobby
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

    // Кнопка «Почати гру» вже disabled при недостатній кількості, але відображена кількість могла застаріти
    // (хтось вийшов між рендером і кліком) — тому рахуємо ще раз по свіжих даних кімнати.
    const { minPlayersToStart } = await getGameConfig();
    if (playersList.length < minPlayersToStart) {
      throw new Error(`Для старту потрібно мінімум ${minPlayersToStart} гравців (зараз ${playersList.length})`);
    }

    
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

    const { bunkerState, playersState } = await generateGameState(playersList, cardsData, pack.config);
    
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
  const isHost = isHostOf(roomData);
  
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
    desc: bState.cataclysm.description,
    population: bState.cataclysm.population
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
        ability2: flatPlayer.abilities[1]?.open ? flatPlayer.abilities[1].value : null,
        isKicked: !!rawPlayer.is_kicked
      });

      parsedPlayers.push({ ...flatPlayer, id });
    } catch (err) {
      console.error(`Не вдалося розібрати стан гравця ${id}:`, err);
    }
  }

  const columns = Array.from(allCharLabels);

  // Лічильник "Охочі потрапити в бункер": усі зареєстровані в кімнаті vs ще не вигнані (is_kicked).
  const totalPlayers = Object.keys(pState).length;
  const alivePlayers = Object.values(pState).filter(player => !player.is_kicked).length;

  const tableRows = parsedPlayers.map(p => {
    const cells = columns.map(colName => {
      const char = p.characteristics.find(c => c.label === colName);
      return (char && char.open) ? char.value : null; 
    });
    return { name: p.name, id: p.id, isKicked: !!pState[p.id]?.is_kicked, cells: cells };
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
    safe('Катаклізм', () => cataclysm(cataclysmData)),
    safe('Бункер', () => bunkerInfo(bunkerData)),
    isSpectator ? '' : safe('Мої характеристики', () => playerCharacteristics({ ownerName: myData.name, characteristics: myData.characteristics, abilities: myData.abilities })),
    safe('Гравці', () => playersTable(columns.length ? columns : ["Очікування роздачі..."], tableRows, alivePlayers, totalPlayers, isHost)),
    safe('Спец. можливості', () => specialAbilitiesTable(parsedAbilities)), // isKicked уже в кожному елементі
    safe('Голосування', () => votingSection({
      voting: bState.voting,
      players: Object.entries(pState).map(([id, p]) => ({ id, name: p.name || 'Гравець', alive: p.is_alive !== false })),
      myId: currentUserId,
      amAlive: !isSpectator && pState[currentUserId]?.is_alive !== false
    })),
    // Особисті замітки (тимчасові, лише в пам'яті вкладки) — між голосуванням і логом подій
    safe('Особисті замітки', () => personalNotes()),
    // Лог подій — самий низ сторінки, одразу після блоку голосування
    safe('Лог подій', () => eventLog(bState.logs, pendingDiceLogId ? [pendingDiceLogId] : []))
  ];

  captureVoteSelection(); // запам'ятовуємо обрану радіокнопку голосування, бо innerHTML нижче створить її заново без checked
  captureNotesFocus(); // запам'ятовуємо курсор у замітках, бо innerHTML нижче створить textarea заново
  container.innerHTML = order.join("");
  restoreVoteSelection(); // повертаємо виділення і розблоковуємо «Проголосувати»
  restoreNotesFocus();
  scrollEventLogToBottom(); // автоскрол логу до найсвіжішої події після кожного перемалювання

  // Автоматичний скрол до блоку голосування рівно один раз на кожне його запускання (див. syncVotingScroll)
  syncVotingScroll(pState, bState);

  // Лише клієнт ведучого фіксує фінал голосування (див. maybeAutoFinishVoting) — щоб кілька клієнтів одночасно не гнали UPDATE
  maybeAutoFinishVoting(roomData);
}

// Скролить до #voting-section рівно один раз на кожне "запускання" голосування (перехід isActive false→true) для
// живого гравця, який ще не проголосував — а не на кожен renderActiveGame() (він перевиконується на
// КОЖНе оновлення кімнати, навіть не пов'язане з голосуванням, інакше екран смикавсяб би при кожній дії ведучого).
function syncVotingScroll(pState, bState) {
  const isActive = !!bState?.voting?.isActive;
  const amAlive = !isSpectator && pState?.[currentUserId]?.is_alive !== false;
  const myVote = bState?.voting?.votes?.[currentUserId];

  if (isActive && !wasVotingActive && amAlive && !myVote) {
    requestAnimationFrame(() => {
      document.getElementById('voting-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  wasVotingActive = isActive;
}

// Живий клієнт ведучого ("майстер-клієнт") на кожне оновлення кімнати перевіряє, чи проголосували всі живі, і,
// якщо так — сам пише voting.isActive = false в БД. Лише ведучий (а не кожен гравець), щоб не було
// гонки кількох одночасних UPDATE від різних клієнтів у момент, коли останній голос щойно прийшов по WebSocket.
function maybeAutoFinishVoting(roomData) {
  if (roomData.host_id !== currentUserId) return;

  const voting = roomData.bunker_state?.voting;
  if (!voting?.isActive) return;

  const aliveCount = Object.values(roomData.players_state || {}).filter(p => p.is_alive !== false).length;
  const votedCount = Object.keys(voting.votes || {}).length;
  if (aliveCount === 0 || votedCount !== aliveCount) return;

  if (votingFinishInFlight) return;
  votingFinishInFlight = true;
  HostActions.finishVoting(currentRoomCode)
    .catch(err => console.error('Не вдалося автозавершити голосування:', err))
    .finally(() => { votingFinishInFlight = false; });
}

// Клік по радіо-плитці кандидата — розблоковує кнопку "Проголосувати" в тому ж блоці #voting-section.
function handleVoteRadioChange(e) {
  if (e.target.name !== 'vote') return;
  const btn = e.target.closest('#voting-section')?.querySelector('[data-vote-submit]');
  if (btn) btn.disabled = false;
}

// Запис голосу — звичайний UPDATE кімнати (як і решта механік гри), без RPC. Голосує рядовий гравець,
// а не ведучий, тож прямий запис у bunker_state має працювати незалежно від того, чи застосовано
// host-rls.sql (там UPDATE дозволений лише host_id = auth.uid()) — окрема RLS-політика на голосування
// має дозволяти будь-якому гравцю кімнати оновлювати лише bunker_state.voting.votes.
async function handleVoteSubmit(btn) {
  if (isSpectator) return; // глядач не голосує
  const section = btn.closest('#voting-section');
  const checked = section?.querySelector('input[name="vote"]:checked');
  if (!checked) return;

  const candidateId = checked.value;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Голосуємо...';

  try {
    // Читаємо свіжий bunker_state прямо перед записом, щоб не затерти голос когось,
    // хто проголосував між останнім Realtime-оновленням локального стейту і цим кліком.
    const { data: room, error: fetchError } = await supabase
      .from('rooms')
      .select('bunker_state')
      .eq('room_code', currentRoomCode)
      .single();
    if (fetchError || !room) throw new Error(fetchError?.message || 'Кімнату не знайдено');

    const bunker_state = room.bunker_state || {};
    if (!bunker_state.voting?.isActive) throw new Error('Голосування вже завершено');

    bunker_state.voting.votes = { ...bunker_state.voting.votes, [currentUserId]: candidateId };

    const { data, error } = await supabase
      .from('rooms')
      .update({ bunker_state: bunker_state })
      .eq('room_code', currentRoomCode);

    if (error) {
      console.error('Помилка:', error);
      throw new Error(error.message);
    }

    // Локально відразу відмічаємо свій голос: не чекаємо round-trip через WebSocket, а перемальовуємо
    // дошку зараз — voting.js сам сховає сітку кандидатів і покаже зелену панель "Ви проголосували..."
    // (стан визначається наявністю bunker_state.voting.votes[currentUserId]).
    if (localRoomState) {
      localRoomState.bunker_state = bunker_state;
      updateGameBoard(localRoomState, document.getElementById('game-board'));
    }
  } catch (err) {
    console.error('Не вдалося проголосувати:', err);
    alert(err.message || 'Не вдалося проголосувати');
    btn.disabled = false;
    btn.textContent = original;
  }
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
      // Фіксуємо id попередньої події ДО злиття стану — щоб відрізнити справжню нову подію від тієї, що вже показана.
      const prevEventId = localRoomState?.bunker_state?.latest_host_event?.id || 0;
      const prevDiceId = localRoomState?.bunker_state?.latest_dice?.id || 0;

      // Supabase Realtime у payload.new НЕ передає великі (TOAST) jsonb-колонки, які не змінювались
      // в цьому UPDATE. Тому таймер/голосування (міняють лише bunker_state) приходили без players_state,
      // і характеристики зникали. Зливаємо зміни поверх попереднього стану замість повної заміни.
      localRoomState = { ...localRoomState, ...payload.new };

      // Ведучий закрив кімнату (host-actions.js closeRoom пише лише status, bunker_state залишається як історія) — повертаємо всіх у лобі
      if (localRoomState.status === 'closed') {
        freezeCataclysmTimer(); // зупиняємо відлік рівно на цій секунді; текст таймера лишається як є
        if (localRoomState.host_id !== currentUserId) alert('Ведучий закрив кімнату.');
        window.location.hash = '#/lobby';
        return;
      } 

      // Нова подія від ведучого (крадіжка, зміна характеристики тощо) — показуємо всім гравцям тост по-центру екрана.
      const hostEvent = localRoomState.bunker_state?.latest_host_event;
      if (hostEvent && hostEvent.id > 0 && hostEvent.id !== prevEventId) {
        showGlobalToast(hostEvent.text);
      }

      // Новий кидок кубика від ведучого — у всіх клієнтів (включно з ведучим і глядачами) локально запускається анімація.
      // Порівняння по id не дає повторно програти старий кидок при будь-якому іншому оновленні рядка кімнати.
      // Записи старого формату (без type/value, з d20+d6) ігноруємо.
      const diceRoll = localRoomState.bunker_state?.latest_dice;
      if (diceRoll && diceRoll.id > 0 && diceRoll.id !== prevDiceId && diceRoll.type) {
        showDiceRoll(diceRoll.type, diceRoll.value);
        // Запис про цей кидок у лозі ховаємо, поки кубик крутиться, і розкриваємо в момент зупинки
        pendingDiceLogId = diceRoll.id;
        clearTimeout(pendingDiceLogTimer);
        pendingDiceLogTimer = setTimeout(() => {
          pendingDiceLogId = null;
          const el = document.getElementById('game-board');
          if (el && localRoomState) updateGameBoard(localRoomState, el);
        }, DICE_ROLL_MS);
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
  document.removeEventListener("change", handleVoteRadioChange);
  document.addEventListener("change", handleVoteRadioChange);
}

let isUpdatingLock = false;

// Копіювання коду/посилання-запрошення з кімнати очікування (waiting-room.js). Відповідне вхідне поле шукається через
// data-copy-source, оскільки кімната очікування на екрані завжди одна — document.querySelector безпечний.
async function handleInviteCopy(btn) {
  const input = document.querySelector(`[data-copy-source="${btn.dataset.copyTarget}"]`);
  const text = input?.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Не вдалося скопіювати:', err);
    return;
  }

  const original = btn.textContent;
  btn.textContent = 'Скопійовано!';
  btn.disabled = true; // дизейблена кнопка не генерує click, тож повторний клік під час анімації не запустить другий таймер
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 2000);
}

let isKickInFlight = false;

// Клік по "Вигнати" / "Повернути" в таблиці гравців (лише ведучий бачить кнопку, але серверний RLS
// все одно захищає запис). Кнопка живе всередині .kicked-player, тому pointer-events на ній
// повернуто в CSS окремим правилом — інакше по ній не можна було б клікнути, щоб повернути гравця.
async function handleKickToggle(btn) {
  if (isKickInFlight) return;
  const playerId = btn.dataset.kickId;
  if (!playerId) return;

  isKickInFlight = true;
  btn.style.pointerEvents = 'none';
  try {
    await HostActions.toggleKickPlayer(currentRoomCode, playerId);
    // Подальший перемальовок прийде через Realtime-підписку (subscribeToRoomUpdates)
  } catch (err) {
    console.error('Не вдалося змінити статус гравця:', err);
    showGlobalToast(err.message || 'Не вдалося виконати дію');
  } finally {
    isKickInFlight = false;
    btn.style.pointerEvents = '';
  }
}

async function handleGlobalClick(e) {
  if (e.target.closest('[data-log-toggle]')) {
    toggleEventLog();
    return;
  }

  const copyBtn = e.target.closest('[data-copy-target]');
  if (copyBtn) {
    await handleInviteCopy(copyBtn);
    return;
  }

  const voteBtn = e.target.closest('[data-vote-submit]');
  if (voteBtn && !voteBtn.disabled) {
    await handleVoteSubmit(voteBtn);
    return;
  }

  const kickBtn = e.target.closest('[data-kick-id]');
  if (kickBtn) {
    await handleKickToggle(kickBtn);
    return;
  }

  if (isUpdatingLock) return;

  const lockBtn = e.target.closest(".char-lock");
  if (!lockBtn) return;

  const item = lockBtn.closest(".char-item");
  if (!item) return;

  const dbKey = item.dataset.dbkey;
  const idxStr = item.dataset.idx;
  if (!dbKey) return;

  const isOpen = item.classList.contains('open');
  const confirmMsg = isOpen 
    ? 'Приховати цю характеристику від інших?' 
    : 'Відкрити цю характеристику всім гравцям?';
  
  const confirmed = await showCustomConfirm(confirmMsg, lockBtn);
  if (!confirmed) return;

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

    // Запис у «Лог подій». Помилка логування не має ламати саме перемикання картки.
    const label = item.querySelector('.char-label')?.textContent?.trim() || dbKey;
    const who = state[currentUserId]?.name || currentUserName || 'Гравець';
    addLog(currentRoomCode, `Гравець ${who} ${isOpen ? 'сховав' : 'відкрив'} характеристику ${label}`)
      .catch(err => console.error('Не вдалося записати подію в лог:', err));
    
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
    canUndo: HostActions.canUndo(),
    timer: {
      end: roomData.bunker_state?.global_timer_end,
      pausedLeft: roomData.bunker_state?.timer_paused_left
    }
  };
}

// Панель живе поза #game-board, тож перемальовування дошки її не зачіпає.
// Показуємо лише ведучому і лише після старту гри (до роздачі карт дії не мають сенсу).
function syncHostPanel(roomData) {
  const isHost = isHostOf(roomData);
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  let root = getHostPanelRoot();

  if (!isHost || !isGameStarted) {
    if (root) removeHostPanel();
    return;
  }

  if (!root) {
    document.body.insertAdjacentHTML('beforeend', renderHostPanel({
      capacity: roomData.bunker_state.capacity,
      canUndo: HostActions.canUndo(),
      timer: {
        end: roomData.bunker_state.global_timer_end,
        pausedLeft: roomData.bunker_state.timer_paused_left
      }
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
  pauseTimer: {
    run: () => HostActions.pauseGlobalTimer(currentRoomCode),
    ok: (r) => r === 'paused' ? 'Таймер на паузі' : 'Таймер відновлено'
  },
  stopTimer: { run: () => HostActions.stopGlobalTimer(currentRoomCode), ok: 'Таймер зупинено' },
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
    run: f => f.bunkerField === 'items'
      ? HostActions.changeBunkerItems(currentRoomCode, f.itemAction, f.itemAction === 'remove' ? f.itemRemove : f.itemAddText)
      : HostActions.changeBunker(currentRoomCode, f.bunkerField, f.customValue),
    ok: (r, f) => Array.isArray(r)
      ? 'Предмети бункера оновлено'
      : (f?.customValue || '').trim() ? 'Параметр бункера змінено' : `Випадкове значення: ${r}`,
    after: (root, result) => {
      const el = root.querySelector('[data-field="customValue"]');
      if (el) el.value = '';
      // Після дії з предметами чистимо поле додавання і перебудовуємо список для видалення за свіжим масивом
      if (Array.isArray(result)) applyBunkerItemActionUI(root, result);
    }
  },

  // Одна дія на обидві кнопки: тип кубика ('d20' / 'd6') приходить з data-arg натиснутої кнопки
  dice: {
    run: (f, arg) => HostActions.rollDice(currentRoomCode, arg),
    ok: r => `${r.type}: ${r.value}`,
    after: (root, r) => setHostDiceResult(root, `${r.type}: ${r.value}`)
  },

  changeHost: {
    run: f => HostActions.changeHost(currentRoomCode, f.newHost),
    ok: 'Права ведучого передано'
  },
  undo:    { run: () => HostActions.undoLastAction(currentRoomCode), ok: 'Дію скасовано' },
  restart: {
    run: () => HostActions.restartGame(currentRoomCode),
    ok: 'Гру скинуто'
  },
  closeRoom: {
    run: () => HostActions.closeRoom(currentRoomCode, getCataclysmTimerText()), // час з екрана йде в bunker_state.stopped_timer разом із status: 'closed'
    ok: 'Кімнату закрито',
    after: () => { window.location.hash = '#/lobby'; }
  }
};

// ===== Глобальний перехоплювач підтвердження: єдина точка для всіх кнопок панелі, окрім таймера. =====

// Кнопки таймера (15/30/60, пауза, стоп) та швидкі дії без реального ризику (кубики, +/- місткість)
// діють миттєво, без підтвердження
const NO_CONFIRM_ACTIONS = new Set(['timer', 'pauseTimer', 'stopTimer', 'dice', 'capacity']);

// Текст підтвердження для конкретних дій; все, чого немає тут, отримує DEFAULT_CONFIRM_TEXT
const CONFIRM_TEXTS = {
  closeRoom: 'Точно закрити кімнату? Усіх гравців буде відключено, дію не можна скасувати.',
  restart:   'Почати гру заново? Усі картки буде скинуто, гравці повернуться до кімнати очікування.',
  changeHost:'Передати права ведучого обраному гравцю? Ви втратите доступ до цієї панелі.'
};
const DEFAULT_CONFIRM_TEXT = 'Виконати цю дію з характеристикою?';

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

  // Блокуємо кнопку ще до підтвердження, щоб швидкий повторний клік під час очікування відповіді не відкрив другий діалог
  btn.disabled = true;

  // Єдина точка підтвердження: всі кнопки, крім таймера, чекають на відповідь в кастомному вікні
  if (!NO_CONFIRM_ACTIONS.has(btn.dataset.action)) {
    const message = CONFIRM_TEXTS[btn.dataset.action] || DEFAULT_CONFIRM_TEXT;
    const confirmed = await showCustomConfirm(message, btn);
    if (!confirmed) {
      btn.disabled = false;
      return;
    }
  }

  const arg = btn.dataset.arg;
  try {
    const fields = readHostFields(btn);
    const result = await def.run(fields, arg);
    const msg = typeof def.ok === 'function' ? def.ok(result, fields, arg) : def.ok;
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

  // "Змінити параметр бункера": інтерфейс залежить від обраного параметра та дії (див. applyBunkerParamUI)
  root.addEventListener('change', (e) => {
    if (e.target.closest('#bunker-item-action')) applyBunkerItemActionUI(root);
    else if (e.target.closest('[data-field="bunkerField"]')) applyBunkerParamUI(root);
  });
}

const setShown = (el, shown) => { if (el) el.style.display = shown ? '' : 'none'; };

// Вибір параметра бункера: "items" ховає стандартне поле і відкриває керування предметами
// (дія за замовчуванням — "Додати"); будь-який інший параметр повертає стандартний вигляд.
function applyBunkerParamUI(root) {
  const isItems = root.querySelector('[data-field="bunkerField"]')?.value === 'items';
  setShown(root.querySelector('[data-field="customValue"]')?.closest('.hp-field'), !isItems);
  setShown(root.querySelector('#bunker-item-action'), isItems);
  if (isItems) {
    root.querySelector('#bunker-item-action').value = 'add';
    applyBunkerItemActionUI(root);
  } else {
    setShown(root.querySelector('#bunker-item-add-input'), false);
    setShown(root.querySelector('#bunker-item-remove-select'), false);
    const btn = root.querySelector('#bunker-submit-btn');
    if (btn) btn.textContent = 'Змінити';
  }
}

// Дія над предметами: "Додати" — текстове поле; "Видалити" — список («Видалити все» + поточні предмети).
// items можна передати явно (після збереження, коли localRoomState ще не оновився через Realtime).
function applyBunkerItemActionUI(root, items) {
  const action = root.querySelector('#bunker-item-action')?.value || 'add';
  const addInput = root.querySelector('#bunker-item-add-input');
  const removeSelect = root.querySelector('#bunker-item-remove-select');
  const btn = root.querySelector('#bunker-submit-btn');
  if (!addInput || !removeSelect) return;

  if (action === 'add') {
    addInput.value = '';
    setShown(addInput, true);
    setShown(removeSelect, false);
    if (btn) btn.textContent = 'Додати';
    return;
  }

  const current = Array.isArray(items) ? items
    : (Array.isArray(localRoomState?.bunker_state?.items) ? localRoomState.bunker_state.items : []);
  removeSelect.replaceChildren();
  const allOpt = new Option('Видалити все', 'all');
  removeSelect.add(allOpt);
  current.forEach(item => removeSelect.add(new Option(item, item))); // Option ставить текст без HTML-інтерпретації
  setShown(addInput, false);
  setShown(removeSelect, true);
  if (btn) btn.textContent = 'Видалити';
}

export function cleanupGame() {
  isSpectator = false;
  document.getElementById('spectator-badge')?.classList.add('is-hidden');
  removeHostPanel();
  unmountGameTimer();
  unmountCataclysmTimer();
  if (realtimeSubscription) {
    supabase.removeChannel(realtimeSubscription);
    realtimeSubscription = null;
  }
  document.removeEventListener("click", handleGlobalClick);
  document.removeEventListener("change", handleVoteRadioChange);
  wasVotingActive = false;
  votingFinishInFlight = false;
  clearTimeout(pendingDiceLogTimer);
  pendingDiceLogId = null;
}