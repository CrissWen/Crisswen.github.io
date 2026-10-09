import { STEAL_REPLACE_KEYS, STEAL_APPEND_KEYS } from './constants.js';
import { getRoom, saveRoom, snapshot } from './room-store.js';
import { loadPools } from './card-pools.js';
import { setHostEvent, nameOf, labelOf } from './common.js';
import {
  drawCharacteristic, rerollGenderAndAge,
  isEmptyChar, realCards, slotRevealed, forceReveal, emptyMarker
} from './characteristics.js';

// ===== "Вкрасти характеристику" =====
// Гілка 1 (STEAL_REPLACE_KEYS): жертва отримує нову випадкову картку, злодій ЗАМІЩУЄ свою вкраденою.
// Гілка 2 (STEAL_APPEND_KEYS): жертва лишається "Пусто", злодій отримує картку ДОДАТКОВО до своєї.

export async function stealCharacteristic(roomCode, thiefId, victimId, charType) {
  if (!thiefId || !victimId) throw new Error('Оберіть гравців');
  if (thiefId === victimId) throw new Error('Оберіть різних гравців');

  const replaceMode = STEAL_REPLACE_KEYS.includes(charType);
  const appendMode = STEAL_APPEND_KEYS.includes(charType);
  if (!replaceMode && !appendMode) throw new Error('Цю характеристику не можна вкрасти');

  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  const thief = pState[thiefId];
  const victim = pState[victimId];
  if (!thief || !victim) throw new Error('Гравця не знайдено');

  // Перевірка ДО snapshot, щоб невдала спроба не затирала попередню точку скасування
  if (isEmptyChar(victim[charType])) throw new Error('Характеристика вже пуста');

  // Статус відкриття належить СЛОТУ гравця, а не картці в ньому — фіксуємо його одразу, до будь-яких
  // мутацій, і далі жорстко застосовуємо його до того, що ляже в кожен слот.
  const thiefWasRevealed = slotRevealed(thief[charType]);   // порожній слот злодія — вважаємо закритим
  const victimWasRevealed = slotRevealed(victim[charType]);

  const pools = replaceMode ? await loadPools() : null;
  snapshot(room);
  const bState = room.bunker_state || {};

  if (replaceMode) {
    if (charType === 'gender') {
      // Вік прив'язаний до статі: злодій забирає обидва під СВОЇМ статусом,
      // жертва отримує нову стать/вік під СВОЇМ попереднім статусом (не від нового випадкового картки).
      thief.gender = { ...victim.gender, is_revealed: thiefWasRevealed };
      if (victim.age) thief.age = { ...victim.age, is_revealed: thiefWasRevealed };
      rerollGenderAndAge(victim, pools, true);
      victim.gender.is_revealed = victimWasRevealed;
      if (victim.age) victim.age.is_revealed = victimWasRevealed;
    } else {
      const stolen = victim[charType];
      thief[charType] = forceReveal(stolen, thiefWasRevealed);
      victim[charType] = forceReveal(drawCharacteristic(charType, pools, { age: victim.age?.value }), victimWasRevealed);
    }
  } else {
    // Поле злодія стає масивом (якщо ще не був) і отримує вкрадені картки поруч з власними;
    // весь результуючий слот приводиться до одного статусу — того, що був у злодія ДО крадіжки.
    const stolen = realCards(victim[charType]);
    const existing = realCards(thief[charType]);
    thief[charType] = [...existing, ...stolen].map(c => ({ ...c, is_revealed: thiefWasRevealed }));
    // Жертва: замість порожнього [] записуємо маркер-заглушку, що жорстко тримає
    // попередній статус відкриття СЛОТА жертви (незалежно від того, що вона там мала).
    victim[charType] = emptyMarker(charType, victimWasRevealed);
  }

  setHostEvent(bState, `Ведучий: ${nameOf(pState, thiefId)} вкрав(ла) характеристику «${labelOf(charType)}» у ${nameOf(pState, victimId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}
