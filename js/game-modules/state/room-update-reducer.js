import { mergeRoomState } from '../../services/room-subscription.js';

// Чистий обчислювач ефектів при отриманні Realtime-оновлення рядка кімнати (виправляє I1).
// Відокремлює логіку переходів стану (вигнання з лобі, закриття, фінал, старт гри, тост ведучого, кидок кубика)
// від DOM-ефектів у game.js, що дозволяє тестувати всі переходи юніт-тестами без браузера.
export function computeRoomUpdateEffects(prevRoomState, patch, { currentUserId } = {}) {
  const prevEventId = prevRoomState?.bunker_state?.latest_host_event?.id || 0;
  const prevDiceId = prevRoomState?.bunker_state?.latest_dice?.id || 0;
  const prevStatus = prevRoomState?.status;
  const wasGameStarted = Object.keys(prevRoomState?.bunker_state || {}).length > 0;

  const nextState = mergeRoomState(prevRoomState, patch);
  const isGameStartedNow = Object.keys(nextState?.bunker_state || {}).length > 0;

  const shouldClearSnapshot = wasGameStarted !== isGameStartedNow;
  const kickedFromLobby = Boolean(
    !isGameStartedNow &&
    currentUserId &&
    nextState.host_id !== currentUserId &&
    !nextState.players_state?.[currentUserId]
  );

  const roomClosed = nextState.status === 'closed';
  const notifyHostClosed = Boolean(roomClosed && nextState.host_id !== currentUserId);

  const roomFinished = nextState.status === 'finished';
  const playFinishDoor = Boolean(roomFinished && prevStatus !== 'finished' && isGameStartedNow);
  const playStartDoor = Boolean(
    !wasGameStarted &&
    isGameStartedNow &&
    nextState.status !== 'closed' &&
    nextState.status !== 'finished'
  );

  const hostEvent = nextState.bunker_state?.latest_host_event;
  const hostEventText = hostEvent && hostEvent.id > 0 && hostEvent.id !== prevEventId
    ? hostEvent.text
    : null;

  const diceRoll = nextState.bunker_state?.latest_dice;
  const newDiceRoll = diceRoll && diceRoll.id > 0 && diceRoll.id !== prevDiceId && diceRoll.type
    ? diceRoll
    : null;

  return {
    nextState,
    isGameStartedNow,
    shouldClearSnapshot,
    kickedFromLobby,
    roomClosed,
    notifyHostClosed,
    roomFinished,
    playFinishDoor,
    playStartDoor,
    hostEventText,
    newDiceRoll
  };
}

