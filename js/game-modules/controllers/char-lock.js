import { supabase } from '../../services/supabase.js';
import { showCustomConfirm } from '../overlays/confirm-dialog.js';
import { showGlobalToast } from '../overlays/global-toast.js';
import { addLog } from '../../utils/game/log-writer.js';
import { soundManager, SOUND_IDS } from '../../services/sound-manager.js';

// ===== Замок характеристики: гравець відкриває/ховає свою картку від інших =====
// ctx = { getRoomCode, getUserId, getUserName, getRoomState, refreshBoard } з game.js.

let isUpdatingLock = false; // щоб повторний клік під час підтвердження/запису не запустив другу операцію

// Перемикає is_revealed у стані гравця. Чиста мутація без DOM і мережі.
// Повертає false, якщо перемикати нічого (поле відсутнє або порожній масив без маркера, напр. після deleteInventory).
// Маркер isEmpty (напр. після крадіжки) має свій is_revealed і перемикається як звичайна характеристика.
// idx — індекс елемента масиву (інвентар тощо); порожній/відсутній idx перемикає весь масив разом.
export function toggleCharacteristicReveal(playerState, dbKey, idx) {
  const targetRef = playerState?.[dbKey];
  if (!targetRef || (Array.isArray(targetRef) && targetRef.length === 0)) return false;

  if (Array.isArray(targetRef)) {
    if (idx !== '' && idx !== undefined) {
      const i = parseInt(idx, 10);
      if (!targetRef[i]) return false;
      targetRef[i].is_revealed = !targetRef[i].is_revealed;
    } else {
      const newState = !targetRef[0].is_revealed;
      targetRef.forEach(x => { x.is_revealed = newState; });
    }
    return true;
  }

  targetRef.is_revealed = !targetRef.is_revealed;

  // Стать відкриває/ховає разом із віком і прапорцем childfree
  if (dbKey === 'gender') {
    const newState = targetRef.is_revealed;
    if (playerState.age) playerState.age.is_revealed = newState;
    if (playerState.is_childfree) playerState.is_childfree.is_revealed = newState;
    if (playerState.childfree) playerState.childfree.is_revealed = newState;
  }
  return true;
}

// Формує вузький список змін [{ path: [...], value: boolean }] після toggleCharacteristicReveal
// для атомарного серверного RPC set_my_reveals(p_room, p_changes).
export function buildRevealChanges(playerState, dbKey, idx) {
  const targetRef = playerState?.[dbKey];
  if (!targetRef || (Array.isArray(targetRef) && targetRef.length === 0)) return [];

  if (Array.isArray(targetRef)) {
    if (idx !== '' && idx !== undefined) {
      const i = parseInt(idx, 10);
      if (!targetRef[i]) return [];
      return [{ path: [dbKey, String(i)], value: Boolean(targetRef[i].is_revealed) }];
    }
    return targetRef.map((x, i) => ({ path: [dbKey, String(i)], value: Boolean(x.is_revealed) }));
  }

  const changes = [{ path: [dbKey], value: Boolean(targetRef.is_revealed) }];
  if (dbKey === 'gender') {
    if (playerState.age) changes.push({ path: ['age'], value: Boolean(playerState.age.is_revealed) });
    if (playerState.is_childfree) changes.push({ path: ['is_childfree'], value: Boolean(playerState.is_childfree.is_revealed) });
    if (playerState.childfree) changes.push({ path: ['childfree'], value: Boolean(playerState.childfree.is_revealed) });
  }
  return changes;
}

// Відкочує лише прапорці is_revealed за вказаними шляхами на актуальному об'єкті гравця,
// не затираючи інші поля картки, які могли оновитися через Realtime (виправляє I6).
export function revertRevealChanges(playerState, changes) {
  if (!playerState || !Array.isArray(changes)) return;
  for (const ch of changes) {
    const path = ch?.path || [];
    let cursor = playerState;
    for (let i = 0; i < path.length; i++) {
      if (cursor == null) break;
      cursor = cursor[path[i]];
    }
    if (cursor && typeof cursor === 'object') {
      cursor.is_revealed = !ch.value;
    }
  }
}

// Обробник кліку по .char-lock (викликається з handleGlobalClick у game.js)
export async function handleCharLockClick(lockBtn, ctx) {
  if (isUpdatingLock) return;

  const item = lockBtn.closest('.char-item');
  if (!item) return;

  const dbKey = item.dataset.dbkey;
  if (!dbKey) return;

  const isOpen = item.classList.contains('open');
  const label = item.querySelector('.char-label')?.textContent?.trim() || dbKey; // читаємо до перемальовування дошки
  const confirmMsg = isOpen
    ? 'Приховати цю характеристику від інших?'
    : 'Відкрити цю характеристику всім гравцям?';

  lockBtn.classList.add('is-confirming');
  let confirmed = false;
  try {
    confirmed = await showCustomConfirm(confirmMsg, lockBtn);
  } finally {
    lockBtn.classList.remove('is-confirming');
  }
  if (!confirmed) return;

  isUpdatingLock = true;
  try {
    const roomState = ctx.getRoomState();
    const userId = ctx.getUserId();
    if (!roomState?.players_state?.[userId]) return;

    const state = roomState.players_state;

    if (!toggleCharacteristicReveal(state[userId], dbKey, item.dataset.idx)) return;
    const changes = buildRevealChanges(state[userId], dbKey, item.dataset.idx);

    soundManager.play(SOUND_IDS.LOCK_TOGGLE); // клацання замка — лише коли перемикання реально відбулося
    ctx.refreshBoard(); // оптимістично: картка відкривається одразу

    const { error } = await supabase.rpc('set_my_reveals', {
      p_room: ctx.getRoomCode(),
      p_changes: changes
    });

    if (error) {
      // У БД не записалось — повертаємо лише прапорці is_revealed у актуальному стані гравця (I6)
      console.error('Не вдалося зберегти стан характеристики:', error);
      const freshPlayer = ctx.getRoomState()?.players_state?.[userId];
      if (freshPlayer) revertRevealChanges(freshPlayer, changes);
      ctx.refreshBoard();
      showGlobalToast('Не вдалося змінити видимість характеристики');
      return;
    }

    // Запис у «Лог подій». Помилка логування не має ламати саме перемикання картки.
    const who = state[userId]?.name || ctx.getUserName() || 'Гравець';
    addLog(ctx.getRoomCode(), `Гравець ${who} ${isOpen ? 'сховав' : 'відкрив'} характеристику ${label}`)
      .catch(err => console.error('Не вдалося записати подію в лог:', err));
  } catch (err) {
    console.error('Помилка оновлення:', err);
  } finally {
    isUpdatingLock = false;
  }
}
