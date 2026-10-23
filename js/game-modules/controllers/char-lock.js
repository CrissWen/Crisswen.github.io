import { supabase } from '../../services/supabase.js';
import { showCustomConfirm } from '../overlays/confirm-dialog.js';
import { showGlobalToast } from '../overlays/global-toast.js';
import { addLog } from '../../utils/log-writer.js';

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
      const i = parseInt(idx);
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

  const confirmed = await showCustomConfirm(confirmMsg, lockBtn);
  if (!confirmed) return;

  isUpdatingLock = true;
  try {
    const roomState = ctx.getRoomState();
    const userId = ctx.getUserId();
    if (!roomState?.players_state?.[userId]) return;

    const state = roomState.players_state;
    const snapshot = structuredClone(state[userId]); // для відкату, якщо запис у БД не вдався

    if (!toggleCharacteristicReveal(state[userId], dbKey, item.dataset.idx)) return;

    ctx.refreshBoard(); // оптимістично: картка відкривається одразу

    const { error } = await supabase.rpc('update_single_player_state', {
      room_code_val: ctx.getRoomCode(),
      user_id_val: userId,
      player_data: state[userId]
    });

    if (error) {
      // У БД не записалось — повертаємо картку як було, щоб гравець не вважав її відкритою/схованою
      console.error('Не вдалося зберегти стан характеристики:', error);
      // Беремо свіжий стан кімнати: за час запиту Realtime міг підмінити players_state новим об'єктом
      const freshState = ctx.getRoomState()?.players_state;
      if (freshState?.[userId]) freshState[userId] = snapshot;
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
