// ===== Фасад дій ведучого =====
// Уся логіка розділена по модулях у js/utils/host/. Цей файл лише збирає публічний API в одному місці,
// тому game.js (import * as HostActions) і host-panel.js (імпорт довідників) працюють без змін.
//
// Шари (залежності йдуть лише зверху вниз, циклів немає):
//   constants.js, random.js              — довідники та випадковість, без залежностей
//   room-store.js, card-pools.js         — БД: кімната + знімок для «Скасувати», пул карток пака
//   common.js, characteristics.js        — спільні допоміжні, генерація карток і «слоти»
//   actions-players / -steal / -bunker / -timer / -session.js — самі дії ведучого

// Довідники для host-panel.js
export {
  CHARACTERISTIC_TYPES,
  ARRAY_CHARACTERISTIC_TYPES,
  EXTRA_CHARACTERISTIC_TYPES,
  BUNKER_FIELDS,
  HEAL_PERFECT
} from './host/constants.js';

// «Скасувати» та дані для випадаючих списків панелі
export { canUndo, undoLastAction } from './host/room-store.js';
export { getStageOptions } from './host/card-pools.js';

// Дії ведучого
export * from './host/actions-players.js';
export * from './host/actions-steal.js';
export * from './host/actions-bunker.js';
export * from './host/actions-timer.js';
export * from './host/actions-session.js';
