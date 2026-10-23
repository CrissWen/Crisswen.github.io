// ===== Модуль безпеки: екранування, очищення, захист від XSS та валідація =====

/**
 * Канонічне екранування HTML перед вставкою в розмітку (innerHTML або HTML-атрибути).
 * Екранує: &, <, >, ", '
 */
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/**
 * Нормалізація апострофа: усуває артефакти подвійного екранування (&#39;, &amp;#39;, &apos;)
 * повертаючи чистий звичайний апостроф (') для коректного відображення у текстах.
 */
export function unescapeApos(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&amp;#39;|&amp;apos;/gi, "'")
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Очищення від недрукованих керуючих символів ASCII (null-байти тощо),
 * зберігаючи при цьому звичайні пробіли, табуляції та переноси рядків.
 */
export function cleanControlChars(str) {
  return String(str ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Перевірка на наявність реальних HTML/JS ін'єкцій (XSS).
 *
 * Дозволяє:
 *  - Апострофи: Здоров'я, М'язи, Сім'я, Don't, "Хірург"
 *  - Математичні нерівності: Зріст < 160 см, Вік > 50 (бо після < йде пробіл або цифра, а не назва тегу)
 *
 * Забороняє:
 *  - <script...>, <iframe...>, <object...>, <style...>, <link...>
 *  - Обробники подій: onload=, onerror=, onclick= тощо
 *  - Псевдопротоколи: javascript:, data:text/html
 *  - Будь-які сирі HTML-теги: <tag>, </tag>, <img ...>
 */
export function detectHtmlInjection(str) {
  if (!str || typeof str !== 'string') return false;

  // Небезпечні теги або обробники
  if (/<(?:script|iframe|object|embed|style|link|meta)\b/i.test(str)) return true;
  if (/\bon[a-z]{3,}\s*=/i.test(str)) return true;
  if (/javascript\s*:/i.test(str)) return true;
  if (/data\s*:\s*text\/html/i.test(str)) return true;

  // Будь-який HTML-тег: відкриваючий або закриваючий тег з літерою на початку
  if (/<(?:\/?[a-z][a-z0-9:-]*)\b[^>]*>/i.test(str)) return true;

  return false;
}

/**
 * Безпечний рендер форматованого тексту у DOM-елемент без innerHTML.
 * Парсить рядок через браузерний DOMParser і створює лише білий список безпечних вузлів.
 *
 * @param {HTMLElement} targetEl - DOM-елемент, у який помістити безпечний вміст
 * @param {string} rawHtml - Рядок з розміткою
 * @param {string[]} allowedTags - Дозволені теги (за замовчуванням: b, br, strong, em, span)
 */
export function renderSafeNodes(targetEl, rawHtml, allowedTags = ['b', 'br', 'strong', 'em', 'span']) {
  if (!targetEl) return;
  targetEl.textContent = '';
  if (!rawHtml) return;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  function appendSafe(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (allowedTags.includes(tag)) {
        const el = document.createElement(tag);
        for (const child of node.childNodes) {
          appendSafe(child, el);
        }
        target.appendChild(el);
      } else {
        // Якщо тег не в списку дозволених, відкидаємо сам тег, але зберігаємо його текстових дітей
        for (const child of node.childNodes) {
          appendSafe(child, target);
        }
      }
    }
  }

  for (const child of doc.body.childNodes) {
    appendSafe(child, targetEl);
  }
}

/**
 * Централізована валідація вмісту паку перед збереженням у БД.
 *
 * @param {Object} data
 * @param {string} data.title - Назва пака
 * @param {string} data.description - Опис пака
 * @param {Array} data.cards - Масив карток ({ value, meta, category, pool_type })
 * @param {Array} data.cataclysms - Масив катаклізмів ({ name, description, ... })
 * @param {Object} limits - Ліміти довжини полів
 * @returns {{ valid: boolean, error?: string, field?: string, category?: string }}
 */
export function validatePackText(data, limits = {}) {
  const title = String(data.title ?? '').trim();
  const desc = String(data.description ?? '').trim();

  const titleMax = limits.TITLE_MAX || 100;
  const descMax = limits.DESC_MAX || 255;
  const cardValMax = limits.CARD_VALUE_MAX || 300;
  const cardMetaMax = limits.CARD_META_TEXT_MAX || 1000;
  const stageNameMax = limits.STAGE_NAME_MAX || 100;
  const maxCards = limits.MAX_PACK_CARDS || 2000;

  // 1. Назва пака
  if (!title) {
    return { valid: false, error: 'Вкажіть назву пака', field: 'title' };
  }
  if (title.length > titleMax) {
    return { valid: false, error: `Назва пака не може перевищувати ${titleMax} символів (зараз: ${title.length})`, field: 'title' };
  }
  if (detectHtmlInjection(title)) {
    return { valid: false, error: 'Назва пака містить неприпустимі HTML-теги або скрипти', field: 'title' };
  }

  // 2. Опис пака
  if (desc.length > descMax) {
    return { valid: false, error: `Опис пака не може перевищувати ${descMax} символів (зараз: ${desc.length})`, field: 'desc' };
  }
  if (detectHtmlInjection(desc)) {
    return { valid: false, error: 'Опис пака містить неприпустимі HTML-теги або скрипти', field: 'desc' };
  }

  // 3. Картки
  const cards = data.cards || [];
  if (cards.length > maxCards) {
    return { valid: false, error: `Забагато характеристик: ${cards.length}. Максимум — ${maxCards}` };
  }

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const val = String(c?.value ?? '').trim();
    const cat = c?.category || 'невідома';

    if (!val) {
      return { valid: false, error: `Виявлено порожню картку в категорії "${cat}"`, category: cat };
    }
    if (val.length > cardValMax) {
      return {
        valid: false,
        error: `Назва картки "${val.slice(0, 30)}..." у категорії "${cat}" перевищує ${cardValMax} символів (${val.length})`,
        category: cat
      };
    }
    if (detectHtmlInjection(val)) {
      return {
        valid: false,
        error: `У картці "${val.slice(0, 30)}..." виявлено неприпустимий HTML-код або скрипт`,
        category: cat
      };
    }

    // Перевірка текстових полів meta
    if (c.meta && typeof c.meta === 'object') {
      for (const [k, metaVal] of Object.entries(c.meta)) {
        if (typeof metaVal === 'string' && metaVal.trim()) {
          if (metaVal.length > cardMetaMax) {
            return {
              valid: false,
              error: `Поле "${k}" картки "${val}" перевищує ${cardMetaMax} символів`,
              category: cat
            };
          }
          if (detectHtmlInjection(metaVal)) {
            return {
              valid: false,
              error: `У полі "${k}" картки "${val}" виявлено неприпустимий HTML-код або скрипт`,
              category: cat
            };
          }
        }
      }

      // Перевірка стадій усередині картки
      if (Array.isArray(c.meta.stages)) {
        for (const st of c.meta.stages) {
          const stName = typeof st === 'object' ? (st?.name || '') : String(st || '');
          if (stName.length > stageNameMax) {
            return {
              valid: false,
              error: `Назва стадії "${stName.slice(0, 20)}..." у картці "${val}" перевищує ${stageNameMax} символів`,
              category: cat
            };
          }
          if (detectHtmlInjection(stName)) {
            return {
              valid: false,
              error: `У назві стадії картки "${val}" виявлено неприпустимий HTML-код або скрипт`,
              category: cat
            };
          }
        }
      }
    }
  }

  // 4. Катаклізми
  const cataclysms = data.cataclysms || [];
  for (const cata of cataclysms) {
    const name = String(cata?.name ?? '').trim();
    if (!name) continue;

    if (name.length > (limits.CATACLYSM_LIMITS?.nameMax || 200)) {
      return { valid: false, error: `Назва катаклізму "${name.slice(0, 30)}..." перевищує ліміт`, category: 'cataclysm' };
    }
    if (detectHtmlInjection(name)) {
      return { valid: false, error: `У назві катаклізму "${name.slice(0, 30)}..." виявлено неприпустимий HTML-код або скрипт`, category: 'cataclysm' };
    }

    const cataDesc = String(cata?.description ?? '').trim();
    if (cataDesc.length > (limits.CATACLYSM_LIMITS?.descMax || 1000)) {
      return { valid: false, error: `Опис катаклізму "${name}" перевищує ліміт`, category: 'cataclysm' };
    }
    if (detectHtmlInjection(cataDesc)) {
      return { valid: false, error: `В описі катаклізму "${name}" виявлено неприпустимий HTML-код або скрипт`, category: 'cataclysm' };
    }
  }

  return { valid: true };
}

