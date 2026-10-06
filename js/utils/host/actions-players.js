import { PERFECT_HEALTH_LABEL, HEAL_PERFECT, CHAR_TYPE_MAP, DELETABLE_CHARACTERISTICS } from './constants.js';
import { randInt, shuffleArray } from '../random.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { loadPools } from './card-pools.js';
import { resolveIds, setHostEvent, nameOf, labelOf, targetPhrase } from './common.js';
import {
  drawCharacteristic, withReveal, rerollGenderAndAge, applyGenderCard, buildCustomCard,
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

export async function changeExperience(roomCode, targetId, charType, newExpLevel) {
  if (!newExpLevel) throw new Error('Оберіть рівень стажу');
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const p = pState[id];
    if (charType === 'hobby' && p?.hobbies?.[0]) {
      p.hobbies[0].stage = newExpLevel;
    } else if (p?.professions?.[0]) {
      p.professions[0].stage = newExpLevel;
    }
  });

  const typeName = charType === 'hobby' ? 'хобі' : 'професії';
  setHostEvent(bState, `Ведучий встановив стаж ${typeName} «${newExpLevel}» ${targetPhrase(pState, targetId)}`);

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

export async function changeBodyType(roomCode, targetId, bodyType) {
  if (!bodyType) throw new Error('Оберіть статуру');
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = await loadPools(); // потрібна лише для діапазону зросту, коли статуру треба відновити після видалення
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  resolveIds(pState, targetId).forEach(id => {
    const p = pState[id];
    if (!p) return;

    // Після «Видалити характеристику» поле body — масив-заглушка [{ isEmpty: true, is_revealed }], а не об'єкт статури.
    // Запис body.type у такий масив нічого не відновлює, тож будуємо картку заново (зріст — випадковий в діапазоні пака),
    // статус відкрито/закрито беремо з самого маркера (slotRevealed для порожнього слота завжди false).
    if (isEmptyChar(p.body)) {
      const marker = Array.isArray(p.body) ? p.body.find(x => x && x.isEmpty) : p.body;
      const range = pools.config?.height_range;
      p.body = {
        type: bodyType,
        height_cm: range ? randInt(range.min, range.max) : 170,
        is_revealed: !!marker?.is_revealed
      };
      return;
    }

    p.body.type = bodyType;
  });

  setHostEvent(bState, `Ведучий встановив статуру «${bodyType}» ${targetPhrase(pState, targetId)}`);

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
    rerollGenderAndAge(p, pools, true, false);
  });

  setHostEvent(bState, `Ведучий змінив стать ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function swapCharacteristics(roomCode, charType, target1, target2) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};
  const allIds = Object.keys(pState);
  if (allIds.length < 2) throw new Error('Замало гравців для обміну');

  if (!target1 || target1 === 'all') throw new Error('Оберіть першого гравця для обміну');
  if (!pState[target1]) throw new Error('Гравця 1 не знайдено');
  if (!target2 || target2 === 'all') throw new Error('Оберіть другого гравця для обміну');
  if (!pState[target2]) throw new Error('Гравця 2 не знайдено');
  if (target1 === target2) throw new Error('Гравці для обміну мають бути різними');

  const tmp = pState[target1][charType];
  pState[target1][charType] = pState[target2][charType];
  pState[target2][charType] = tmp;
  const eventText = `Ведучий обміняв характеристику «${labelOf(charType)}» між ${nameOf(pState, target1)} та ${nameOf(pState, target2)}`;

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

// Універсальне "Видалити характеристику": будь-яке поле зі списку DELETABLE_CHARACTERISTICS (constants.js) стає порожнім.
// Замість голого [] пишемо маркер-заглушку (emptyMarker), що тримає статус відкриття слота: player-parser показує «Пусто» рівно там,
// де картка була (відкрита або закрита), і вона не розкривається сама. Уже порожні слоти пропускаються.
export async function deleteCharacteristic(roomCode, targetId, charKey) {
  const meta = DELETABLE_CHARACTERISTICS.find(c => c.key === charKey);
  if (!meta) throw new Error('Оберіть характеристику для видалення');

  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  // Цілі, де ще є що видаляти. Перевірка ДО snapshot, щоб невдала спроба не затирала попередню точку скасування.
  const ids = resolveIds(pState, targetId).filter(id => pState[id] && !isEmptyChar(pState[id][charKey]));
  if (!ids.length) throw new Error('Ця характеристика вже порожня');

  snapshot(room);

  ids.forEach(id => {
    // Статус відкриття беремо з поточної (непорожньої) картки — слот лишається відкритим або закритим, як був
    pState[id][charKey] = emptyMarker(charKey, slotRevealed(pState[id][charKey]));
  });

  setHostEvent(bState, `Ведучий видалив характеристику «${meta.label}» у ${targetPhrase(pState, targetId, 'genitive')}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

// Старий вхід для рюкзака / крупного інвентаря — тепер тонка обгортка над deleteCharacteristic (в панелі не використовується).
export function deleteInventory(roomCode, targetId, actionType) {
  return deleteCharacteristic(roomCode, targetId, actionType === 'backpack' ? 'backpack' : 'large_inventory');
}

// ===== Блок "Лікувати / Зробити" =====

// Прапорець чайлдфрі живе в players_state[id].childfree = { value: boolean, is_revealed } (пише game-generator.js; читає player-parser.js,
// першим дивиться старе поле is_childfree). Відображається разом із статтю та віком, тому is_revealed беремо в статі.
async function setChildfree(roomCode, targetId, value) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  const flagKey = p => ('is_childfree' in p ? 'is_childfree' : 'childfree');
  const ids = resolveIds(pState, targetId).filter(id => {
    const p = pState[id];
    return p?.gender && !!(p[flagKey(p)]?.value) !== value;
  });
  if (!ids.length) throw new Error(value ? 'Уже чайлдфрі' : 'Чайлдфрі відсутнє');

  snapshot(room);

  ids.forEach(id => {
    const p = pState[id];
    p[flagKey(p)] = { value, is_revealed: !!p.gender.is_revealed };
  });

  setHostEvent(bState, value
    ? `Ведучий зробив ${targetPhrase(pState, targetId, 'genitive')} чайлдфрі`
    : `Ведучий вилікував ${targetPhrase(pState, targetId, 'genitive')} від чайлдфрі`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export const makeChildfree = (roomCode, targetId) => setChildfree(roomCode, targetId, true);
export const cureChildfree = (roomCode, targetId) => setChildfree(roomCode, targetId, false);

// Вилікувати фобію: слот стає порожнім з написом «Немає» (статус відкриття слота зберігається).
export async function curePhobia(roomCode, targetId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  const ids = resolveIds(pState, targetId).filter(id => pState[id] && !isEmptyChar(pState[id].phobias));
  if (!ids.length) throw new Error('Фобії вже немає');

  snapshot(room);

  ids.forEach(id => {
    const wasRevealed = slotRevealed(pState[id].phobias);
    pState[id].phobias = [{ isEmpty: true, value: 'Немає', is_revealed: wasRevealed }];
  });

  setHostEvent(bState, `Ведучий вилікував від фобії ${targetPhrase(pState, targetId, 'genitive')}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

// Задати конкретну стать (з пулу пака) і перегенерувати вік під неї. Вже маючих цю стать пропускаємо.
export async function setGender(roomCode, targetId, genderValue) {
  if (!genderValue) throw new Error('Оберіть стать');
  const pools = await loadPools();
  const card = (pools.character.gender || []).find(c => c.value === genderValue);
  if (!card) throw new Error('Такої статі немає в паку');

  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};

  const ids = resolveIds(pState, targetId).filter(id => pState[id]?.gender && pState[id].gender.value !== card.value);
  if (!ids.length) throw new Error('У гравця вже ця стать');

  snapshot(room);

  ids.forEach(id => applyGenderCard(pState[id], card, pools.config, false));

  setHostEvent(bState, `Ведучий встановив стать «${card.value}» ${targetPhrase(pState, targetId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}
