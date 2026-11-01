import { shuffleArray } from '../common/random.js';
import { ALL_PACK_CATEGORIES } from '../../pack-editor/categories.js';

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

// ===== Пороги для вікна «Пак збережено» у редакторі =====
// Це РЕКОМЕНДОВАНИЙ мінімум для пака, а не потреба гри: buildRequirements (вище) лишається правдою для добору карток з дефолтного пака.
// Категорії гравця — по 30 карток (крім статури — 1), стать — 2; категорії бункера — по 1, предмети бункера — базова потреба гри + 5.
// problems / food_supply для гри необов'язкові (buildRequirements їх не вимагає), але для пака рекомендуємо мінімум 1 картку.
export const PACK_MIN_CHARACTER_CARDS = 30;
export const PACK_MIN_GENDER_CARDS = 2;
export const PACK_BUNKER_EXTRA_CARDS = 5;

export function buildPackNoticeRequirements(bc) {
  const base = buildRequirements(1, bc); // 1 гравець: беремо лише базову кількість для бункера (катаклізм, історія, кімнати, локація, предмети)
  const character = Object.fromEntries(
    Object.keys(base.character).map(category => [category, PACK_MIN_CHARACTER_CARDS])
  );
  character.gender = PACK_MIN_GENDER_CARDS;
  character.body_type = 1; // статура: гра тягне її з повторами, тому вистачить однієї
  const bunker = Object.fromEntries(
    // Бункерні характеристики (катаклізм, історія, кімнати, локація) — мінімум 1; лише предмети бункера лишаються з запасом +5
    Object.entries(base.bunker).map(([category, need]) => [category, category === 'items' ? need + PACK_BUNKER_EXTRA_CARDS : need])
  );
  bunker.problems = 1;    // проблема бункера
  bunker.food_supply = 1; // примітка до запасів їжі/води
  return { character, bunker };
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

// Категорії, де власних карток менше рекомендованого мінімуму пака (buildPackNoticeRequirements: 30 / стать 2 / бункер +5).
// cards — рядки { pool_type, category } (buildCardRows). Не залежить від кількості гравців: добір з дефолтного пака працює
// за реальними потребами гри (buildRequirements), а ця підказка лише радить набрати більше карток.
// Повертає [{ poolType, category, label, have, need }] у порядку редактора.
export function findShortCategories(cards, bc) {
  const counts = {};
  for (const card of cards || []) {
    counts[card.category] = (counts[card.category] || 0) + 1;
  }
  return findShortByCounts(counts, bc);
}

// Те саме, але за готовими лічильниками { [category]: кількість } — для іконок «мало карток» у редакторі (вони рахують лічильники наживо).
// Єдина логіка порогів для вікна при збереженні та для іконок, щоб вони не розходились.
export function findShortByCounts(counts, bc) {
  const req = buildPackNoticeRequirements(bc);
  const short = [];
  for (const { poolType, category, label } of ALL_PACK_CATEGORIES) {
    const need = req[poolType]?.[category];
    if (!need) continue;
    const count = counts?.[category] || 0;
    if (count < need) short.push({ poolType, category, label, have: count, need });
  }
  return short;
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
