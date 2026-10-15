import { getGameConfigSync } from '../../config/config-manager.js';
import { CHAR_TYPE_MAP, STEAL_EMPTY_TEXT } from './constants.js';
import { randInt, pickCard, pickStage, generateHeight } from '../random.js';
import { rollExperience } from '../experience.js';

// ===== Генерація карток характеристик (без звернень до БД) =====

// ctx.age — вік гравця, якому видається картка: він обмежує стаж професії/хобі у місяцях (без віку — без обмеження за віком).
export function drawCharacteristic(charType, pools, ctx = {}) {
  const meta = CHAR_TYPE_MAP[charType];
  if (!meta) throw new Error('Невідомий тип характеристики: ' + charType);

  const card = pickCard(pools.character[meta.category]);
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
export function rerollGenderAndAge(player, pools, excludeCurrent = false, updateAge = true) {
  const all = pools.character.gender || [];
  const others = excludeCurrent ? all.filter(c => c.value !== player.gender?.value) : all;
  const card = pickCard(others.length ? others : all, 'Стать невідома');
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
    player.age = { value: generateAge(card, pools.config), is_revealed: wasRevealed };
  }
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
