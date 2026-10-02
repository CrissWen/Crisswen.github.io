import { listPacks, selectRoomPack, DEFAULT_PACK_ID } from '../../services/packs-store.js';
import { showGlobalToast } from '../overlays/global-toast.js';

// ===== Вибір пака гри в кімнаті очікування (лише ведучий) =====
// Розмітка списку — у board/waiting-room.js. Тут: завантаження паків ведучого і обробка зміни.
// Стан модуля живе в пам'яті вкладки; ctx — з game.js (getter-и, без циклічних імпортів).

let packOptions = null;   // [{ id, title, isDefault }]: null = ще не завантажено
let loading = false;

// Скидання при виході зі сторінки гри
export function resetPackSelect() {
  packOptions = null;
  loading = false;
}

export function getPackOptions() {
  return packOptions;
}

// Підтягує паки ведучого (дефолтний першим, далі особисті за назвою — це забезпечує listPacks) один раз за відвідування кімнати.
// Після завантаження просить game.js перемалювати кімнату очікування вже зі списком.
// При помилці лишаємо порожній список (у випадаючому буде лише поточний пак) і не повторюємо запит на кожному оновленні кімнати.
export function ensurePackOptions(ctx) {
  if (packOptions || loading) return;
  loading = true;
  listPacks()
    .then(list => { packOptions = list; })
    .catch(err => {
      console.error('Не вдалося завантажити список паків:', err);
      packOptions = [];
      showGlobalToast('Не вдалося завантажити список паків');
    })
    .finally(() => {
      loading = false;
      ctx.refreshBoard();
    });
}

// Ведучий обрав пак у списку. Новий вибір показуємо одразу (оптимістично), а в разі помилки повертаємо попередній.
// Для інших гравців зміна доходить через Realtime (game.js підписаний на UPDATE рядка кімнати).
export async function handlePackChange(select, ctx) {
  const packId = select.value;
  const room = ctx.getRoomState();
  if (!room || !packId) return;
  if (packId === (room.selected_pack_id || DEFAULT_PACK_ID)) return;

  const previous = { id: room.selected_pack_id, title: room.selected_pack_title };
  const option = packOptions?.find(p => p.id === packId);
  room.selected_pack_id = packId;
  room.selected_pack_title = option && !option.isDefault ? option.title : null;

  // Знімаємо фокус до перемальовування: поки список у фокусі, game.js не перемальовує кімнату очікування
  select.blur();
  ctx.refreshBoard();

  try {
    await selectRoomPack(ctx.getRoomCode(), packId);
  } catch (err) {
    console.error('Не вдалося змінити пак:', err);
    showGlobalToast(err.message || 'Не вдалося змінити пак');
    // Realtime міг уже замінити об'єкт стану, тому беремо актуальний
    const current = ctx.getRoomState();
    if (current) {
      current.selected_pack_id = previous.id;
      current.selected_pack_title = previous.title;
    }
  } finally {
    ctx.refreshBoard();
  }
}
