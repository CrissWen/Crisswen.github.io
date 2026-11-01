import { pushLog, nextEventId } from '../game/log-writer.js';
import { CHAR_TYPE_MAP } from './constants.js';

// ===== Спільні допоміжні для всіх дій ведучого =====

export function resolveIds(pState, targetId) {
  return targetId === 'all' ? Object.keys(pState) : [targetId];
}

// ===== Глобальні сповіщення від ведучого (Toast для всіх гравців) =====
// Записується в bunker_state разом з іншими змінами в тій же UPDATE, щоб postgres_changes
// розіслав його всім гравцям разом із фактичною зміною. id — монотонний nextEventId(), щоб game.js
// гарантовано відрізнив нову подію від попередньої навіть у межах тієї ж мілісекунди (I5).
export function setHostEvent(bState, text) {
  const prevId = Number(bState?.latest_host_event?.id) || 0;
  const id = Math.max(nextEventId(), prevId + 1);
  bState.latest_host_event = { id, text };
  pushLog(bState, text); // те саме повідомлення йде і в «Лог подій» (bunker_state.logs) тим самим UPDATE
}

export function nameOf(pState, id) {
  return pState?.[id]?.name || 'Гравець';
}

export function labelOf(charType) {
  return CHAR_TYPE_MAP[charType]?.label || charType;
}

// Фраза про ціль дії для тексту події: «усім гравцям» / «гравцю Ім'я» (давальний, за замовчуванням)
// або «усіх гравців» / «гравця Ім'я» (родовий).
export function targetPhrase(pState, targetId, grammaticalCase = 'dative') {
  if (grammaticalCase === 'genitive') {
    return targetId === 'all' ? 'усіх гравців' : `гравця ${nameOf(pState, targetId)}`;
  }
  return targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
}
