/**
 * Модуль автоматичного семантичного підбору іконки катаклізму.
 * Аналізує назву та опис катастрофи, зіставляючи їх із тегами каталогу CATASTROPHE_ICONS.
 */

import { CATASTROPHE_ICONS, CATASTROPHE_ICONS_LIST } from '../../constants/icons.js';

const MIN_SCORE = 3.0;

// Загальні стоп-теги, які зустрічаються в будь-яких катаклізмах і не вказують на конкретний тип загрози
const GENERIC_STOP_TAGS = new Set([
  'катастроф',
  'апокаліпсис',
  'небезпек',
  'загроз',
  'знак',
  'сектор',
  'сигнал'
]);

// Загальні прийменники, сполучники та службові слова української мови
const STOP_WORDS = new Set([
  'і', 'й', 'та', 'або', 'чи', 'не', 'ні', 'на', 'в', 'у', 'до', 'за',
  'під', 'від', 'по', 'із', 'зі', 'над', 'при', 'що', 'як', 'це', 'щось',
  'хтось', 'де', 'для', 'про', 'через', 'всі', 'весь', 'всього'
]);

/**
 * Нормалізує текст для семантичного аналізу
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Перевіряє, чи слово в тексті відповідає тегу (основі слова):
 * - для ультракоротких тегів (<= 3 літер, наприклад "ші", "нло", "лід") вимагається точний збіг або початок слова
 * - для основ слів (> 3 літер) перевіряється входження основи в слово (наприклад, "андроїди".includes("андроїд"))
 * @param {string} word
 * @param {string} tag
 * @returns {boolean}
 */
function matchesWordTag(word, tag) {
  if (!word || !tag) return false;
  if (tag.length <= 3) {
    return word === tag || word.startsWith(tag);
  }
  return word.includes(tag);
}

/**
 * Перевіряє, чи багатослівна фраза (наприклад, "живі мерці") присутня у тексті
 * з урахуванням відмінкових закінчень української мови (наприклад, "живих мерців")
 * @param {string} text
 * @param {string} phrase
 * @returns {boolean}
 */
function matchesPhrase(text, phrase) {
  const parts = phrase.split(' ');
  return parts.every(p => text.includes(p.length > 3 ? p.slice(0, -1) : p));
}

/**
 * Повертає дефолтну структуру для іконки небезпеки (HAZARD)
 * @param {number} [score=0]
 */
function defaultHazardResult(score = 0) {
  const def = CATASTROPHE_ICONS.HAZARD;
  return {
    path: def.path,
    id: def.id,
    label: def.label,
    category: def.category,
    frame: def.frame || 'circle',
    score
  };
}

/**
 * Визначає найкращу відповідну іконку для катаклізму за його назвою та описом.
 * @param {string} title - Назва катастрофи (наприклад, "Зомбі-апокаліпсис")
 * @param {string} [description=""] - Опис наслідків чи умов катастрофи
 * @returns {{ path: string, id: string, label: string, category: string, frame: string, score: number }}
 */
export function detectCataclysm(title, description = '') {
  const normTitle = normalizeText(title);
  const normDesc = normalizeText(description);
  const fullText = `${normTitle} ${normDesc}`.trim();

  if (!fullText) {
    return defaultHazardResult(0);
  }

  const titleWords = normTitle
    .split(/[\s-]+/)
    .filter(w => w && !STOP_WORDS.has(w));
  const descWords = normDesc
    .split(/[\s-]+/)
    .filter(w => w && !STOP_WORDS.has(w));

  let bestIcon = null;
  let maxScore = 0;
  let maxTitleMatches = 0;

  for (const icon of CATASTROPHE_ICONS_LIST) {
    if (!Array.isArray(icon.tags) || icon.tags.length === 0) continue;

    let score = 0;
    let titleMatches = 0;
    let descMatches = 0;

    for (const tag of icon.tags) {
      const normTag = normalizeText(tag);
      if (!normTag || GENERIC_STOP_TAGS.has(normTag)) continue;

      // Багатослівні фрази ("живі мерці", "вічна мерзлота") з відмінковими формами
      if (normTag.includes(' ')) {
        if (matchesPhrase(normTitle, normTag)) {
          score += 8.0;
          titleMatches += 2;
          continue;
        }
        if (matchesPhrase(normDesc, normTag)) {
          score += 4.5;
          descMatches += 1;
          continue;
        }
      }

      // Перевірка слів назви (вага x4.0, для першого слова назви як головного суб'єкта — x6.0)
      const titleIndex = titleWords.findIndex(w => matchesWordTag(w, normTag));
      if (titleIndex !== -1) {
        score += titleIndex === 0 ? 6.0 : 4.0;
        titleMatches += 1;
        continue;
      }

      // Перевірка слів опису (вага x1.5)
      const matchedDesc = descWords.some(w => matchesWordTag(w, normTag));
      if (matchedDesc) {
        score += 1.5;
        descMatches += 1;
      }
    }

    // Тематична когерентність: якщо тема підтверджена І в назві, І в описі — додатковий бонус
    if (titleMatches > 0 && descMatches > 0) {
      score += 3.0;
    }

    // Порівняння результатів із тай-брейкінгом
    if (score > maxScore) {
      maxScore = score;
      maxTitleMatches = titleMatches;
      bestIcon = icon;
    } else if (score === maxScore && score > 0) {
      if (titleMatches > maxTitleMatches) {
        maxScore = score;
        maxTitleMatches = titleMatches;
        bestIcon = icon;
      }
    }
  }

  if (maxScore >= MIN_SCORE && bestIcon) {
    return {
      path: bestIcon.path,
      id: bestIcon.id,
      label: bestIcon.label,
      category: bestIcon.category,
      frame: bestIcon.frame || 'circle',
      score: maxScore
    };
  }

  return defaultHazardResult(maxScore);
}

/**
 * Спрощений хелпер: повертає безпосередньо шлях до SVG-іконки.
 * @param {string} title
 * @param {string} [description=""]
 * @returns {string}
 */
export function detectCataclysmIcon(title, description = '') {
  return detectCataclysm(title, description).path;
}
