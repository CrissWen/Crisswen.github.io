import { supabase } from '../services/supabase.js';
import { packDisplayName } from '../services/packs-store.js';
import { getGameConfig } from '../config/config-manager.js';
import { generateGameState } from './game-generator.js';
import { loadGamePools } from './host/card-pools.js';
import { describeFallback } from './pack-fallback.js';
import { pushLog } from './log-writer.js';

// Старт гри: читає гравців і обраний пак кімнати, генерує стан за його картками і записує його в БД одним UPDATE.
// Без DOM: кнопку, її текст і показ помилки веде викликач (game.js -> handleStartGame).
// Картки беруться з rooms.selected_pack_id (порожнє = дефолтний пак). Якщо в особистому паку якоїсь категорії
// менше, ніж потрібно на всіх гравців, відсутні картки випадково добираються з дефолтного (loadGamePools),
// тож гра гарантовано стартує, а що саме було додано, лишається записом у «Лог подій».
export async function startGame(roomCode) {
  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('players_state, selected_pack_id, selected_pack_title')
    .eq('room_code', roomCode)
    .single();
  if (roomError?.code === '42703' || roomError?.code === 'PGRST204') {
    throw new Error('У базі немає поля selected_pack_id. Виконайте supabase/migrations/02_room_selected_pack_stage4.sql');
  }
  if (roomError || !room) throw new Error(roomError?.message || 'Кімнату не знайдено');

  const pState = room.players_state || {};
  const playersList = Object.entries(pState).map(([id, p]) => ({ id, name: p.name }));

  // Кнопка «Почати гру» вже disabled при недостатній кількості, але відображена кількість могла застаріти
  // (хтось вийшов між рендером і кліком) — тому рахуємо ще раз по свіжих даних кімнати.
  const { minPlayersToStart } = await getGameConfig();
  if (playersList.length < minPlayersToStart) {
    throw new Error(`Для старту потрібно мінімум ${minPlayersToStart} гравців (зараз ${playersList.length})`);
  }

  const { pools, added } = await loadGamePools(room.selected_pack_id, playersList.length);
  const hasCards = Object.keys(pools.bunker).length > 0 || Object.keys(pools.character).length > 0;
  if (!hasCards) throw new Error('Не знайдено жодної картки для цього пака');

  const cardsData = { bunker: pools.bunker, character: pools.character };
  const { bunkerState, playersState } = await generateGameState(playersList, cardsData, pools.config);

  if (added.length > 0) {
    const packName = packDisplayName(room.selected_pack_id, room.selected_pack_title);
    pushLog(bunkerState, `У паку «${packName}» бракувало карток, додано з базового пака: ${describeFallback(added)}`);
  }

  const { error: updateError } = await supabase
    .from('rooms')
    .update({ bunker_state: bunkerState, players_state: playersState })
    .eq('room_code', roomCode);
  if (updateError) throw new Error(updateError.message || 'Не вдалося зберегти стан гри');
}
