import { supabase } from '../services/supabase.js';

// ===== Довідники характеристик (спільні для host-panel.js та host-actions.js) =====

export const CHARACTERISTIC_TYPES = [
  { key: 'professions',       label: 'Професія',            category: 'profession',      isArray: true,  stagesKey: 'profession' },
  { key: 'hobbies',           label: 'Хобі',                 category: 'hobby',           isArray: true,  stagesKey: 'hobby' },
  { key: 'health',            label: "Здоров'я",             category: 'health',          isArray: true,  stagesKey: 'health' },
  { key: 'traits',            label: 'Риса характеру',       category: 'trait',           isArray: true },
  { key: 'phobias',           label: 'Фобія',                category: 'phobia',          isArray: true },
  { key: 'backpack',          label: 'Рюкзак',               category: 'backpack',        isArray: true },
  { key: 'large_inventory',   label: 'Крупний інвентар',     category: 'large_inventory', isArray: true },
  { key: 'extra_info',        label: 'Дод. відомості',       category: 'extra_info',      isArray: true },
  { key: 'special_abilities', label: 'Спец. можливість',     category: 'special_ability', isArray: true,  noExtra: true },
  { key: 'body',              label: 'Статура',              category: 'body_type',       isArray: false },
  { key: 'gender',            label: 'Стать',                category: 'gender',          isArray: false }
];

export const ARRAY_CHARACTERISTIC_TYPES = CHARACTERISTIC_TYPES.filter(c => c.isArray);
// Що можна "додати" гравцю як додаткову картку (спец. можливості не додаємо — UI показує лише 2)
export const EXTRA_CHARACTERISTIC_TYPES = CHARACTERISTIC_TYPES.filter(c => c.isArray && !c.noExtra);

// Поля бункера, які ведучий може перевизначити власним текстом
export const BUNKER_FIELDS = [
  { key: 'history',           label: 'Як і де був побудований' },
  { key: 'rooms_description', label: 'Опис кімнат' },
  { key: 'location',          label: 'Локація' },
  { key: 'size',              label: 'Площа' },
  { key: 'stay_time',         label: 'Час перебування' },
  { key: 'food_and_water',    label: 'Запаси їжі/води' },
  { key: 'problem',           label: 'Проблема бункера' }
];

export const HEAL_PERFECT = 'perfect';

const CHAR_TYPE_MAP = Object.fromEntries(CHARACTERISTIC_TYPES.map(c => [c.key, c]));

// ===== Внутрішній стан модуля (кеш пулу карток + знімок для undo) =====

let poolCache = null;
let lastSnapshot = null; // { room_code, players_state, bunker_state, host_id }

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickFromStrings(arr, fallback) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return fallback;
  return arr[randInt(0, arr.length - 1)];
}

function pickCard(arr, fallback = 'Немає даних') {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return { value: fallback, meta: {} };
  return arr[randInt(0, arr.length - 1)];
}

function pickStage(card, defaultStages) {
  if (card.meta && card.meta.stages && card.meta.stages.length) {
    return pickFromStrings(card.meta.stages, 'Невідома стадія');
  }
  return pickFromStrings(defaultStages, 'Невідома стадія');
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getRoom(roomCode) {
  const { data, error } = await supabase.from('rooms').select('*').eq('room_code', roomCode).single();
  if (error || !data) throw new Error(error?.message || 'Кімнату не знайдено');
  return data;
}

// Єдина точка запису: UPDATE у БД, а WebSocket (postgres_changes) розішле зміни всім.
// Помилки (наприклад, RLS) більше не ковтаються, а піднімаються до UI.
async function saveRoom(roomCode, patch) {
  const { error } = await supabase.from('rooms').update(patch).eq('room_code', roomCode);
  if (error) throw new Error(error.message || 'Не вдалося зберегти зміни');
}

function snapshot(room) {
  lastSnapshot = {
    room_code: room.room_code,
    players_state: JSON.parse(JSON.stringify(room.players_state || {})),
    bunker_state: JSON.parse(JSON.stringify(room.bunker_state || {})),
    host_id: room.host_id
  };
}

export function canUndo() {
  return !!lastSnapshot;
}

export async function undoLastAction(roomCode) {
  if (!lastSnapshot || lastSnapshot.room_code !== roomCode) {
    throw new Error('Немає дії для скасування');
  }
  const { players_state, bunker_state, host_id } = lastSnapshot;
  await saveRoom(roomCode, { players_state, bunker_state, host_id });
  lastSnapshot = null;
}

async function loadPools() {
  if (poolCache) return poolCache;

  const { data: pack, error: packError } = await supabase
    .from('packs').select('id, config').eq('title', 'default').single();
  if (packError || !pack) throw new Error('Не вдалося завантажити конфігурацію пака');

  const { data: rows, error: rowsError } = await supabase
    .from('pack_cards').select('pool_type, category, value, meta').eq('pack_id', pack.id);
  if (rowsError || !rows) throw new Error('Не вдалося завантажити картки пака');

  const pools = { bunker: {}, character: {}, config: pack.config || {} };
  rows.forEach(row => {
    const bucket = pools[row.pool_type];
    if (!bucket) return;
    if (!bucket[row.category]) bucket[row.category] = [];
    bucket[row.category].push({ value: row.value, meta: row.meta || {} });
  });

  poolCache = pools;
  return pools;
}

// Стадії (стаж професії, ступінь хвороби, рівень хобі) для випадаючих списків панелі
export async function getStageOptions() {
  const pools = await loadPools();
  const stages = pools.config?.default_stages || {};
  return {
    profession: stages.profession || [],
    hobby: stages.hobby || [],
    health: stages.health || []
  };
}

function drawCharacteristic(charType, pools) {
  const meta = CHAR_TYPE_MAP[charType];
  if (!meta) throw new Error('Невідомий тип характеристики: ' + charType);

  const card = pickCard(pools.character[meta.category]);
  const defaultStages = pools.config?.default_stages?.[meta.stagesKey];

  switch (charType) {
    case 'gender':
      return { value: card.value, is_revealed: false };
    case 'body': {
      const range = pools.config?.height_range;
      return {
        type: card.value,
        height_cm: range ? randInt(range.min, range.max) : 170,
        is_revealed: false
      };
    }
    case 'professions':
      return [{ title: card.value, ability: card.meta?.ability || '', stage: pickStage(card, defaultStages), is_revealed: false }];
    case 'hobbies':
      return [{ title: card.value, stage: pickStage(card, defaultStages), is_revealed: false }];
    case 'health':
      return [{ disease: card.value, severity: pickStage(card, defaultStages), is_revealed: false }];
    case 'traits':
    case 'phobias':
    case 'extra_info':
      return [{ value: card.value, is_revealed: false }];
    case 'backpack':
    case 'large_inventory':
      return [{ item: card.value, is_revealed: false }];
    case 'special_abilities': {
      // У грі завжди 2 спец. можливості, тому при заміні тягнемо дві
      const second = pickCard(pools.character[meta.category]);
      return [
        { text: card.value,   is_used: false, is_revealed: false },
        { text: second.value, is_used: false, is_revealed: false }
      ];
    }
    default:
      throw new Error('Невідомий тип характеристики: ' + charType);
  }
}

// Нова характеристика успадковує стан "відкрито/закрито" старої,
// щоб заміна не розкривала і не ховала інформацію без відома гравця.
function withReveal(oldVal, newVal) {
  const wasRevealed = Array.isArray(oldVal) ? !!oldVal[0]?.is_revealed : !!oldVal?.is_revealed;
  if (Array.isArray(newVal)) return newVal.map(x => ({ ...x, is_revealed: wasRevealed }));
  return { ...newVal, is_revealed: wasRevealed };
}

// Вік для нової статі: якщо в meta статі є custom_age (напр. "Без віку" у Кіборга) — беремо його,
// інакше випадкове число в межах config.age_range пака.
function generateAge(genderCard, config) {
  const custom = genderCard?.meta?.custom_age;
  if (custom) return custom;
  const range = config?.age_range;
  return range ? randInt(range.min, range.max) : randInt(18, 60);
}

// Нова стать і новий вік одним махом. Обидва поля успадковують стан "відкрито/закрито" старої статі
// (game.js також розкриває/ховає age разом із gender). excludeCurrent — не випадати тій самій статі.
function rerollGenderAndAge(player, pools, excludeCurrent = false) {
  const all = pools.character.gender || [];
  const others = excludeCurrent ? all.filter(c => c.value !== player.gender?.value) : all;
  const card = pickCard(others.length ? others : all, 'Стать невідома');
  const wasRevealed = !!player.gender?.is_revealed;

  player.gender = { value: card.value, is_revealed: wasRevealed };
  player.age = { value: generateAge(card, pools.config), is_revealed: wasRevealed };
}

function resolveIds(pState, targetId) {
  return targetId === 'all' ? Object.keys(pState) : [targetId];
}

// ===== Глобальні сповіщення від ведучого (Toast для всіх гравців) =====
// Записується в bunker_state разом з іншими змінами в тій же UPDATE, щоб postgres_changes
// розіслав його всім гравцям разом із фактичною зміною. id — Date.now(), щоб game.js міг відрізнити нову подію від вже показаної.
function setHostEvent(bState, text) {
  bState.latest_host_event = { id: Date.now(), text };
}

function nameOf(pState, id) {
  return pState?.[id]?.name || 'Гравець';
}

function labelOf(charType) {
  return CHAR_TYPE_MAP[charType]?.label || charType;
}

// ===== Дії з характеристиками гравців =====

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

  const targetText = targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий змінив характеристику «${labelOf(charType)}» ${targetText}`);

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

  const targetText = targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий встановив стаж «${newExpLevel}» ${targetText}`);

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
    if (!h || h.disease === 'Ідеально здоровий') return; // у здорової людини немає ступеня
    h.severity = severityLevel;
  });

  const targetText = targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий встановив ступінь хвороби «${severityLevel}» ${targetText}`);

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

  const targetText = targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий змінив стать ${targetText}`);

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

// ===== "Вкрасти характеристику" =====
// Гілка 1: жертва отримує нову випадкову картку, злодій ЗАМІЩУЄ свою вкраденою.
const STEAL_REPLACE_KEYS = ['gender', 'body', 'traits', 'health', 'phobias'];
// Гілка 2: жертва лишається "Пусто", злодій отримує картку ДОДАТКОВО до своєї.
const STEAL_APPEND_KEYS = ['professions', 'hobbies', 'large_inventory', 'backpack', 'extra_info'];

// Порожньо: відсутнє, null, [] (або лише маркери isEmpty), об'єкт із isEmpty: true
function isEmptyChar(val) {
  if (val === undefined || val === null) return true;
  if (Array.isArray(val)) return val.filter(x => x && !x.isEmpty).length === 0;
  return val.isEmpty === true;
}

// Текст маркера-заглушки для жертви крадіжки (Гілка 2). Для професії — окремий напис.
const STEAL_EMPTY_TEXT = { professions: 'Без професії' };

// Маркер-заглушка: зберігає, чи характеристика була відкрита ДО крадіжки,
// щоб UI (player-parser/players-table) знав, показувати «Пусто» одразу чи ховати під замочком.
function emptyMarker(charType, wasRevealed) {
  return [{ isEmpty: true, value: STEAL_EMPTY_TEXT[charType] || 'Пусто', is_revealed: wasRevealed }];
}

// Реальні картки поля (завжди масив, без маркерів порожнечі)
function realCards(val) {
  if (isEmptyChar(val)) return [];
  return Array.isArray(val) ? val.filter(x => x && !x.isEmpty) : [val];
}

// Статус відкриття НАЛЕЖИТЬ СЛОТУ гравця, а не конкретній картці в ньому. Порожній слот
// (нічого немає або лише маркер порожнечі) вважаємо закритим.
function slotRevealed(val) {
  const cards = realCards(val);
  return cards.length ? !!cards[0].is_revealed : false;
}

// Жорстко проставляє переданий статус відкриття (слота) на всі картки значення, ігноруючи
// той is_revealed, який був у самих карток (статус належить слоту, а не картці).
function forceReveal(val, revealed) {
  if (Array.isArray(val)) return val.map(x => ({ ...x, is_revealed: revealed }));
  return { ...val, is_revealed: revealed };
}

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
      victim[charType] = forceReveal(drawCharacteristic(charType, pools), victimWasRevealed);
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
      p.health = [{ disease: 'Ідеально здоровий', severity: null, is_revealed: wasRevealed }];
    } else if (p.health[0].disease !== 'Ідеально здоровий') {
      p.health[0].severity = healAction;
    }
  });

  const targetText = targetId === 'all' ? 'усіх гравців' : `гравця ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий вилікував ${targetText}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

// Картка з тексту, який ведучий ввів вручну: { value, meta: {}, is_revealed: false }.
// Додатково дублюємо текст у поле, яке читає player-parser (title / disease / item),
// щоб картка коректно відобразилась. До БД не звертаємось: стадії залишаємо порожніми.
function buildCustomCard(charCategory, text) {
  const card = { value: text, meta: {}, is_revealed: false };
  switch (charCategory) {
    case 'professions':     return { ...card, title: text, ability: '', stage: '' };
    case 'hobbies':         return { ...card, title: text, stage: '' };
    case 'health':          return { ...card, disease: text, severity: '' };
    case 'backpack':
    case 'large_inventory': return { ...card, item: text };
    default:                return card; // traits, phobias, extra_info читають value
  }
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

  const targetText = targetId === 'all' ? 'усім гравцям' : `гравцю ${nameOf(pState, targetId)}`;
  setHostEvent(bState, `Ведучий додав додаткову характеристику «${labelOf(charCategory)}» ${targetText}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function deleteInventory(roomCode, targetId, actionType) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const bState = room.bunker_state || {};
  const key = actionType === 'backpack' ? 'backpack' : 'large_inventory';

  resolveIds(pState, targetId).forEach(id => {
    if (pState[id]) pState[id][key] = [];
  });

  const targetText = targetId === 'all' ? 'усіх гравців' : `гравця ${nameOf(pState, targetId)}`;
  const itemText = key === 'backpack' ? 'рюкзак' : 'крупний інвентар';
  setHostEvent(bState, `Ведучий видалив ${itemText} у ${targetText}`);

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

// ===== Дії з бункером / кімнатою =====

export async function changeBunker(roomCode, field, customValue) {
  const value = (customValue || '').trim();
  if (!field) throw new Error('Оберіть параметр бункера');
  if (!value) throw new Error('Введіть власне значення');
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  bState[field] = value;
  const fieldLabel = BUNKER_FIELDS.find(f => f.key === field)?.label || field;
  setHostEvent(bState, `Ведучий змінив параметр бункера «${fieldLabel}»`);
  await saveRoom(roomCode, { bunker_state: bState });
}

export async function changeCataclysm(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pools = await loadPools();
  const bState = room.bunker_state || {};
  const card = pickCard(pools.bunker.cataclysm, 'Невідомий катаклізм');
  // Скільки хвилин відведено новому катаклізму на відлік (0/відсутнє — без таймера)
  const timerMinutes = Number(card.meta?.timer_minutes) || 0;
  bState.cataclysm = {
    text: card.value,
    description: card.meta?.description || '',
    timer_minutes: timerMinutes
  };
  // Глобальна мітка кінця відліку в базі даних (мс), щоб таймер був синхронізованим у усіх гравців.
  // Новий катаклізм без власного таймера має скидати стару мітку від попереднього катаклізму, інакше гравці бачили б чужий відлік.
  bState.cataclysm_timer_end = timerMinutes > 0 ? Date.now() + timerMinutes * 60 * 1000 : null;
  setHostEvent(bState, `Ведучий змінив катаклізм: ${card.value}`);
  await saveRoom(roomCode, { bunker_state: bState });
}

export async function setGlobalTimer(roomCode, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Некоректний час таймера');
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  bState.global_timer_seconds = seconds;
  bState.global_timer_end = Date.now() + seconds * 1000;
  bState.timer_paused_left = null; // новий запуск скасовує попередню паузу, якщо вона була
  await saveRoom(roomCode, { bunker_state: bState });
}

// Повністю зупиняє таймер (ховає віджет): і активний відлік, і збережену паузу.
// Увага: кнопки таймера НІКОЛИ не пишуть latest_host_event — він працює автономно і не повинен спамити Toast'ами.
export async function stopGlobalTimer(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  bState.global_timer_end = null;
  bState.timer_paused_left = null;
  await saveRoom(roomCode, { bunker_state: bState });
}

// Перемикач паузи: якщо таймер іде — заморожує залишок у timer_paused_left;
// якщо вже на паузі — відновлює відлік від збереженого залишку.
// Повертає 'paused' або 'resumed', щоб UI показав відповідний тост.
export async function pauseGlobalTimer(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};

  if (bState.global_timer_end) {
    const left = Math.max(0, bState.global_timer_end - Date.now());
    bState.timer_paused_left = left;
    bState.global_timer_end = null;
    await saveRoom(roomCode, { bunker_state: bState });
    return 'paused';
  }

  if (bState.timer_paused_left != null) {
    bState.global_timer_end = Date.now() + bState.timer_paused_left;
    bState.timer_paused_left = null;
    await saveRoom(roomCode, { bunker_state: bState });
    return 'resumed';
  }

  throw new Error('Таймер не запущено');
}

// bunker_state.voting — джерело правди для голосування, спільне для всіх гравців:
//   isActive: boolean — чи триває зараз збір голосів
//   votes:    { "ID_виборця": "ID_кандидата" } — словник відданих голосів
// Стопер-захист: повторний запуск, поки попереднє голосування ще триває, кидає помилку і не чіпає votes.
// Перевірка ДО snapshot(), щоб невдала спроба не затирала точку скасування попередньої дії.
export async function startVoting(roomCode) {
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};

  if (bState.voting?.isActive === true) {
    throw new Error('Голосування вже почате!');
  }

  snapshot(room);
  bState.voting = { isActive: true, votes: {} };
  setHostEvent(bState, 'Ведучий запустив голосування');
  await saveRoom(roomCode, { bunker_state: bState });
}

// Автозавершення голосування: викликається клієнтом ведучого (game.js -> maybeAutoFinishVoting), коли проголосували всі живі.
// Ідемпотентна: якщо голосування вже неактивне — мовчазний но-оп. Свідомо НЕ викликаємо snapshot() —
// це автоматичний системний крок, він не має затирати точку скасування останньої ручної дії ведучого.
// Не пише і latest_host_event — автозавершення по кількості голосів вже видно всім із таблиці результатів, тост тут зайвий.
export async function finishVoting(roomCode) {
  const room = await getRoom(roomCode);
  const bState = room.bunker_state || {};
  if (!bState.voting?.isActive) return;
  bState.voting = { ...bState.voting, isActive: false };
  await saveRoom(roomCode, { bunker_state: bState });
}

export async function changeBunkerCapacity(roomCode, delta) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  const current = Number(bState.capacity) || 1;
  bState.capacity = Math.max(1, current + delta);
  setHostEvent(bState, `Ведучий змінив кількість місць у бункері: ${bState.capacity}`);
  await saveRoom(roomCode, { bunker_state: bState });
  return bState.capacity;
}

// Записує результат у bunker_state.latest_host_event, щоб його бачили всі гравці (Toast), а не лише ведучий
export async function rollDice(roomCode, sides) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const bState = room.bunker_state || {};
  const result = randInt(1, sides);
  setHostEvent(bState, `Ведучий кинув кубик d${sides}. Випало: ${result}`);
  await saveRoom(roomCode, { bunker_state: bState });
  return result;
}

export async function changeHost(roomCode, newHostId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!newHostId || !pState[newHostId]) throw new Error('Гравця не знайдено в кімнаті');
  if (newHostId === room.host_id) throw new Error('Цей гравець уже ведучий');
  snapshot(room);
  const bState = room.bunker_state || {};
  setHostEvent(bState, `Ведучий передав права ведучого гравцю ${nameOf(pState, newHostId)}`);
  await saveRoom(roomCode, { host_id: newHostId, bunker_state: bState });
}

// Вигнати / повернути гравця. Просто інвертує players_state[id].is_kicked — рядок гравця
// лишається в БД (характеристики не губляться), UI лише "сіріє" його (players-table.js / styles.css).
export async function toggleKickPlayer(roomCode, playerId) {
  const room = await getRoom(roomCode);
  const pState = room.players_state || {};
  if (!playerId || !pState[playerId]) throw new Error('Гравця не знайдено в кімнаті');
  snapshot(room);
  const bState = room.bunker_state || {};

  const wasKicked = !!pState[playerId].is_kicked;
  pState[playerId].is_kicked = !wasKicked;

  setHostEvent(bState, wasKicked
    ? `Ведучий повернув гравця ${nameOf(pState, playerId)}`
    : `Ведучий вигнав гравця ${nameOf(pState, playerId)}`);

  await saveRoom(roomCode, { players_state: pState, bunker_state: bState });
}

export async function restartGame(roomCode) {
  const room = await getRoom(roomCode);
  snapshot(room);
  const pState = room.players_state || {};
  const resetPlayers = {};
  Object.entries(pState).forEach(([id, p]) => { resetPlayers[id] = { name: p.name }; });
  await saveRoom(roomCode, { players_state: resetPlayers, bunker_state: {} });
}

export async function closeRoom(roomCode) {
  // Одним атомарним запитом: bunker_state.room_closed сигналізує гравцям у кімнаті (game.js) негайно вийти в лобі,
  // а status: 'closed' — щоб панель перепідключення (lobby.js) назавжди відфільтрувала цю кімнату,
  // навіть якщо сам рядок ніколи не буде видалено з БД. (Раніше тут був окремий .delete() з затримкою —
  // якщо він фактично не відпрацьовував (RLS/мережа), рядок залишався з room_closed:true, але без актуального
  // status — саме це були “кімнати-привиди” RT4A/BHVI в лобі.)
  await saveRoom(roomCode, { bunker_state: { room_closed: true }, status: 'closed' });
  lastSnapshot = null;
}
