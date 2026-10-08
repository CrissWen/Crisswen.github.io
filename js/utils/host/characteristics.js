import { getGameConfigSync } from '../../config/config-manager.js';
import { CHAR_TYPE_MAP, STEAL_EMPTY_TEXT } from './constants.js';
import { randInt, pickCard, pickStage, pickFromStrings } from '../random.js';

// ===== Генерація карток характеристик (без звернень до БД) =====

export function drawCharacteristic(charType, pools) {
  const meta = CHAR_TYPE_MAP[charType];
  if (!meta) throw new Error('Невідомий тип характеристики: ' + charType);

  const card = pickCard(pools.character[meta.category]);
  const defaultStages = pools.config?.default_stages?.[meta.stagesKey];

  switch (charType) {
    case 'gender':
      return { value: card.value, is_revealed: false };
    case 'body': {
      let bodyTypeVal = card.value;
      let heightVal = null;
      let hasNoHeight = false;

      if (pools.character.body_type && pools.character.body_type.length > 0) {
        bodyTypeVal = card.value;
        hasNoHeight = card.meta?.has_no_height;
      } else if (pools.config?.default_stages?.body_type) {
        bodyTypeVal = pickFromStrings(pools.config.default_stages.body_type, card.value);
      }

      if (!hasNoHeight) {
        if (card.meta?.exact_height) {
          heightVal = Number(card.meta.exact_height) || card.meta.exact_height;
        } else if (card.meta?.custom_height_mode === 'range') {
          const min = card.meta.height_min ?? pools.config?.height_range?.min ?? 150;
          const max = card.meta.height_max ?? pools.config?.height_range?.max ?? 210;
          heightVal = randInt(min, max);
        } else {
          const min = pools.config?.height_range?.min ?? 150;
          const max = pools.config?.height_range?.max ?? 210;
          heightVal = randInt(min, max);
        }
      }

      return {
        type: bodyTypeVal,
        height_cm: heightVal,
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
export function withReveal(oldVal, newVal) {
  const wasRevealed = Array.isArray(oldVal) ? !!oldVal[0]?.is_revealed : !!oldVal?.is_revealed;
  if (Array.isArray(newVal)) return newVal.map(x => ({ ...x, is_revealed: wasRevealed }));
  return { ...newVal, is_revealed: wasRevealed };
}

// Вік для нової статі: якщо в meta статі є custom_age (напр. "Без віку" у Кіборга) — беремо його,
// інакше випадкове число в межах config.age_range пака (або defaultAgeRange з конфігу балансу, якщо у пака діапазону немає).
function generateAge(genderCard, config) {
  const custom = genderCard?.meta?.custom_age;
  if (custom) return custom;
  const range = config?.age_range || getGameConfigSync().defaultAgeRange;
  return randInt(range.min, range.max);
}

// Нова стать і новий вік одним махом. Обидва поля успадковують стан "відкрито/закрито" старої статі
// (game.js також розкриває/ховає age разом із gender). excludeCurrent — не випадати тій самій статі.
export function rerollGenderAndAge(player, pools, excludeCurrent = false) {
  const all = pools.character.gender || [];
  const others = excludeCurrent ? all.filter(c => c.value !== player.gender?.value) : all;
  const card = pickCard(others.length ? others : all, 'Стать невідома');
  const wasRevealed = !!player.gender?.is_revealed;

  player.gender = { value: card.value, is_revealed: wasRevealed };
  player.age = { value: generateAge(card, pools.config), is_revealed: wasRevealed };
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
