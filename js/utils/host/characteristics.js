import { getGameConfigSync } from '../../config/config-manager.js';
import { CHAR_TYPE_MAP, STEAL_EMPTY_TEXT } from './constants.js';
import { randInt, pickCard, pickStage, generateHeight } from '../common/random.js';
import { rollExperience } from '../auth/experience.js';

// ===== Генерація карток характеристик (без звернень до БД) =====

const normalizeVal = v => String(v ?? '').trim().toLowerCase();

// Витягує текстові значення карток певної характеристики з одного запису гравця
function extractPlayerCardValues(charType, rawVal) {
  if (isEmptyChar(rawVal)) return [];
  const items = realCards(rawVal);
  switch (charType) {
    case 'gender':            return items.map(x => x.value);
    case 'body':              return items.map(x => x.type);
    case 'professions':
    case 'hobbies':           return items.map(x => x.title ?? x.value);
    case 'health':            return items.map(x => x.disease ?? x.value);
    case 'backpack':
    case 'large_inventory':   return items.map(x => x.item ?? x.value);
    case 'special_abilities': return items.map(x => x.text ?? x.value);
    default:                  return items.map(x => x.value);
  }
}

// Збирає множину вже зайнятих карток (у нижньому регістрі) по всіх гравцях у кімнаті.
// excludePlayerIds (необов'язково) — масив або Set ID гравців, чиї старі картки зараз замінюються,
// якщо ми хочемо виключити або навпаки врахувати їх (за замовчуванням враховуємо ВСІХ гравців,
// щоб гравець при реролі також гарантовано не отримав ту саму картку назад).
export function collectUsedValues(pState, charType) {
  const used = new Set();
  for (const player of Object.values(pState || {})) {
    if (!player) continue;
    for (const val of extractPlayerCardValues(charType, player[charType])) {
      const norm = normalizeVal(val);
      if (norm) used.add(norm);
    }
  }
  return used;
}

// Обирає картку з дотриманням пріоритету паків і правила унікальності:
// 1. Вільні (ще ні в кого не задіяні) картки з основного (кастомного) пака.
// 2. Якщо в кастомному вільних не лишилось — вільні картки з базового (fallback) пака.
// 3. Якщо і в базовому всі зайняті — будь-яка картка з кастомного (або базового), окрім тих, що вже є в usedSet (якщо можливо).
export function pickUniqueFromPools(primaryList, fallbackList, usedSet, fallbackText = 'Немає даних') {
  const primary = Array.isArray(primaryList) ? primaryList : [];
  const base = Array.isArray(fallbackList) ? fallbackList : [];

  if (usedSet) {
    const availPrimary = primary.filter(c => !usedSet.has(normalizeVal(c.value)));
    if (availPrimary.length > 0) {
      const picked = pickCard(availPrimary, fallbackText);
      usedSet.add(normalizeVal(picked.value));
      return picked;
    }

    const availBase = base.filter(c => !usedSet.has(normalizeVal(c.value)));
    if (availBase.length > 0) {
      const picked = pickCard(availBase, fallbackText);
      usedSet.add(normalizeVal(picked.value));
      return picked;
    }
  }

  // Якщо usedSet не передано або абсолютно всі картки обох паків уже на руках у гравців
  const combined = primary.length > 0 ? primary : base;
  const picked = pickCard(combined, fallbackText);
  if (usedSet && picked?.value) usedSet.add(normalizeVal(picked.value));
  return picked;
}

// Категорії, які за правилами гри тягнуться з повторами і не добирають чужих варіантів з базового пака,
// якщо у кастомному паку є хоча б один варіант (як і на старті гри в pack-fallback.js: gender / body_type).
const REPEATABLE_CHAR_TYPES = new Set(['gender', 'body']);

// ctx.age — вік гравця, якому видається картка: він обмежує стаж професії/хобі у місяцях (без віку — без обмеження за віком).
// ctx.usedValues — Set уже зайнятих значень у поточній грі (оновлюється на місці при кожній видачі, щоб серія видач «Для всіх» теж не повторювалась).
export function drawCharacteristic(charType, pools, ctx = {}) {
  const meta = CHAR_TYPE_MAP[charType];
  if (!meta) throw new Error('Невідомий тип характеристики: ' + charType);

  const primaryList = pools.character?.[meta.category] || [];
  const fallbackList = charType === 'gender'
    ? []
    : (pools.fallback?.character?.[meta.category] || []);
  const usedSet = REPEATABLE_CHAR_TYPES.has(charType)
    ? (ctx.currentValue ? new Set([normalizeVal(ctx.currentValue)]) : null)
    : ctx.usedValues;

  const card = pickUniqueFromPools(primaryList, fallbackList, usedSet);
  const defaultStages = pools.config?.default_stages?.[meta.stagesKey];
  const startAge = getGameConfigSync().experienceStartAge;

  switch (charType) {
    case 'gender':
      return { value: card.value, is_revealed: false };
    case 'body':
      // Зріст перераховується за meta нової статури (так само, як при старті гри)
      return {
        type: card.value,
        height_cm: generateHeight(card.meta, pools.config?.height_range),
        is_revealed: false
      };
    case 'professions':
      return [{ title: card.value, ability: card.meta?.ability || '', ...rollExperience('profession', card, pools.config, ctx.age, startAge), is_revealed: false }];
    case 'hobbies':
      return [{ title: card.value, description: card.meta?.description || '', ability: card.meta?.ability || '', ...rollExperience('hobby', card, pools.config, ctx.age, startAge), is_revealed: false }];
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
      // У грі завжди 2 спец. можливості, тому при заміні тягнемо дві (друга теж не повторює першу та чужі)
      const localUsed = usedSet || new Set([normalizeVal(card.value)]);
      const second = pickUniqueFromPools(primaryList, fallbackList, localUsed);
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
export function withReveal(oldVal, newVal) {
  const wasRevealed = Array.isArray(oldVal) ? !!oldVal[0]?.is_revealed : !!oldVal?.is_revealed;
  if (Array.isArray(newVal)) return newVal.map(x => ({ ...x, is_revealed: wasRevealed }));
  return { ...newVal, is_revealed: wasRevealed };
}

// Вік для нової статі: якщо в meta статі є custom_age чи has_no_age — беремо його,
// якщо є власний діапазон — беремо з нього, інакше з глобального config.age_range.
export function generateAge(genderCard, config) {
  const meta = genderCard?.meta || {};
  if (meta.has_no_age === true || meta.custom_age_mode === 'no_age') {
    return meta.custom_age || 'Без віку';
  }
  if (meta.custom_age && !meta.range && !meta.age_range && !meta.age_min && !meta.age_max) {
    return meta.custom_age;
  }
  const range = config?.age_range || getGameConfigSync().defaultAgeRange;
  const min = meta.range?.min ?? meta.age_range?.min ?? meta.age_min ?? range.min;
  const max = meta.range?.max ?? meta.age_range?.max ?? meta.age_max ?? range.max;
  return randInt(Math.min(min, max), Math.max(min, max));
}

// Нова стать і новий вік одним махом. Обидва поля успадковують стан "відкрито/закрито" старої статі
// (game.js також розкриває/ховає age разом із gender). excludeCurrent — не випадати тій самій статі.
export function rerollGenderAndAge(player, pools, excludeCurrent = true, updateAge = true) {
  const all = pools.character?.gender || [];
  const currentVal = normalizeVal(player.gender?.value);
  let candidates = excludeCurrent && currentVal
    ? all.filter(c => normalizeVal(c.value) !== currentVal)
    : all;

  if (candidates.length === 0 && pools.fallback?.character?.gender) {
    const fallbackAll = pools.fallback.character.gender;
    candidates = excludeCurrent && currentVal
      ? fallbackAll.filter(c => normalizeVal(c.value) !== currentVal)
      : fallbackAll;
  }

  const card = pickCard(candidates.length ? candidates : all, 'Стать невідома');
  applyGenderCard(player, card, pools?.config, updateAge);
}

// Виставляє конкретну (обрану ведучим) стать і перегенеровує вік під неї (як у rerollGenderAndAge, але без випадкового вибору).
// Стан "відкрито/закрито" старої статі успадковують і стать, і вік.
export function applyGenderCard(player, card, config, updateAge = true) {
  const wasRevealed = !!player.gender?.is_revealed;
  const genderObj = { value: card.value, is_revealed: wasRevealed };
  if (card.meta?.has_no_age === true || card.meta?.custom_age_mode === 'no_age') {
    genderObj.has_no_age = true;
  }
  if (Array.isArray(card.meta?.stages) && card.meta.stages.length > 0) {
    genderObj.custom_stages = card.meta.stages;
  }

  player.gender = genderObj;
  if (updateAge) {
    player.age = { value: generateAge(card, config), is_revealed: wasRevealed };
  }
}

// Картка з тексту, який ведучий ввів вручну: { value, meta: {}, is_revealed: false }.
// Додатково дублюємо текст у поле, яке читає player-parser (title / disease / item),
// щоб картка коректно відобразилась. До БД не звертаємось: стадії залишаємо порожніми.
export function buildCustomCard(charCategory, text) {
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

// ===== «Слоти» характеристик: порожні картки та статус відкриття =====
// Статус відкриття НАЛЕЖИТЬ слоту гравця, а не конкретній картці в ньому.

// Порожньо: відсутнє, null, [] (або лише маркери isEmpty), об'єкт із isEmpty: true
export function isEmptyChar(val) {
  if (val === undefined || val === null) return true;
  if (Array.isArray(val)) return val.filter(x => x && !x.isEmpty).length === 0;
  return val.isEmpty === true;
}

// Маркер-заглушка: зберігає, чи характеристика була відкрита ДО видалення/крадіжки,
// щоб UI (player-parser/players-table) знав, показувати «Пусто» одразу чи ховати під замочком.
export function emptyMarker(charType, wasRevealed) {
  return [{ isEmpty: true, value: STEAL_EMPTY_TEXT[charType] || 'Пусто', is_revealed: wasRevealed }];
}

// Реальні картки поля (завжди масив, без маркерів порожнечі)
export function realCards(val) {
  if (isEmptyChar(val)) return [];
  return Array.isArray(val) ? val.filter(x => x && !x.isEmpty) : [val];
}

// Статус відкриття слота. Порожній слот (нічого немає або лише маркер порожнечі) вважаємо закритим.
export function slotRevealed(val) {
  const cards = realCards(val);
  return cards.length ? !!cards[0].is_revealed : false;
}

// Жорстко проставляє переданий статус відкриття (слота) на всі картки значення, ігноруючи
// той is_revealed, який був у самих карток (статус належить слоту, а не картці).
export function forceReveal(val, revealed) {
  if (Array.isArray(val)) return val.map(x => ({ ...x, is_revealed: revealed }));
  return { ...val, is_revealed: revealed };
}
