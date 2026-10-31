import { ICONS } from '../constants/icons.js';
import { esc } from '../utils/security.js';
import { REPLAY_STORAGE_KEY } from '../services/replay-service.js';
import { supabase } from '../services/supabase.js';
import { cataclysm } from '../game-modules/board/cataclysm.js';
import { bunkerInfo } from '../game-modules/board/bunker-info.js';
import { playerCharacteristics } from '../game-modules/board/player-characteristics.js';
import { playersTable, hideGlobalTooltip } from '../game-modules/board/players-table.js';
import { specialAbilitiesTable } from '../game-modules/board/special-abilities-table.js';
import { votingSection, captureVoteSelection, restoreVoteSelection } from '../game-modules/board/voting.js';
import { waitingRoom } from '../game-modules/board/waiting-room.js';
import {
  toggleBlockCollapsed,
  setPlayersViewMode,
  togglePlayerCard,
  toggleAllPlayerCards,
  resetBoardUiState
} from '../game-modules/board/board-ui-state.js';
import { mountGameTimer, unmountGameTimer } from '../game-modules/timers/game-timer.js';
import { mountCataclysmTimer, unmountCataclysmTimer, syncCataclysmTimer, freezeCataclysmTimer } from '../game-modules/timers/cataclysm-timer.js';
import { getGameConfig, getGameConfigSync } from '../config/config-manager.js';
import * as HostActions from '../utils/host-actions.js';
import { removeHostPanel } from '../game-modules/host-panel/host-panel.js';
import { syncHostPanel } from '../game-modules/controllers/host-panel-controller.js';
import { syncVotingScroll, maybeAutoFinishVoting, handleVoteRadioChange, handleVoteSubmit, resetVotingState } from '../game-modules/controllers/voting-controller.js';
import { handleCharLockClick } from '../game-modules/controllers/char-lock.js';
import { ensurePackOptions, getPackOptions, handlePackChange, resetPackSelect } from '../game-modules/controllers/pack-select-controller.js';
import { trackCataclysmEnd, onCataclysmTimerExpired } from '../game-modules/controllers/cataclysm-end-modal.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { showDiceRoll, ROLL_MS as DICE_ROLL_MS } from '../game-modules/overlays/dice-overlay.js';
import { playCataclysmRoulette, hideCataclysmRoulette, isCataclysmRouletteShown, primeCataclysmRouletteAudio } from '../game-modules/overlays/cataclysm-roulette.js';
import { isCataclysmSpinActive, getSpinTimeline } from '../utils/cataclysm-spin.js';
import { showOrientationPrompt, hideOrientationPrompt } from '../game-modules/overlays/orientation-prompt.js';
import { eventLog, toggleEventLog, scrollEventLogToBottom } from '../game-modules/board/event-log.js';
import { personalNotes, captureNotesFocus, restoreNotesFocus } from '../game-modules/board/personal-notes.js';
import { buildBoardViewModel } from '../utils/board-view-model.js';
import { startGame } from '../utils/start-game.js';
import { initCustomSelects } from '../ui/custom-select.js';
import { subscribeToRoom, mergeRoomState } from '../services/room-subscription.js';
import { syncServerTime, getGlobalTime } from '../services/server-time.js';
import { setLastRoom, clearLastRoom } from '../utils/last-session.js';
import { fetchAvatars, hasCachedAvatar } from '../services/avatar-service.js';
import { openPlayerProfile, closePlayerProfile } from '../ui/player-profile-modal.js';
import { playBunkerDoorTransition, cancelBunkerDoorTransition } from '../fx/bunker-transition.js';
import { soundManager } from '../services/sound-manager.js';

// ===== Оркестратор сторінки гри =====
// Тут лишилися: ініціалізація кімнати, підписка на Realtime, перемальовування дошки і диспетчер кліків.
// Усе інше живе в контролерах (host-panel-controller, voting-controller, char-lock, cataclysm-end-modal),
// яким спільний стан передається через getter-и в ctx — тож циклічних імпортів немає.

let currentRoomCode = null;
let unsubscribeRoom = null; // відписка від Realtime-каналу кімнати (services/room-subscription.js)
let currentUserId = null;
let currentUserName = null;
let isSpectator = false; // глядач: гра вже йде, а гравця немає в players_state (виводиться в updateGameBoard на кожне оновлення)
let isOfflineReplay = false;
let localRoomState = null;
let pendingDiceLogId = null; // id запису в лозі про кидок, який прихований до зупинки кубика
let pendingDiceLogTimer = null;
let playedSpinId = null; // id спіну рулетки катаклізму, який цей клієнт уже показав (або пропустив як старий)
let spinRefreshTimer = null; // перемальовує дошку в момент, коли рулетка закінчилась і катаклізм уже можна показати
let renderSkippedForPackSelect = false; // оновлення кімнати очікування пропущено, бо ведучий тримає у фокусі список паків
let awaitingDoorSeal = false; // true, поки бронедвері старту гри ще зачиняються (дошку монтуємо в момент герметизації)

// Згортання верхньої навігаційної панелі під час гри (особливо важливо на телефонах)
let lastScrollY = 0;
let headerScrollListening = false;
let headerManuallyCollapsed = false;

const ctx = {
  getRoomCode: () => currentRoomCode,
  getUserId: () => currentUserId,
  getUserName: () => currentUserName,
  getRoomState: () => localRoomState,
  isSpectator: () => isSpectator,
  isOfflineReplay: () => isOfflineReplay,
  refreshBoard: () => {
    const boardEl = document.getElementById('game-board');
    if (boardEl && localRoomState) updateGameBoard(localRoomState, boardEl);
  }
};

function setHeaderCollapsed(collapsed) {
  document.body.classList.toggle('is-header-collapsed', collapsed);
  const tab = document.getElementById('header-collapse-tab');
  if (tab) {
    tab.setAttribute('aria-expanded', String(!collapsed));
    tab.title = collapsed ? 'Показати верхню панель' : 'Згорнути верхню панель';
    tab.innerHTML = collapsed ? '<span>Меню ▼</span>' : '<span>▲</span>';
  }
}

function handleGameScroll() {
  if (!document.body.classList.contains('is-in-game')) return;
  const isCompactViewport = window.innerWidth <= 900 || window.innerHeight <= 520;
  if (!isCompactViewport) return;

  const y = window.scrollY || 0;
  const delta = y - lastScrollY;
  lastScrollY = y;

  if (y > 48 && delta > 8) {
    setHeaderCollapsed(true);
  } else if (y <= 14 && !headerManuallyCollapsed) {
    setHeaderCollapsed(false);
  }
}

function mountHeaderCollapseTab() {
  document.body.classList.add('is-in-game');
  if (!document.getElementById('header-collapse-tab')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'header-collapse-tab';
    btn.className = 'header-collapse-tab';
    btn.dataset.headerCollapseToggle = 'true';
    btn.setAttribute('aria-expanded', 'true');
    btn.title = 'Згорнути верхню панель';
    btn.innerHTML = '<span>▲</span>';
    document.body.appendChild(btn);
  }
  if (!headerScrollListening) {
    lastScrollY = window.scrollY || 0;
    window.addEventListener('scroll', handleGameScroll, { passive: true });
    headerScrollListening = true;
  }
}

function unmountHeaderCollapseTab() {
  if (headerScrollListening) {
    window.removeEventListener('scroll', handleGameScroll);
    headerScrollListening = false;
  }
  headerManuallyCollapsed = false;
  document.body.classList.remove('is-in-game', 'is-header-collapsed');
  document.getElementById('header-collapse-tab')?.remove();
}

// Закрита кімната — режим лише для читання для будь-кого (навіть колишнього хоста/гравця): host_id ігнорується, панель ведучого не рендериться.
function isHostOf(roomData) {
  if (roomData.status === 'closed' || roomData.status === 'finished') return false; // на фіналі гри панель ведучого не потрібна
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


function mountOfflineReplayBanner(roomCode) {
  document.getElementById('offline-replay-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'offline-replay-banner';
  banner.className = 'offline-replay-banner';
  banner.innerHTML = `
    <div class="offline-replay-banner__content">
      <span class="offline-replay-banner__badge">РЕЗУЛЬТАТИ ЗБЕРЕЖЕНОЇ ГРИ</span>
      <span class="offline-replay-banner__text">Кімната <strong>[${esc(roomCode)}]</strong></span>
    </div>
    <button type="button" class="offline-replay-banner__exit" id="offline-replay-exit-btn">Повернутися в профіль</button>
  `;
  banner.querySelector('#offline-replay-exit-btn').addEventListener('click', () => {
    window.location.hash = '#/profile';
  });
  document.querySelector('.layout-large-centered')?.prepend(banner);
}

export async function initGame() {
  const statusEl = document.getElementById('game-status');
  const boardEl = document.getElementById('game-board');
  isOfflineReplay = window.location.hash.includes('mode=offline_replay');
  if (isOfflineReplay) {
    try {
      const raw = sessionStorage.getItem(REPLAY_STORAGE_KEY);
      if (!raw) throw new Error('Запис гри не знайдено або термін сесії вичерпано');
      const replayRoom = JSON.parse(raw);
      localRoomState = { ...replayRoom, status: 'closed' };
      currentRoomCode = (replayRoom.room_code || 'REPLAY').toUpperCase();
      currentUserId = 'offline-viewer';
      currentUserName = 'Глядач';
      isSpectator = true;

      await Promise.all([getGameConfig(), syncServerTime()]);
      await fetchAvatars(Object.keys(localRoomState.players_state || {}));

      updateGameBoard(localRoomState, boardEl);
      statusEl.style.display = 'none';
      boardEl.style.display = 'block';

      mountOfflineReplayBanner(currentRoomCode);
      setupActionListeners();

      mountGameTimer(() => localRoomState?.bunker_state);
      mountCataclysmTimer(onCataclysmTimerExpired);
      syncCataclysm(localRoomState.bunker_state, localRoomState.status);
      return;
    } catch (err) {
      statusEl.textContent = 'Помилка завантаження запису: ' + err.message;
      statusEl.style.color = 'var(--danger)';
      return;
    }
  }

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
    if (error || !room) {
      clearLastRoom(currentUserId); // кімнати більше немає — вкладка «Гра» має стати сірою
      throw new Error("Кімнату не знайдено");
    }

    localRoomState = room;

    const isGameStarted = Object.keys(room.bunker_state || {}).length > 0;
    const isPlayerInRoom = room.players_state && room.players_state[currentUserId];

    // Дочекуємось конфігу (base + можливий game-config.local.js) ДО першого рендеру кімнати. Інакше при прямому заході по посиланню
    // вейтінг-рум міг би побачити лише базові ліміти, поки локальний файл ще вантажиться (getGameConfigSync дає базу).
    const [bc] = await Promise.all([getGameConfig(), syncServerTime()]); // серверний час потрібен таймерам ще до першого рендеру (syncServerTime ніколи не кидає помилку)

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
          clearLastRoom(currentUserId);
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

    // Кімната успішно відкрита — запам'ятовуємо її для вкладки «Гра» в хедері
    if (room.status !== 'closed' && room.status !== 'finished') setLastRoom(currentUserId, currentRoomCode);
    else clearLastRoom(currentUserId); // закрита або завершена гра не є «активною»

    // Аватарки гравців кімнати — одним запитом ДО першого рендеру, щоб літери не підмінялися фото вже на екрані
    await fetchAvatars(Object.keys(room.players_state || {}));

    updateGameBoard(localRoomState, boardEl);
    statusEl.style.display = 'none';
    boardEl.style.display = 'block';

    // Гравець зайшов (зокрема кнопкою «Повернутися» з лобі) у кімнату, де гра вже йде — пропонуємо повернути телефон горизонтально або продовжити вертикально
    if (isGameStarted && room.status !== 'closed' && room.status !== 'finished') showOrientationPrompt();

    subscribeToRoomUpdates();
    maybePlayCataclysmRoulette(localRoomState); // зайшли посеред рулетки (перезавантаження сторінки) — вона продовжується з потрібного місця
    setupActionListeners();
    mountGameTimer(() => localRoomState?.bunker_state);
    mountCataclysmTimer(onCataclysmTimerExpired);
    syncCataclysm(localRoomState.bunker_state, localRoomState.status);

  } catch (err) {
    statusEl.textContent = "Помилка: " + err.message;
    statusEl.style.color = 'var(--danger)';
  }
}

// Хтось новий зайшов у кімнату — докачуємо його аватарку (раз на гравця) і перемальовуємо дошку, коли вона з'явиться.
// Невдалий запит нічого не кешує і не дає перемальовування, тож зациклитись це не може.
function prefetchAvatars(roomData) {
  const ids = Object.keys(roomData.players_state || {});
  if (!ids.length || ids.every(hasCachedAvatar)) return;
  fetchAvatars(ids).then(loaded => {
    if (loaded > 0) ctx.refreshBoard();
  });
}

function updateGameBoard(roomData, container) {
  prefetchAvatars(roomData);
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  const isHost = isHostOf(roomData);
  // Закрита кімната — кожен, навіть колишній гравець/ведучий, примусово глядач (режим лише для читання)
  isSpectator = roomData.status === 'closed' || (isGameStarted && !roomData.players_state?.[currentUserId]);
  const specBadge = document.getElementById('spectator-badge');
  if (specBadge) {
    specBadge.classList.toggle('is-hidden', !isSpectator);
    if (isSpectator) {
      const specIcon = specBadge.querySelector('.spectator-badge__icon');
      if (specIcon && specIcon.getAttribute('src') !== ICONS.EYE) {
        specIcon.src = ICONS.EYE;
      }
    }
  }
  syncHostPanel(roomData, isHost, ctx);
  syncCataclysm(roomData.bunker_state, roomData.status);

  if (!isGameStarted) {
    soundManager.stopAmbient(); // кімната очікування (або гру скинуто): атмосфери бункера тут немає
    unmountHeaderCollapseTab();
    // Ведучий саме обирає пак у розкритому списку: не перемальовуємо кімнату, щоб список не закрився посеред вибору.
    // Стан кімнати вже оновлено, а перемалювання відбудеться, щойно список втратить фокус (handleGlobalFocusOut).
    const isPackSelectOpen = document.querySelector('#wr-pack-select')?.closest('.pe-select-custom')?.querySelector('.pe-select-custom__btn.is-open') || document.activeElement?.id === 'wr-pack-select';
    if (isHost && isPackSelectOpen) {
      renderSkippedForPackSelect = true;
      return;
    }

    // Із цього моменту конфіг вже завантажено (див. await getGameConfig() у initGame), тому синхронного читання досить
    const bc = getGameConfigSync();
    if (isHost) ensurePackOptions(ctx); // список паків ведучого вантажиться один раз і перемалює кімнату, коли буде готовий
    container.innerHTML = waitingRoom({
      roomCode: currentRoomCode,
      playersState: roomData.players_state,
      isHost: isHost,
      minPlayers: bc.minPlayersToStart,
      maxPlayers: bc.maxPlayersInLobby,
      selectedPackId: roomData.selected_pack_id,
      selectedPackTitle: roomData.selected_pack_title,
      packOptions: isHost ? getPackOptions() : null,
      myId: currentUserId,
      _needsInit: Boolean(setTimeout(() => initCustomSelects(container), 0))
    });
    initCustomSelects(container);


    if (isHost) {
      document.getElementById('start-game-btn')?.addEventListener('click', handleStartGame);
    }
  } else {
    // Атмосфера бункера грає все время, поки гра йде. Дошка монтується в момент герметизації дверей, тож звук стартує разом з ним.
    // Виклик ідемпотентний, тому не дублюється при кожному оновленні кімнати. Закрита кімната (включно з записом збереженої гри) без атмосфери.
    if (roomData.status === 'closed' || roomData.status === 'finished') soundManager.stopAmbient();
    else soundManager.startAmbient();
    mountHeaderCollapseTab();
    renderActiveGame(roomData, container);
  }
}

async function handleStartGame(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Генерація...";
  primeCataclysmRouletteAudio();

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
  const isFinal = roomData.status === 'finished' || isOfflineReplay;
  const vm = buildBoardViewModel(roomData, currentUserId, { reveal: isFinal });
  // Поки крутиться рулетка катаклізму, результат на дошці й у лозі прихований: інакше він видав би себе ще до зупинки стрічки.
  // Перемальовування в момент розблокування запускає spinRefreshTimer (maybePlayCataclysmRoulette).
  const spinActive = isCataclysmSpinActive(bState, getGlobalTime());

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
    safe('Катаклізм', () => cataclysm(spinActive ? null : vm.cataclysmData)),
    safe('Бункер', () => bunkerInfo(vm.bunkerData)),
    isSpectator ? '' : safe('Мої характеристики', () => playerCharacteristics({ ownerName: vm.myData.name, characteristics: vm.myData.characteristics, abilities: vm.myData.abilities })),
    safe('Гравці', () => playersTable(vm.columns.length ? vm.columns : ["Очікування роздачі..."], vm.tableRows, vm.alivePlayers, vm.totalPlayers, isHost, bState.stage_scales, { final: isFinal })),
    safe('Спец. можливості', () => specialAbilitiesTable(vm.parsedAbilities, { final: isFinal })), // isKicked уже в кожному елементі
    safe('Голосування', () => votingSection({
      voting: bState.voting,
      players: vm.votingPlayers,
      myId: currentUserId,
      _needsInit: Boolean(setTimeout(() => initCustomSelects(container), 0)),
      amAlive: !isFinal && !isSpectator && pState[currentUserId]?.is_alive !== false && !pState[currentUserId]?.is_kicked
    })),
    // Особисті замітки (тимчасові, лише в пам'яті вкладки) — між голосуванням і логом подій
    safe('Особисті замітки', () => personalNotes()),
    // Лог подій — самий низ сторінки, одразу після блоку голосування
    safe('Лог подій', () => eventLog(bState.logs, [pendingDiceLogId, spinActive ? bState.cataclysm_spin?.id : null].filter(Boolean)))
  ];

  captureVoteSelection(); // запам'ятовуємо обрану радіокнопку голосування, бо innerHTML нижче створить її заново без checked
  captureNotesFocus(); // запам'ятовуємо курсор у замітках, бо innerHTML нижче створить textarea заново
  // Фінал завершеної гри: та ж дошка, що й у грі, лише в таблицях видно відкрите й закрите (замок), і вбудований режим тільки для читання
  // (панелі ведучого немає, голосувати не можна). Кнопка «На головну» — під дошкою.
  container.classList.toggle('final-screen', isFinal);
  container.innerHTML = order.join("") + ((isFinal && !isOfflineReplay)
    ? '<div class="final-actions"><button type="button" class="hp-btn hp-btn-red final-home-btn" data-final-home>На головну</button></div>'
    : '');
  if (!isOfflineReplay) {
    container.querySelector('[data-final-home]')?.addEventListener('click', () => {
      clearLastRoom(currentUserId);
      window.location.hash = '#/lobby';
    });
  }
  restoreVoteSelection(); // повертаємо виділення і розблоковуємо «Проголосувати»
  restoreNotesFocus();
  scrollEventLogToBottom(); // автоскрол логу до найсвіжішої події після кожного перемалювання

  syncVotingScroll(pState, bState, ctx); // автоскрол до голосування рівно один раз на його запуск
  maybeAutoFinishVoting(roomData, ctx); // лише клієнт ведучого фіксує фінал голосування
}

// Рулетка катаклізму (bunker_state.cataclysm_spin, див. utils/cataclysm-spin.js). Новий спін (інший id) програється на клієнті один раз;
// хто зайшов посеред кручення, бачить його з потрібного місця, а після кінця — одразу катаклізм (старий спін не показуємо).
function maybePlayCataclysmRoulette(roomData) {
  const spin = roomData.bunker_state?.cataclysm_spin;
  // Закрита або завершена гра: рулетка не запускається (ні при вході, ні при подальших оновленнях кімнати на фіналі)
  if (!spin || roomData.status === 'closed' || roomData.status === 'finished' || spin.id === playedSpinId) return;
  playedSpinId = spin.id;

  const now = getGlobalTime();
  const timeline = getSpinTimeline(spin, now);
  if (!timeline || now >= timeline.unlockAt) return;

  // Дошка перемальовується в момент розблокування, навіть якщо оверлей не показався (помилка, вкладка у фоні)
  clearTimeout(spinRefreshTimer);
  spinRefreshTimer = setTimeout(() => ctx.refreshBoard(), timeline.unlockAt - now + 60);

  playCataclysmRoulette(spin, {
    onFinish: () => {
      ctx.refreshBoard();
      showOrientationPrompt();
    }
  }).catch(err => {
    console.error('Рулетка катаклізму:', err);
    hideCataclysmRoulette(); // збій не повинен лишати інтерфейс заблокованим
  });
}

function subscribeToRoomUpdates() {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = subscribeToRoom(currentRoomCode, handleRoomUpdate);
}

// Реакції на оновлення рядка кімнати. patch — payload.new з Realtime (може бути неповним, див. mergeRoomState).
function handleRoomUpdate(patch) {
  // Фіксуємо id попередньої події ДО злиття стану — щоб відрізнити справжню нову подію від тієї, що вже показана.
  const prevEventId = localRoomState?.bunker_state?.latest_host_event?.id || 0;
  const prevDiceId = localRoomState?.bunker_state?.latest_dice?.id || 0;
  const prevStatus = localRoomState?.status;
  const wasGameStarted = Object.keys(localRoomState?.bunker_state || {}).length > 0;

  localRoomState = mergeRoomState(localRoomState, patch);

  // Якщо гра ще не почалася, і нас видалили з players_state, значить нас вигнали з лобі
  const isGameStartedNow = Object.keys(localRoomState.bunker_state || {}).length > 0;
  // Старт або скидання гри (з цієї чи іншої вкладки) закриває історію дій: знімок «Скасувати» з минулої гри не має переходити в нову
  if (wasGameStarted !== isGameStartedNow) HostActions.clearSnapshot();
  if (!isGameStartedNow && localRoomState.host_id !== currentUserId && !localRoomState.players_state?.[currentUserId]) {
    showGlobalToast('Вас вигнали з кімнати.');
    clearLastRoom(currentUserId);
    window.location.hash = '#/lobby';
    return;
  }

  // Ведучий закрив кімнату (host-actions.js closeRoom пише лише status, bunker_state залишається як історія) — повертаємо всіх у лобі
  if (localRoomState.status === 'closed') {
    freezeCataclysmTimer(); // зупиняємо відлік рівно на цій секунді; текст таймера лишається як є
    hideCataclysmRoulette(); // рулетка не повинна блокувати вихід із закритої кімнати
    // Закриття кімнати — без анімації дверей: якщо вона вже грає (старт або фінал), прибираємо її, щоб оверлей не перейшов у лобі
    awaitingDoorSeal = false;
    cancelBunkerDoorTransition();
    if (localRoomState.host_id !== currentUserId) showGlobalToast('Ведучий закрив кімнату.');
    clearLastRoom(currentUserId);
    window.location.hash = '#/lobby';
    return;
  }

  // Ведучий завершив гру (finishGame в host-actions.js): гравців не перекидаємо. Завершена гра більше не «активна» для вкладки «Гра».
  // Анімація дверей грається лише в клієнтів, які були в кімнаті в момент переходу в finished (prevStatus !== 'finished');
  // хто зайшов або оновив сторінку пізніше, потрапляє в initGame й одразу бачить фінал без анімації.
  // Дошка монтується в момент герметизації (onSealed), як і на старті гри.
  if (localRoomState.status === 'finished') {
    hideCataclysmRoulette();
    clearLastRoom(currentUserId);
    if (prevStatus !== 'finished' && isGameStartedNow) {
      awaitingDoorSeal = true;
      playBunkerDoorTransition({
        mode: 'finish',
        roomCode: currentRoomCode || localRoomState?.room_code,
        onSealed: () => {
          awaitingDoorSeal = false;
          ctx.refreshBoard();
        }
      });
      return;
    }
  }

  // Гра щойно почалася (характеристики роздано) — пропонуємо повернути телефон горизонтально або продовжити вертикально
  if (!wasGameStarted && isGameStartedNow) {
    awaitingDoorSeal = true;
    playBunkerDoorTransition({
      roomCode: currentRoomCode || localRoomState?.room_code,
      onSealed: () => {
        awaitingDoorSeal = false;
        ctx.refreshBoard();
        maybePlayCataclysmRoulette(localRoomState);
      },
      onComplete: () => {
        if (!isCataclysmRouletteShown() && !isCataclysmSpinActive(localRoomState?.bunker_state, getGlobalTime())) {
          showOrientationPrompt();
        }
      },
    });
    return;
  }

  // Нова подія від ведучого (крадіжка, зміна характеристики тощо) — показуємо всім гравцям тост по-центру екрана.
  const hostEvent = localRoomState.bunker_state?.latest_host_event;
  if (hostEvent && hostEvent.id > 0 && hostEvent.id !== prevEventId) {
    showGlobalToast(hostEvent.text);
  }

  // Рулетка катаклізму: новий спін програється в усіх клієнтів за серверним часом; порожній стан (гру скинуто) прибирає оверлей
  if (isGameStartedNow) {
    maybePlayCataclysmRoulette(localRoomState);
  } else {
    hideCataclysmRoulette();
    playedSpinId = null;
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
      if (!awaitingDoorSeal) ctx.refreshBoard();
    }, DICE_ROLL_MS);
  }

  if (!awaitingDoorSeal) ctx.refreshBoard();
}

function setupActionListeners() {
  document.removeEventListener("click", handleGlobalClick);
  document.addEventListener("click", handleGlobalClick);
  document.removeEventListener("change", handleGlobalChange);
  document.addEventListener("change", handleGlobalChange);
  document.removeEventListener("focusout", handleGlobalFocusOut);
  document.addEventListener("focusout", handleGlobalFocusOut);
  document.removeEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("keydown", handleGlobalKeydown);
}

// Відкриття профілю гравця з клавіатури: Enter / Пробіл на аватарці у фокусі (аватарки з tabindex робить profileTriggerAttrs)
function handleGlobalKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const trigger = e.target.closest?.('[data-profile-user][tabindex]');
  if (!trigger) return;
  e.preventDefault(); // Пробіл не має прокручувати сторінку
  openPlayerProfile({ userId: trigger.dataset.profileUser, name: trigger.dataset.profileName, opener: trigger });
}

// Диспетчер змін у полях: вибір пака в кімнаті очікування або радіо-плитка голосування
function handleGlobalChange(e) {
  if (e.target.id === 'wr-pack-select') {
    handlePackChange(e.target, ctx);
    return;
  }
  handleVoteRadioChange(e);
}

// Список паків втратив фокус (вибрали або закрили без зміни) — доганяємо перемальовування, але ЛИШЕ якщо воно було пропущено.
// Безумовний refresh тут міг би підмінити кнопку «Почати гру» між натисканням і відпусканням миші, і клік пропав би.
function handleGlobalFocusOut(e) {
  if (e.target.id !== 'wr-pack-select' || !renderSkippedForPackSelect) return;
  renderSkippedForPackSelect = false;
  if (!awaitingDoorSeal) ctx.refreshBoard();
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
  if (e.target.closest('[data-header-collapse-toggle]')) {
    const nextCollapsed = !document.body.classList.contains('is-header-collapsed');
    headerManuallyCollapsed = nextCollapsed;
    setHeaderCollapsed(nextCollapsed);
    return;
  }

  // Клік по аватарці будь-якого гравця (навіть своєї) — коротке вікно профілю. Перевірка стоїть до акордеону карток:
  // аватарка у мобільній картці живе всередині кнопки розгортання, і без цього клік розгорнув би картку.
  const profileTrigger = e.target.closest('[data-profile-user]');
  if (profileTrigger) {
    openPlayerProfile({
      userId: profileTrigger.dataset.profileUser,
      name: profileTrigger.dataset.profileName,
      opener: profileTrigger
    });

    return;
  }

  const blockToggle = e.target.closest('[data-block-toggle]');
  if (blockToggle) {
    if (window.innerWidth <= 920 || window.innerHeight <= 520) {
      toggleBlockCollapsed(blockToggle.dataset.blockToggle);
    }
    return;
  }

  const viewBtn = e.target.closest('[data-players-view]');
  if (viewBtn) {
    setPlayersViewMode(viewBtn.dataset.playersView);
    return;
  }

  if (e.target.closest('[data-players-expand-all]')) {
    toggleAllPlayerCards();
    return;
  }

  const kickBtn = e.target.closest('[data-kick-id]');
  if (kickBtn) {
    await handleKickToggle(kickBtn);
    return;
  }

  const cardToggle = e.target.closest('[data-player-card-toggle]');
  if (cardToggle && !e.target.closest('.info-icon')) {
    togglePlayerCard(cardToggle.dataset.playerCardToggle, cardToggle.closest('.player-acc-card'));
    return;
  }

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
  // Після завершення гри характеристики лише для читання: відкривати/ховати їх більше не можна
  if (lockBtn && localRoomState?.status !== 'finished' && !isOfflineReplay) await handleCharLockClick(lockBtn, ctx);
}

export function cleanupGame() {
  isSpectator = false;
  isOfflineReplay = false;
  hideOrientationPrompt();
  hideGlobalTooltip();
  unmountHeaderCollapseTab();
  resetBoardUiState();
  document.getElementById('spectator-badge')?.classList.add('is-hidden');
  document.getElementById('offline-replay-banner')?.remove();
  removeHostPanel();
  HostActions.clearSnapshot(); // знімок «Скасувати» живе в пам'яті модуля: без цього після виходу й повернення в ту саму кімнату він би лишився
  unmountGameTimer();
  unmountCataclysmTimer();
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
  document.removeEventListener("click", handleGlobalClick);
  document.removeEventListener("change", handleGlobalChange);
  document.removeEventListener("focusout", handleGlobalFocusOut);
  document.removeEventListener("keydown", handleGlobalKeydown);
  closePlayerProfile({ immediate: true });
  resetVotingState();
  resetPackSelect();
  hideCataclysmRoulette();
  clearTimeout(spinRefreshTimer);
  playedSpinId = null;
  renderSkippedForPackSelect = false;
  clearTimeout(pendingDiceLogTimer);
  pendingDiceLogId = null;
  awaitingDoorSeal = false;
  cancelBunkerDoorTransition();
  soundManager.stopAmbient(); // вийшли з кімнати — атмосфера зупиняється
}
