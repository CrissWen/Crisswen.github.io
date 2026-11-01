// ===== Стаж професії/хобі у місяцях =====
// Чисті функції без звернень до БД і DOM: їх викликають генератор гри, дії ведучого й відображення картки.
//
// Шкала стадій за місяцями — масив { name, up_to_months }. Джерела:
//   1) власні meta.stages картки (мають пріоритет),
//   2) pack.config.default_stages.profession / .hobby.
// Стадія БЕЗ up_to_months (зазвичай остання) — відкрита верхня: діє для всього стажу понад найбільший поріг.
// Масив рядків — не шкала за місяцями: такі списки лишаються на логіці pickStage (випадкова назва).

import { randInt, pickStage, pickFromStrings } from '../common/random.js';

export const UNKNOWN_STAGE = 'Невідома стадія';
// Вік, з якого може починатися стаж (ранні роки життя без нього): максимум стажу = (вік − цей вік) років у місяцях.
// Реальне значення береться з конфігу балансу (experienceStartAge у game-config.base.js), це лише запасне.
export const DEFAULT_EXPERIENCE_START_AGE = 16;
// Верхня межа місяців, коли вік гравця невідомий (напр. "Без віку" у Кіборга) і в шкалі немає порогів
const FALLBACK_MAX_MONTHS = 480;
// Запас понад останній поріг, коли вік невідомий, а в шкалі є відкрита верхня стадія (щоб вона теж могла випасти)
const OPEN_STAGE_EXTRA_MONTHS = 120;

const hasLimit = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// Один елемент списку стадій → { name, limit } або null. limit — число місяців або null (немає порогу).
function toStageItem(s) {
  if (typeof s === 'string') return s.trim() ? { name: s.trim(), limit: null } : null;
  if (s && typeof s === 'object' && typeof s.name === 'string' && s.name.trim()) {
    return { name: s.name.trim(), limit: hasLimit(s.up_to_months) ? Number(s.up_to_months) : null };
  }
  return null;
}

// Список стадій → шкала за місяцями: стадії з порогом (за зростанням) + одна відкрита верхня (остання без порогу).
// Немає жодного порогу → [] (це не шкала за місяцями). Вихідний список не змінюється.
// Відкрита стадія має up_to_months = Infinity (при збереженні в JSON використовуйте serializeScale).
export function getMonthScale(list) {
  if (!Array.isArray(list)) return [];
  const items = list.map(toStageItem).filter(Boolean);
  const limited = items
    .filter(s => s.limit !== null)
    .map(s => ({ name: s.name, up_to_months: s.limit }))
    .sort((a, b) => a.up_to_months - b.up_to_months);
  if (!limited.length) return [];
  const open = items.filter(s => s.limit === null).pop();
  return open ? [...limited, { name: open.name, up_to_months: Infinity }] : limited;
}

// Шкала для JSON (стан кімнати): Infinity → null
export const serializeScale = scale => scale.map(s => ({
  name: s.name,
  up_to_months: Number.isFinite(s.up_to_months) ? s.up_to_months : null
}));

// Стадії за місяцями для типу ('profession' | 'hobby') із default_stages конфігу
export const getMonthStages = (type, config) => getMonthScale(config?.default_stages?.[type]);

export const hasMonthStages = (type, config) => getMonthStages(type, config).length > 0;

// TODO: використати getStageNames при злитті гілок: stagesTextFromConfig (текст стандартних стадій) існує лише в feature/pack-editor, у game-fix її немає.
// Вона має брати назви через getStageNames (stage.name || stage), інакше об'єкти { name, up_to_months } дадуть [object Object].
// Назви стадій для випадаючих списків (працює і зі старим форматом — масив рядків, і з новим — масив об'єктів)
export function getStageNames(list) {
  if (!Array.isArray(list)) return [];
  return list.map(s => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
}

// Назва стадії для місяців за готовою шкалою: перша стадія, у якої months <= up_to_months.
// Більше за найбільший поріг → остання стадія; 0 → перша. Порожня шкала → UNKNOWN_STAGE.
export function stageNameByMonths(scale, months) {
  if (!scale?.length) return UNKNOWN_STAGE;
  const m = Number.isFinite(Number(months)) ? Math.max(0, Number(months)) : 0;
  const hit = scale.find(s => m <= s.up_to_months);
  return (hit || scale[scale.length - 1]).name;
}

export const getStageNameByMonths = (type, months, config) => stageNameByMonths(getMonthStages(type, config), months);

// Максимум місяців стажу для віку: (вік − startAge) років. null — вік невідомий (не число).
export function maxExperienceMonths(age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  const a = (age === null || age === undefined || age === '') ? NaN : Number(age);
  if (!Number.isFinite(a)) return null;
  return Math.max(0, Math.floor((a - startAge) * 12));
}

// Ціле число місяців стажу від 0 до максимуму за віком для готової шкали.
// Якщо вік невідомий — до найбільшого порогу шкали (+ запас, якщо є відкрита стадія) або до 480.
export function generateMonthsForScale(scale, age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  let max = maxExperienceMonths(age, startAge);
  if (max === null) {
    const finite = (scale || []).map(s => s.up_to_months).filter(Number.isFinite);
    const hasOpen = (scale || []).some(s => s.up_to_months === Infinity);
    max = finite.length ? Math.max(...finite) + (hasOpen ? OPEN_STAGE_EXTRA_MONTHS : 0) : FALLBACK_MAX_MONTHS;
  }
  return randInt(0, Math.max(0, Math.floor(max)));
}

export const generateExperienceMonths = (type, config, age, startAge = DEFAULT_EXPERIENCE_START_AGE) =>
  generateMonthsForScale(getMonthStages(type, config), age, startAge);

// Стадія стажу для нової картки: { stage } (завжди рядок з назвою). Місяці генеруються лише як вхідне число
// для пошуку назви стадії і ніде не зберігаються й не показуються (інакше після ручної зміни стадії
// ведучим залишився б застарілий стаж).
// Для персонажів без віку (age === null / "Без віку") стадія вибирається просто випадково з доступного списку,
// без прив'язки до штучних підрахунків місяців.
// Порядок джерел:
//   1) у картки є meta.stages з порогами up_to_months → шкала картки за місяцями (або випадкова зі списку, якщо без віку);
//   2) у картки є meta.stages без порогів (рядки) → випадкова назва з них (pickStage);
//   3) інакше, якщо в конфігу є шкала за місяцями → вона (або випадкова зі списку, якщо без віку);
//   4) інакше pickStage за default_stages.
export function rollExperience(type, card, config, age, startAge = DEFAULT_EXPERIENCE_START_AGE) {
  const isAgeKnown = age !== null && age !== undefined && age !== '' && Number.isFinite(Number(age));
  const cardStages = card?.meta?.stages;
  const hasCardStages = Array.isArray(cardStages) && cardStages.length > 0;

  if (hasCardStages) {
    const cardScale = getMonthScale(cardStages);
    if (cardScale.length) {
      const stageName = isAgeKnown
        ? stageNameByMonths(cardScale, generateMonthsForScale(cardScale, age, startAge))
        : pickFromStrings(cardScale.map(s => s.name), UNKNOWN_STAGE);
      return {
        stage: stageName,
        custom_scale: serializeScale(cardScale)
      };
    }
    return { stage: pickStage(card || {}, config?.default_stages?.[type]) };
  }

  const defaultScale = getMonthStages(type, config);
  if (defaultScale.length) {
    const stageName = isAgeKnown
      ? stageNameByMonths(defaultScale, generateMonthsForScale(defaultScale, age, startAge))
      : pickFromStrings(defaultScale.map(s => s.name), UNKNOWN_STAGE);
    return { stage: stageName };
  }
  return { stage: pickStage(card || {}, config?.default_stages?.[type]) };
}

// ===== Підказка до шкали стадій (tooltip у заголовку таблиці) =====

// Тривалість у родовому відмінку (використовується після «до», «від», «понад»):
// 1 → "1 місяця", 3 → "3 місяців", 12 → "1 року", 24 → "2 років", 18 → "18 місяців"
export function formatMonths(months) {
  const m = Math.round(Number(months) || 0);
  const isOne = n => n % 10 === 1 && n % 100 !== 11;
  if (m >= 12 && m % 12 === 0) {
    const y = m / 12;
    return `${y} ${isOne(y) ? 'року' : 'років'}`;
  }
  return `${m} ${isOne(m) ? 'місяця' : 'місяців'}`;
}

// Шкала (getMonthScale або serializeScale) → рядки підказки:
// "Новачок – до 3 місяців", "Стажер – від 3 місяців до 1 року", "Майстер – понад 10 років"
export function describeScale(scale) {
  const lines = [];
  let prev = null;
  (scale || []).forEach(s => {
    const limit = Number.isFinite(Number(s.up_to_months)) && s.up_to_months !== null ? Number(s.up_to_months) : null;
    if (limit === null) lines.push(prev === null ? s.name : `${s.name} – понад ${formatMonths(prev)}`);
    else lines.push(prev === null
      ? `${s.name} – до ${formatMonths(limit)}`
      : `${s.name} – від ${formatMonths(prev)} до ${formatMonths(limit)}`);
    if (limit !== null) prev = limit;
  });
  return lines;
}
