import { PERFECT_HEALTH_LABEL, HEAL_PERFECT, CHAR_TYPE_MAP } from './constants.js';
import { randInt, shuffleArray } from '../random.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { loadPools } from './card-pools.js';
import { resolveIds, setHostEvent, nameOf, labelOf, targetPhrase } from './common.js';
import {
  drawCharacteristic, withReveal, rerollGenderAndAge, buildCustomCard,
  isEmptyChar, realCards, slotRevealed, emptyMarker
} from './characteristics.js';

// ===== Дії з характеристиками гравців =====
// Шаблон кожної дії: getRoom → snapshot (для «Скасувати») → зміна players_state/bunker_state → setHostEvent → saveRoom.
// Момент виклику snapshot() у різних діях різний свідомо (див. коментарі), тому спільної обгортки немає.

export async function changeCharacteristic(roomCode, targetId, charType) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = await loadPools();
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    if (!pState[id]) return;
    if (charType === 'gender') {
      // Стать і вік генеруються разом, інакше вік лишається від старої статі (напр. у Кіборга)
      rerollGenderAndAge(pState[id], pools);
      return;
    }
    pState[id][charType] = withReveal(pState[id][charType], drawCharacteristic(charType, pools));
  });

  setHostEvent(bState, `Ведучий змінив характеристику «${labelOf(charType)}» ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function changeExperience(roomCode, targetId, newExpLevel) {
  if (!newExpLevel) throw new Error('Оберіть рівень стажу');
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    if (pState[id]?.professions?.[0]) pState[id].professions[0].stage = newExpLevel;
  });

  setHostEvent(bState, `Ведучий встановив стаж «${newExpLevel}» ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function changeDiseaseSeverity(roomCode, targetId, severityLevel) {
  if (!severityLevel) throw new Error('Оберіть ступінь хвороби');
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const h = pState[id]?.health?.[0];
    if (!h || h.disease === PERFECT_HEALTH_LABEL) return; // у здорової людини немає ступеня
    h.severity = severityLevel;
  });

  setHostEvent(bState, `Ведучий встановив ступінь хвороби «${severityLevel}» ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function invertGender(roomCode, targetId) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = await loadPools();
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const p = pState[id];
    if (!p?.gender) return;
    rerollGenderAndAge(p, pools, true);
  });

  setHostEvent(bState, `Ведучий змінив стать ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function swapCharacteristics(roomCode, charType, targetId = 'all') {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};
  const allIds = Object.keys(pState);
  if (allIds.length < 2) throw new Error('Замало гравців для обміну');

  let eventText;
  if (targetId === 'all') {
    const values = allIds.map(id => pState[id][charType]);
    const shuffled = shuffleArray(values);
    allIds.forEach((id, idx) => { pState[id][charType] = shuffled[idx]; });
    eventText = `Ведучий обміняв характеристику «${labelOf(charType)}» між усіма гравцями`;
  } else {
    if (!pState[targetId]) throw new Error('Гравця не знайдено');
    const others = allIds.filter(id => id !== targetId);
    const partner = others[randInt(0, others.length - 1)];
    const tmp = pState[targetId][charType];
    pState[targetId][charType] = pState[partner][charType];
    pState[partner][charType] = tmp;
    eventText = `Ведучий обміняв характеристику «${labelOf(charType)}» між ${nameOf(pState, targetId)} та ${nameOf(pState, partner)}`;
  }

  setHostEvent(bState, eventText);
  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function shiftAnnulCharacteristics(roomCode, charType, direction = 'cw') {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};
  const ids = Object.keys(pState);
  if (ids.length < 2) throw new Error('Замало гравців для зсуву');

  const values = ids.map(id => pState[id][charType]);
  const shifted = direction === 'ccw'
    ? [...values.slice(1), values[0]]
    : [values[values.length - 1], ...values.slice(0, -1)];

  ids.forEach((id, idx) => { pState[id][charType] = shifted[idx]; });

  const dirText = direction === 'ccw' ? 'проти годинникової' : 'за годинниковою';
  setHostEvent(bState, `Ведучий зсунув характеристику «${labelOf(charType)}» між гравцями (${dirText})`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function healPlayer(roomCode, targetId, healAction) {
  if (!healAction) throw new Error('Оберіть тип лікування');
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const p = pState[id];
    if (!p?.health?.[0]) return;
    const wasRevealed = p.health[0].is_revealed;
    if (healAction === HEAL_PERFECT) {
      p.health = [{ disease: PERFECT_HEALTH_LABEL, severity: null, is_revealed: wasRevealed }];
    } else if (p.health[0].disease !== PERFECT_HEALTH_LABEL) {
      p.health[0].severity = healAction;
    }
  });

  setHostEvent(bState, `Ведучий вилікував ${targetPhrase(pState, targetId, 'genitive')}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

// customText (необов'язково): якщо не порожній — БД не чіпаємо, додається саме цей текст.
// Нова картка завжди додається ПОРУЧ з існуючими (поле стає масивом).
export async function addExtraCharacteristic(roomCode, targetId, charCategory, customText = '') {
  const meta = CHAR_TYPE_MAP[charCategory];
  if (!meta || !meta.isArray || meta.noExtra) throw new Error('Цей тип не можна додати');
  const custom = String(customText || '').trim();
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = custom ? null : await loadPools();
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const p = pState[id];
    if (!p) return;
    // Поточні значення поля -> масив без маркерів порожнечі
    const existing = realCards(p[charCategory]);
    // Нова картка успадковує стан відкриття групи, щоб не "випадати" з відображення
    const revealed = existing.length ? !!existing[0].is_revealed : false;
    const fresh = custom ? [buildCustomCard(charCategory, custom)] : drawCharacteristic(charCategory, pools);
    p[charCategory] = [...existing, ...fresh.map(x => ({ ...x, is_revealed: revealed }))];
  });

  setHostEvent(bState, `Ведучий додав додаткову характеристику «${labelOf(charCategory)}» ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function deleteInventory(roomCode, targetId, actionType) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};
  const key = actionType === 'backpack' ? 'backpack' : 'large_inventory';

  resolveIds(pState, targetId).forEach(id => {
    if (!pState[id]) return;
    const cur = pState[id][key];
    // Зберігаємо статус видимості слота: змінюється лише текст («Пусто»), а картка лишається відкритою або закритою, як була.
    // Без маркера (голий []) player-parser вважає порожній слот відкритим, тому картка розкривалася сама.
    let wasRevealed;
    if (isEmptyChar(cur)) {
      const marker = Array.isArray(cur) ? cur.find(x => x && x.isEmpty) : (cur && cur.isEmpty ? cur : null);
      wasRevealed = marker ? !!marker.is_revealed : true; // без маркера гравець бачив цей слот відкритим
    } else {
      wasRevealed = slotRevealed(cur);
    }
    pState[id][key] = emptyMarker(key, wasRevealed);
  });

  const itemText = key === 'backpack' ? 'рюкзак' : 'крупний інвентар';
  setHostEvent(bState, `Ведучий видалив ${itemText} у ${targetPhrase(pState, targetId, 'genitive')}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}
