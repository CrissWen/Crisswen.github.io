import { supabase } from '../services/supabase.js';
import { cataclysm } from '../game-modules/board/cataclysm.js';
import { bunkerInfo } from '../game-modules/board/bunker-info.js';
import { playerCharacteristics } from '../game-modules/board/player-characteristics.js';
import { playersTable } from '../game-modules/board/players-table.js';
import { specialAbilitiesTable } from '../game-modules/board/special-abilities-table.js';
import { votingSection, captureVoteSelection, restoreVoteSelection } from '../game-modules/board/voting.js';
import { waitingRoom } from '../game-modules/board/waiting-room.js';
import { mountGameTimer, unmountGameTimer } from '../game-modules/timers/game-timer.js';
import { mountCataclysmTimer, unmountCataclysmTimer, syncCataclysmTimer, freezeCataclysmTimer } from '../game-modules/timers/cataclysm-timer.js';
import { getGameConfig, getGameConfigSync } from '../config/config-manager.js';
import * as HostActions from '../utils/host-actions.js';
import { removeHostPanel } from '../game-modules/host-panel/host-panel.js';
import { syncHostPanel } from '../game-modules/controllers/host-panel-controller.js';
import { syncVotingScroll, maybeAutoFinishVoting, handleVoteRadioChange, handleVoteSubmit, resetVotingState } from '../game-modules/controllers/voting-controller.js';
import { handleCharLockClick } from '../game-modules/controllers/char-lock.js';
import { trackCataclysmEnd, onCataclysmTimerExpired } from '../game-modules/controllers/cataclysm-end-modal.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { showDiceRoll, ROLL_MS as DICE_ROLL_MS } from '../game-modules/overlays/dice-overlay.js';
import { eventLog, toggleEventLog, scrollEventLogToBottom } from '../game-modules/board/event-log.js';
import { personalNotes, captureNotesFocus, restoreNotesFocus } from '../game-modules/board/personal-notes.js';
import { buildBoardViewModel } from '../utils/board-view-model.js';
import { startGame } from '../utils/start-game.js';

// ===== Оркестратор сторінки гри =====
// Тут лишилися: ініціалізація кімнати, підписка на Realtime, перемальовування дошки і диспетчер кліків.
// Усе інше живе в контролерах (host-panel-controller, voting-controller, char-lock, cataclysm-end-modal),
// яким спільний стан передається через getter-и в ctx — тож циклічних імпортів немає.

let currentRoomCode = null;
let realtimeSubscription = null;
let currentUserId = null;
let currentUserName = null;
let isSpectator = false; // глядач: гра вже йде, а гравця немає в players_state (виводиться в updateGameBoard на кожне оновлення)
let localRoomState = null;
let pendingDiceLogId = null; // id запису в лозі про кидок, який прихований до зупинки кубика
let pendingDiceLogTimer = null;

const ctx = {
  getRoomCode: () => currentRoomCode,
  getUserId: () => currentUserId,
  getUserName: () => currentUserName,
  getRoomState: () => localRoomState,
  isSpectator: () => isSpectator,
  refreshBoard: () => {
    const boardEl = document.getElementById('game-board');
    if (boardEl && localRoomState) updateGameBoard(localRoomState, boardEl);
  }
};

// Закрита кімната — режим лише для читання для будь-кого (навіть колишнього хоста/гравця): host_id ігнорується, панель ведучого не рендериться.
function isHostOf(roomData) {
  if (roomData.status === 'closed') return false;
  return roomData.host_id === currentUserId;
}

// Синхронізує віджет-таймер катаклізму і скидає флаг модалки "Час сплив" при новому катаклізмі
function syncCataclysm(bunkerState, roomStatus) {
  trackCataclysmEnd(bunkerState?.cataclysm_timer_end);
  syncCataclysmTimer(bunkerState, roomStatus);
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

    // Дочекуємось конфігу (base + можливий game-config.local.js) ДО першого рендеру кімнати. Інакше при прямому заході по посиланню
    // вейтінг-рум міг би побачити лише базові ліміти, поки локальний файл ще вантажиться (getGameConfigSync дає базу).
    const bc = await getGameConfig();

    // Гра вже йде, а гравця в кімнаті немає — не відкидаємо, а пускаємо як глядача (isSpectator виставляє updateGameBoard).
    // Ліміт на місця (bc.maxPlayersInLobby, config-manager.js) діє виключно на етапі лобі: якщо гра вже йде, цю перевірку ігноруємо.
    if (!isGameStarted && !isPlayerInRoom) {
      // Свіжий players_state читаємо прямо перед записом (а не беремо з першого запиту): так вікно, в якому двоє
      // одночасно заходять і затирають один одного, скорочується до самого UPDATE. Повністю гонку закриє лише атомарний запис на сервері.
      const { data: fresh, error: freshError } = await supabase
        .from('rooms').select('players_state').eq('room_code', currentRoomCode).single();
      if (freshError || !fresh) throw new Error(freshError?.message || "Кімнату не знайдено");

      const currentPlayers = fresh.players_state || {};
      if (!currentPlayers[currentUserId]) {
        if (Object.keys(currentPlayers).length >= bc.maxPlayersInLobby) {
          showGlobalToast('Ця кімната вже переповнена');
          window.location.hash = '#/lobby';
          return;
        }

        const updatedPlayersState = { ...currentPlayers, [currentUserId]: { name: currentUserName } };
        const { error: joinError } = await supabase
          .from('rooms').update({ players_state: updatedPlayersState }).eq('room_code', currentRoomCode);
        if (joinError) throw new Error(joinError.message);
        room.players_state = updatedPlayersState;
      } else {
        room.players_state = currentPlayers;
      }
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
  syncHostPanel(roomData, isHost, ctx);
  syncCataclysm(roomData.bunker_state, roomData.status);

  if (!isGameStarted) {
    // Із цього моменту конфіг вже завантажено (див. await getGameConfig() у initGame), тому синхронного читання досить
    const bc = getGameConfigSync();
    container.innerHTML = waitingRoom({
      roomCode: currentRoomCode,
      playersState: roomData.players_state,
      isHost: isHost,
      minPlayers: bc.minPlayersToStart,
      maxPlayers: bc.maxPlayersInLobby,
      myId: currentUserId
    });

    if (isHost) {
      document.getElementById('start-game-btn')?.addEventListener('click', handleStartGame);
    }
  } else {
    renderActiveGame(roomData, container);
  }
}

async function handleStartGame(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Генерація...";

  try {
    await startGame(currentRoomCode);
    // Перемальовування дошки прийде через Realtime-підписку
  } catch (err) {
    console.error("Помилка старту:", err);
    showGlobalToast(err.message || 'Не вдалося почати гру');
    btn.disabled = false;
    btn.textContent = "Почати гру";
  }
}

function renderActiveGame(roomData, container) {
  const bState = roomData.bunker_state || {};
  const pState = roomData.players_state || {};
  const isHost = isHostOf(roomData);
  const vm = buildBoardViewModel(roomData, currentUserId);

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
    safe('Катаклізм', () => cataclysm(vm.cataclysmData)),
    safe('Бункер', () => bunkerInfo(vm.bunkerData)),
    isSpectator ? '' : safe('Мої характеристики', () => playerCharacteristics({ ownerName: vm.myData.name, characteristics: vm.myData.characteristics, abilities: vm.myData.abilities })),
    safe('Гравці', () => playersTable(vm.columns.length ? vm.columns : ["Очікування роздачі..."], vm.tableRows, vm.alivePlayers, vm.totalPlayers, isHost)),
    safe('Спец. можливості', () => specialAbilitiesTable(vm.parsedAbilities)), // isKicked уже в кожному елементі
    safe('Голосування', () => votingSection({
      voting: bState.voting,
      players: vm.votingPlayers,
      myId: currentUserId,
      amAlive: !isSpectator && pState[currentUserId]?.is_alive !== false && !pState[currentUserId]?.is_kicked
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

  syncVotingScroll(pState, bState, ctx); // автоскрол до голосування рівно один раз на його запуск
  maybeAutoFinishVoting(roomData, ctx); // лише клієнт ведучого фіксує фінал голосування
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

      // Якщо гра ще не почалася, і нас видалили з players_state, значить нас вигнали з лобі
      const isGameStartedNow = Object.keys(localRoomState.bunker_state || {}).length > 0;
      if (!isGameStartedNow && localRoomState.host_id !== currentUserId && !localRoomState.players_state?.[currentUserId]) {
        alert('Вас вигнали з кімнати.');
        window.location.hash = '#/lobby';
        return;
      }

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
          ctx.refreshBoard();
        }, DICE_ROLL_MS);
      }

      ctx.refreshBoard();
    }).subscribe();
}

function setupActionListeners() {
  document.removeEventListener("click", handleGlobalClick);
  document.addEventListener("click", handleGlobalClick);
  document.removeEventListener("change", handleVoteRadioChange);
  document.addEventListener("change", handleVoteRadioChange);
}

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

// Диспетчер кліків: лише визначає, кому належить клік, і віддає контролеру
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
    await handleVoteSubmit(voteBtn, ctx);
    return;
  }

  const kickBtn = e.target.closest('[data-kick-id]');
  if (kickBtn) {
    await handleKickToggle(kickBtn);
    return;
  }

  const lobbyKickBtn = e.target.closest('[data-lobby-kick]');
  if (lobbyKickBtn) {
    if (isKickInFlight) return;
    isKickInFlight = true;
    lobbyKickBtn.style.pointerEvents = 'none';
    try {
      await HostActions.kickPlayerFromLobby(currentRoomCode, lobbyKickBtn.dataset.lobbyKick);
    } catch (err) {
      console.error('Не вдалося вигнати гравця з лобі:', err);
      showGlobalToast(err.message || 'Не вдалося виконати дію');
    } finally {
      isKickInFlight = false;
      lobbyKickBtn.style.pointerEvents = '';
    }
    return;
  }

  const lockBtn = e.target.closest('.char-lock');
  if (lockBtn) await handleCharLockClick(lockBtn, ctx);
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
  resetVotingState();
  clearTimeout(pendingDiceLogTimer);
  pendingDiceLogId = null;
}
