import { BUNKER_FIELDS } from './constants.js';
import { pickCard } from '../random.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { loadPools } from './card-pools.js';
import { setHostEvent } from './common.js';
import { randomBunkerFieldValue } from '../game-generator.js';
import { getGlobalTime } from '../../services/server-time.js';

// ===== Дії з бункером =====

// Розбирає текст "предмет1, предмет2" у масив чистих рядків: прибирає зайві пробіли
// та порожні елементи (напр. дві коми підряд) і дублікати (порівняння без урахування регістру).
function parseItemsText(text) {
  const seen = new Set();
  return String(text || '')
    .split(',')
    .map(item => item.trim())
    .filter(item => {
      if (!item.length) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Порожнє поле = випадкове значення з пулу pack_cards (randomBunkerFieldValue в game-generator.js), а не помилка і не порожній запис.
// Повертає збережений текст (власний або згенерований), щоб UI міг його показати.
export async function changeBunker(roomCode, field, customValue) {
  if (!field) throw new Error('Оберіть параметр бункера');
  // "items" — масив, він керується окремою функцією changeBunkerItems (додати/видалити)
  if (field === 'items') throw new Error('Предмети змінюються через дії «Додати» / «Видалити»');
  let value = (customValue || '').trim();
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};
  if (!value) {
    const pools = await loadPools(room.selected_pack_id);
    value = await randomBunkerFieldValue(field, pools.bunker, bState);
    if (!value) throw new Error('Для цього параметра немає варіантів у пулі карток — введіть значення вручну');
  }
  snapshot(room); // після всіх перевірок, щоб невдала спроба не затирала попередній знімок для "Скасувати"
  bState[field] = value;
  const fieldLabel = BUNKER_FIELDS.find(f => f.key === field)?.label || field;
  setHostEvent(bState, `Ведучий змінив параметр бункера «${fieldLabel}»`);
  await saveRoom(roomCode, { bunker_state: bState });
  return value;
}

// Керування предметами бункера (bunker_state.items).
//   action 'add'    — value: текст "а, б, в"; додає лише нові предмети (дублікати без урахування регістру пропускаються)
//   action 'remove' — value: 'all' (очистити все) або точна назва предмета
// Повертає оновлений масив предметів (UI перебудовує за ним список для видалення, не чекаючи Realtime).
export async function changeBunkerItems(roomCode, action, value) {
  if (action !== 'add' && action !== 'remove') throw new Error('Оберіть дію: додати або видалити');

  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};
  const current = Array.isArray(bState.items) ? bState.items : [];
  let next;
  let eventText;

  if (action === 'add') {
    const parsed = parseItemsText(value);
    if (parsed.length === 0) throw new Error('Введіть хоча б один предмет');
    const existing = new Set(current.map(i => String(i).toLowerCase()));
    const fresh = parsed.filter(i => !existing.has(i.toLowerCase()));
    if (fresh.length === 0) throw new Error('Ці предмети вже є в бункері');
    next = [...current, ...fresh];
    eventText = `Ведучий додав предмети в бункер: ${fresh.join(', ')}`;
  } else if (value === 'all') {
    if (current.length === 0) throw new Error('У бункері вже немає предметів');
    next = [];
    eventText = 'Ведучий видалив усі предмети з бункера';
  } else {
    if (!current.includes(value)) throw new Error('Такого предмета вже немає в бункері');
    next = current.filter(item => item !== value);
    eventText = `Ведучий видалив предмет з бункера: ${value}`;
  }

  snapshot(room); // бекап для "Скасувати" — після всіх перевірок, щоб невдала спроба не затирала попередній знімок
  bState.items = next;
  setHostEvent(bState, eventText);
  await saveRoom(roomCode, { bunker_state: bState });
  return next;
}

export async function changeCataclysm(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = await loadPools(room.selected_pack_id);
  const bState = room.bunker_state || {};
  const card = pickCard(pools.bunker.cataclysm, 'Невідомий катаклізм');
  // Скільки хвилин відведено новому катаклізму на відлік (0/відсутнє — без таймера)
  const timerMinutes = Number(card.meta?.timer_minutes) || 0;
  bState.cataclysm = {
    text: card.value,
    description: card.meta?.description || '',
    timer_minutes: timerMinutes,
    population: card.meta?.population || 'Невідомо' // так само, як у generateGameState: інакше після зміни катаклізму населення зникло б з дошки
  };
  // Глобальна мітка кінця відліку в базі даних (мс), щоб таймер був синхронізованим у усіх гравців.
  // Новий катаклізм без власного таймера має скидати стару мітку від попереднього катаклізму, інакше гравці бачили б чужий відлік.
  bState.cataclysm_timer_end = timerMinutes > 0 ? getGlobalTime() + timerMinutes * 60 * 1000 : null;
  setHostEvent(bState, `Ведучий змінив катаклізм: ${card.value}`);
  await saveRoom(roomCode, { bunker_state: bState });
}

export async function changeBunkerCapacity(roomCode, delta) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  const current = Number(bState.capacity) || 1;
  bState.capacity = Math.max(1, current + delta);
  setHostEvent(bState, `Ведучий змінив кількість місць у бункері: ${bState.capacity}`);
  await saveRoom(roomCode, { bunker_state: bState });
  return bState.capacity;
}
