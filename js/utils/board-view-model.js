import { mapPlayerState } from './player-parser.js';
import { ICONS } from '../constants/icons.js';

// Гравці у порядку, випадково визначеному при старті гри (generateGameState → bunker_state.players_order).
// Гравці, яких у списку немає (стара гра без players_order або хтось доєднався пізніше), йдуть в кінці у звичному порядку.
function orderedPlayerEntries(pState, bState) {
  const entries = Object.entries(pState);
  const order = Array.isArray(bState?.players_order) ? bState.players_order : null;
  if (!order) return entries;
  const position = new Map(order.map((id, index) => [id, index]));
  return entries.sort(([a], [b]) => (position.get(a) ?? order.length) - (position.get(b) ?? order.length));
}

// Перетворює стан кімнати (players_state + bunker_state) на готові дані для блоків дошки.
// Чиста функція: без DOM і без звернень до БД, тож її легко перевіряти окремо від рендеру (game.js -> renderActiveGame).
// opts.reveal — фінал завершеної гри: у таблицях усі характеристики й спецможливості (значення + прапорець відкритості, щоб показати замок),
// «вибув» = вигнаний або is_alive === false, лічильник = скільки гравців пройшло.
export function buildBoardViewModel(roomData, currentUserId, opts = {}) {
  const reveal = !!opts.reveal;
  const isOut = (p) => !!p?.is_kicked || p?.is_alive === false;
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
    icon: bState.cataclysm.icon || ICONS.HAZARD,
    title: bState.cataclysm.text,
    desc: bState.cataclysm.description,
    population: bState.cataclysm.population
  } : null;

  // ===== Гравці, спец. можливості, колонки таблиці =====
  const parsedPlayers = [];
  const parsedAbilities = [];
  const allCharLabels = new Set();

  for (const [id, rawPlayer] of orderedPlayerEntries(pState, bState)) {
    if (!rawPlayer.gender) continue;

    // Помилка парсингу одного гравця не повинна ламати весь стіл
    try {
      const flatPlayer = mapPlayerState(rawPlayer, bState.stage_scales, bState.age_categories);
      flatPlayer.characteristics.forEach(c => allCharLabels.add(c.label));

      parsedAbilities.push({
        id,
        name: flatPlayer.name,
        ability1: (reveal || flatPlayer.abilities[0]?.open) ? (flatPlayer.abilities[0]?.value ?? null) : null,
        ability2: (reveal || flatPlayer.abilities[1]?.open) ? (flatPlayer.abilities[1]?.value ?? null) : null,
        // Запис «Немає» (здібності в гравця нема) не має dbKey: ховати там нічого, тож замок не потрібен
        ability1Open: flatPlayer.abilities[0]?.dbKey ? !!flatPlayer.abilities[0].open : true,
        ability2Open: flatPlayer.abilities[1]?.dbKey ? !!flatPlayer.abilities[1].open : true,
        isKicked: !!rawPlayer.is_kicked,
        isOut: isOut(rawPlayer)
      });

      parsedPlayers.push({ ...flatPlayer, id });
    } catch (err) {
      console.error(`Не вдалося розібрати стан гравця ${id}:`, err);
    }
  }

  const columns = Array.from(allCharLabels);

  // Лічильник "Охочі потрапити в бункер": усі зареєстровані в кімнаті vs ще не вигнані (is_kicked).
  const totalPlayers = Object.keys(pState).length;
  const alivePlayers = Object.values(pState).filter(player => reveal ? !isOut(player) : !player.is_kicked).length;

  const tableRows = parsedPlayers.map(p => {
    const chars = columns.map(colName => p.characteristics.find(c => c.label === colName));
    const cells = chars.map(char => (char && (reveal || char.open)) ? char.value : null);
    // cellsOpen[i] === false — характеристику не було відкрито на момент завершення гри (у фіналі показується із замком)
    const cellsOpen = chars.map(char => !char || !!char.open);
    return { name: p.name, id: p.id, isKicked: !!pState[p.id]?.is_kicked, isOut: isOut(pState[p.id]), cells, cellsOpen };
  });

  // ===== Власні характеристики поточного користувача =====
  let myData = { name: pState[currentUserId]?.name || 'Глядач', characteristics: [], abilities: [] };
  try {
    if (pState[currentUserId] && pState[currentUserId].gender) {
      myData = mapPlayerState(pState[currentUserId], bState.stage_scales, bState.age_categories);
    }
  } catch (err) {
    console.error('Не вдалося розібрати власні характеристики:', err);
  }

  // ===== Кандидати для голосування =====
  const votingPlayers = orderedPlayerEntries(pState, bState).map(([id, p]) => ({
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
