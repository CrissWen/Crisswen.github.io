import { shuffleArray } from './host/random.js';
import { ALL_PACK_CATEGORIES } from './pack-categories.js';

// ===== Фолбек карток: добір із дефолтного пака, коли в особистому їх не вистачає =====
// Чисті функції без БД і DOM. Формат пулів — як у host/card-pools.js:
//   { bunker: { [category]: [{ value, meta }] }, character: { [category]: [...] }, config: {...} }

// Скільки карток кожної категорії потрібно для роздачі на playersCount гравців.
//  • Категорії-колоди (game-generator.js: decks) роздаються без повторів — одна картка на гравця;
//    спец. можливостей по дві на гравця.
//  • gender / body_type / health гра тягне з повторами, тому для старту їй достатньо хоча б однієї картки;
//    автор пака не отримує «чужих» статей чи хвороб без потреби.
//  • Бункер: по одній картці (катаклізм, історія, кімнати, локація) і стільки предметів, скільки гра може показати.
// problems та food_supply — необов'язкові: коли їх немає, гра сама ставить «Відсутня» / не додає примітку.
export function buildRequirements(playersCount, bc) {
  const n = Math.max(1, playersCount);
  return {
    character: {
      profession: n,
      hobby: n,
      phobia: n,
      trait: n,
      backpack: n,
      large_inventory: n,
      extra_info: n,
      special_ability: n * 2,
      gender: 1,
      body_type: 1,
      health: 1
    },
    bunker: {
      cataclysm: 1,
      history: 1,
      rooms_description: 1,
      location: 1,
      items: Math.max(1, Number(bc?.bunkerItemsCount?.max) || 1)
    }
  };
}

// Мінімум для дій ведучого посеред гри (перерол однієї картки): щоб жодна категорія не лишилась порожньою
export function buildMinimalRequirements() {
  const one = {};
  const req = buildRequirements(1, null);
  for (const poolType of ['character', 'bunker']) {
    one[poolType] = Object.fromEntries(Object.keys(req[poolType]).map(category => [category, 1]));
  }
  return one;
}

const normalize = value => String(value ?? '').trim().toLowerCase();
const isBlank = v => v == null || (Array.isArray(v) && v.length === 0);

// Конфіг пака (діапазони віку/зросту, стадії) гра читає без перевірок, тому прогалини в особистому паку
// закриваємо значеннями дефолтного. default_stages зливаємо по ключах, а не цілим об'єктом.
export function mergeConfigs(packConfig, defaultConfig) {
  const own = packConfig || {};
  const base = defaultConfig || {};
  const merged = { ...base };
  for (const [key, value] of Object.entries(own)) {
    if (!isBlank(value)) merged[key] = value;
  }
  const stages = { ...(base.default_stages || {}) };
  for (const [key, value] of Object.entries(own.default_stages || {})) {
    if (!isBlank(value)) stages[key] = value;
  }
  merged.default_stages = stages;
  return merged;
}

// Повертає НОВІ пули (вхідні не змінюються) і список того, що було додано:
//   added: [{ poolType, category, count }]
// Для кожної категорії з requirements, де карток менше за потрібне, добирає відсутню кількість випадкових карток
// дефолтного пака, пропускаючи ті, чий текст уже є в особистому паку (без урахування регістру).
// Якщо в дефолтному паку теж не вистачає — додає скільки є: далі гра сама підставить заглушку.
export function applyDefaultFallback(packPools, defaultPools, requirements) {
  const result = {
    bunker: {},
    character: {},
    config: mergeConfigs(packPools?.config, defaultPools?.config)
  };
  const added = [];

  for (const poolType of ['bunker', 'character']) {
    for (const [category, cards] of Object.entries(packPools?.[poolType] || {})) {
      result[poolType][category] = [...cards];
    }

    for (const [category, need] of Object.entries(requirements?.[poolType] || {})) {
      const current = result[poolType][category] || [];
      const missing = need - current.length;
      if (missing <= 0) continue;

      const taken = new Set(current.map(card => normalize(card.value)));
      const candidates = (defaultPools?.[poolType]?.[category] || []).filter(card => !taken.has(normalize(card.value)));
      const extra = shuffleArray(candidates).slice(0, missing);
      if (extra.length === 0) continue;

      result[poolType][category] = [...current, ...extra];
      added.push({ poolType, category, count: extra.length });
    }
  }

  return { pools: result, added };
}

// «Фобія +3, Хобі +2» — коротка підсумкова фраза для логу подій
export function describeFallback(added) {
  const labelOf = Object.fromEntries(ALL_PACK_CATEGORIES.map(c => [`${c.poolType}:${c.category}`, c.label]));
  return added
    .map(a => `${labelOf[`${a.poolType}:${a.category}`] || a.category} +${a.count}`)
    .join(', ');
}
