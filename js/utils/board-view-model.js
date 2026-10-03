import { mapPlayerState } from './player-parser.js';

// Перетворює стан кімнати (players_state + bunker_state) на готові дані для блоків дошки.
// Чиста функція: без DOM і без звернень до БД, тож її легко перевіряти окремо від рендеру (game.js -> renderActiveGame).
export function buildBoardViewModel(roomData, currentUserId) {
  const pState = roomData.players_state || {};
  const bState = roomData.bunker_state || {};

  // ===== Бункер =====
  const descriptionParts = [
    bState.history,
    bState.rooms_description,
    bState.location,
    (bState.problem && bState.problem !== 'Відсутня') ? bState.problem : null
  ]
    .filter(Boolean)
    .map(text => {
      const trimmed = text.trim();
      return trimmed.match(/[.!?]$/) ? trimmed : trimmed + '.';
    });

  const bunkerData = bState.capacity ? {
    description: descriptionParts.join(' '),
    size: bState.size,
    yearsInBunker: bState.stay_time,
    foodSupply: bState.food_and_water,
    capacity: bState.capacity,
    features: bState.items || []
  } : null;

  // ===== Катаклізм =====
  const cataclysmData = bState.cataclysm ? {
    icon: '☢',
    title: bState.cataclysm.text,
    desc: bState.cataclysm.description,
    population: bState.cataclysm.population
  } : null;

  // ===== Гравці, спец. можливості, колонки таблиці =====
  const parsedPlayers = [];
  const parsedAbilities = [];
  const allCharLabels = new Set();

  for (const [id, rawPlayer] of Object.entries(pState)) {
    if (!rawPlayer.gender) continue;

    // Помилка парсингу одного гравця не повинна ламати весь стіл
    try {
      const flatPlayer = mapPlayerState(rawPlayer);
      flatPlayer.characteristics.forEach(c => allCharLabels.add(c.label));

      parsedAbilities.push({
        name: flatPlayer.name,
        ability1: flatPlayer.abilities[0]?.open ? flatPlayer.abilities[0].value : null,
        ability2: flatPlayer.abilities[1]?.open ? flatPlayer.abilities[1].value : null,
        isKicked: !!rawPlayer.is_kicked
      });

      parsedPlayers.push({ ...flatPlayer, id });
    } catch (err) {
      console.error(`Не вдалося розібрати стан гравця ${id}:`, err);
    }
  }

  const columns = Array.from(allCharLabels);

  // Лічильник "Охочі потрапити в бункер": усі зареєстровані в кімнаті vs ще не вигнані (is_kicked).
  const totalPlayers = Object.keys(pState).length;
  const alivePlayers = Object.values(pState).filter(player => !player.is_kicked).length;

  const tableRows = parsedPlayers.map(p => {
    const cells = columns.map(colName => {
      const char = p.characteristics.find(c => c.label === colName);
      return (char && char.open) ? char.value : null;
    });
    return { name: p.name, id: p.id, isKicked: !!pState[p.id]?.is_kicked, cells };
  });

  // ===== Власні характеристики поточного користувача =====
  let myData = { name: pState[currentUserId]?.name || 'Глядач', characteristics: [], abilities: [] };
  try {
    if (pState[currentUserId] && pState[currentUserId].gender) {
      myData = mapPlayerState(pState[currentUserId]);
    }
  } catch (err) {
    console.error('Не вдалося розібрати власні характеристики:', err);
  }

  // ===== Кандидати для голосування =====
  const votingPlayers = Object.entries(pState).map(([id, p]) => ({
    id,
    name: p.name || 'Гравець',
    // Вигнаний (is_kicked) не голосує і не може бути кандидатом — так само, як і вибулий (is_alive === false)
    alive: p.is_alive !== false && !p.is_kicked
  }));

  return {
    bunkerData,
    cataclysmData,
    columns,
    tableRows,
    parsedAbilities,
    alivePlayers,
    totalPlayers,
    myData,
    votingPlayers
  };
}
