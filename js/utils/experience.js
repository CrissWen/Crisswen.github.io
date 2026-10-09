// ===== Стаж професії/хобі у місяцях =====
// Чисті функції без звернень до БД і DOM: їх викликають генератор гри, дії ведучого й відображення картки.
//
// Конфіг: pack.config.default_stages.profession / .hobby — масив { name, up_to_months }, відсортований за up_to_months.
// Старий формат (масив рядків) тут не вважається "стадіями за місяцями": такі списки лишаються на старій логіці pickStage.

import { randInt, pickStage } from './random.js';

export const UNKNOWN_STAGE = 'Невідома стадія';
// Вік, з якого може починатися стаж (ранні роки життя без нього): максимум стажу = (вік − цей вік) років у місяцях.
// Реальне значення береться з конфігу балансу (experienceStartAge у game-config.base.js), це лише запасне.
export const DEFAULT_EXPERIENCE_START_AGE = 16;
// Верхня межа місяців, коли вік гравця невідомий (напр. "Без віку" у Кіборга) і в конфігу немає порогів
const FALLBACK_MAX_MONTHS = 480;

const isMonthStage = s =>
  s !== null && typeof s === 'object' &&
  typeof s.name === 'string' && s.name !== '' &&
  s.up_to_months !== null && s.up_to_months !== '' && Number.isFinite(Number(s.up_to_months));

// Стадії за місяцями для типу ('profession' | 'hobby'): лише валідні об'єкти, як копія, відсортована за зростанням.
// Сортування захищає від неправильного порядку в JSON, вихідний конфіг не змінюється.
export function getMonthStages(type, config) {
  const list = config?.default_stages?.[type];
  if (!Array.isArray(list)) return [];
  return list
    .filter(isMonthStage)
    .map(s => ({ name: s.name, up_to_months: Number(s.up_to_months) }))
    .sort((a, b) => a.up_to_months - b.up_to_months);
}

export const hasMonthStages = (type, config) => getMonthStages(type, config).length > 0;

// Назви стадій для випадаючих списків (працює і зі старим форматом — масив рядків, і з новим — масив об'єктів)
export function getStageNames(list) {
  if (!Array.isArray(list)) return [];
  return list.map(s => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
}

// Назва стадії за місяцями: перша стадія, у якої months <= up_to_months.
// Більше за найбільший поріг → остання стадія; 0 → перша. Немає стадій → UNKNOWN_STAGE.
export function getStageNameByMonths(type, months, config) {
  const stages = getMonthStages(type, config);
  if (!stages.length) return UNKNOWN_STAGE;
  const m = Number.isFinite(Number(months)) ? Math.max(0, Number(months)) : 0;
  const hit = stages.find(s => m <= s.up_to_months);
  return (hit || stages[stages.length - 1]).name;
}

// Максимум місяців стажу для віку: (вік − startAge) років. null — вік невідомий (не число).
export function maxExperienceMonths(age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  const a = (age === null || age === undefined || age === '') ? NaN : Number(age);
  if (!Number.isFinite(a)) return null;
  return Math.max(0, Math.floor((a - startAge) * 12));
}

// Ціле число місяців стажу від 0 до максимуму за віком. Якщо вік невідомий — до найбільшого порогу конфігу (або 480).
export function generateExperienceMonths(type, config, age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  let max = maxExperienceMonths(age, startAge);
  if (max === null) {
    const stages = getMonthStages(type, config);
    max = stages.length ? stages[stages.length - 1].up_to_months : FALLBACK_MAX_MONTHS;
  }
  return randInt(0, Math.max(0, Math.floor(max)));
}

// Стадія стажу для нової картки: { stage }. Місяці генеруються лише як вхідне число для пошуку назви стадії
// і ніде не зберігаються й не показуються (інакше після ручної зміни стадії ведучим залишився би застарілий стаж).
// Якщо в картки є власні meta.stages або в конфігу немає стадій за місяцями — стара логіка pickStage.
export function rollExperience(type, card, config, age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  const hasCardStages = !!card?.meta?.stages?.length;
  if (!hasCardStages && hasMonthStages(type, config)) {
    const months = generateExperienceMonths(type, config, age, startAge);
    return { stage: getStageNameByMonths(type, months, config) };
  }
  return { stage: pickStage(card || {}, config?.default_stages?.[type]) };
}
