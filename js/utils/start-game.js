import { supabase } from '../services/supabase.js';
import { getGameConfig } from '../config/config-manager.js';
import { generateGameState } from './game-generator.js';
import { loadPools } from './host/card-pools.js';

// Старт гри: читає гравців кімнати, генерує стан за карткам пака і записує його в БД одним UPDATE.
// Без DOM: кнопку, її текст і показ помилки веде викликач (game.js -> handleStartGame).
// Пул карток береться з loadPools() (host/card-pools.js) — тих самих запитів packs/pack_cards більше не дублюємо.
export async function startGame(roomCode) {
  const { data: room, error: roomError } = await supabase
    .from('rooms').select('players_state').eq('room_code', roomCode).single();
  if (roomError || !room) throw new Error(roomError?.message || 'Кімнату не знайдено');

  const pState = room.players_state || {};
  const playersList = Object.entries(pState).map(([id, p]) => ({ id, name: p.name }));

  // Кнопка «Почати гру» вже disabled при недостатній кількості, але відображена кількість могла застаріти
  // (хтось вийшов між рендером і кліком) — тому рахуємо ще раз по свіжих даних кімнати.
  const { minPlayersToStart } = await getGameConfig();
  if (playersList.length < minPlayersToStart) {
    throw new Error(`Для старту потрібно мінімум ${minPlayersToStart} гравців (зараз ${playersList.length})`);
  }

  const pools = await loadPools();
  const hasCards = Object.keys(pools.bunker).length > 0 || Object.keys(pools.character).length > 0;
  if (!hasCards) throw new Error('Не знайдено жодної картки для цього пака');

  const cardsData = { bunker: pools.bunker, character: pools.character };
  const { bunkerState, playersState } = await generateGameState(playersList, cardsData, pools.config);

  const { error: updateError } = await supabase
    .from('rooms')
    .update({ bunker_state: bunkerState, players_state: playersState })
    .eq('room_code', roomCode);
  if (updateError) throw new Error(updateError.message || 'Не вдалося зберегти стан гри');
}
