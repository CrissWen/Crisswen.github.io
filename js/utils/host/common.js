import { pushLog } from '../event-log.js';
import { CHAR_TYPE_MAP } from './constants.js';

// ===== Спільні допоміжні для всіх дій ведучого =====

export function resolveIds(pState, targetId) {
  return targetId === 'all' ? Object.keys(pState) : [targetId];
}

// ===== Глобальні сповіщення від ведучого (Toast для всіх гравців) =====
// Записується в bunker_state разом з іншими змінами в тій же UPDATE, щоб postgres_changes
// розіслав його всім гравцям разом із фактичною зміною. id — Date.now(), щоб game.js міг відрізнити нову подію від вже показаної.
export function setHostEvent(bState, text) {
  bState.latest_host_event = { id: Date.now(), text };
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
