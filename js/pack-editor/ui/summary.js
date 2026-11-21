import { esc } from '../../utils/common/escape-html.js';
import { ALL_PACK_CATEGORIES } from '../categories.js';
import { DESC_MAX } from '../constants.js';
import { $ } from './shared.js';

// ===== Зведення: лічильники карток, чіпи категорій, стан кнопок =====

// Текст підказки для жовтого кружечка «мало карток». info = { have, need } з findShortByCounts
export function shortageTip({ have, need }) {
  return `Карток: ${have} з рекомендованих ${need}. Краще додати ще ${need - have} — інакше бракуючі картки гра буде брати з базового пака.`;
}

// shortage — { [category]: { have, need } } для категорій, де треба показати жовтий кружечок «i» (порожній об’єкт — іконок немає).
// Хто і коли їх ввімкне — рішає контролер (editor.js); тут лише малюємо.
export function renderSummary(counts, activeCategory, shortage = {}) {
  const categories = ALL_PACK_CATEGORIES.map(c => ({ ...c, count: counts[c.category] || 0 }));
  const charTotal = categories.filter(c => c.poolType === "character").reduce((sum, c) => sum + c.count, 0);
  const bunkerTotal = categories.filter(c => c.poolType === "bunker").reduce((sum, c) => sum + c.count, 0);
  const total = charTotal + bunkerTotal;

  const totalEl = $("pe-summary-total");
  if (totalEl) {
    totalEl.innerHTML = `
      <span class="pe-summary__text">Усього: ${total} (П: ${charTotal}, Б: ${bunkerTotal})</span>
      <div class="pe-summary__badges">
        <span class="pe-summary__badge pe-summary__badge--total">Усього: <strong>${total}</strong></span>
        <span class="pe-summary__badge">Персонаж: <strong>${charTotal}</strong></span>
        <span class="pe-summary__badge">Бункер: <strong>${bunkerTotal}</strong></span>
      </div>
    `;
  }

  const chipsEl = $("pe-chips");
  if (chipsEl) {
    const warnIcon = c => {
      const info = shortage[c.category];
      if (!info) return "";
      const tip = esc(shortageTip(info));
      return `<i class="pe-warn" role="button" tabindex="0" data-tip="${tip}" data-tip-type="shortage" data-category="${esc(c.category)}" aria-label="${tip}"></i>`;
    };
    const renderItem = c => `
      <button type="button" class="pe-char-menu-item${c.category === activeCategory ? " is-active" : ""}" data-chip="${esc(c.category)}">
        <span class="pe-char-menu-item__label">${warnIcon(c)}${esc(c.label)}</span>
        <span class="pe-char-menu-item__meta">
          <span class="pe-char-menu-item__count">${c.count > 0 ? `(${c.count})` : ""}</span>
          <span class="pe-char-menu-item__badge">${c.count > 0 ? c.count : 0}</span>
          <svg class="pe-char-menu-item__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </span>
      </button>`;
      
    const chars = categories.filter(c => c.poolType === "character").map(renderItem).join("");
    const bunkers = categories.filter(c => c.poolType === "bunker").map(renderItem).join("");

    chipsEl.innerHTML = `
      <div class="pe-char-menu-section">
        <div class="pe-char-menu-heading">Персонаж</div>
        <div class="pe-char-menu-group">${chars}</div>
      </div>
      <div class="pe-char-menu-section">
        <div class="pe-char-menu-heading">Бункер</div>
        <div class="pe-char-menu-group">${bunkers}</div>
      </div>
    `;
  }

  // Такий же кружечок поряд із заголовком відкритої категорії — тут користувач додає картки і бачить стан наживо
  const headWarn = $("pe-cat-warn");
  if (headWarn) {
    const info = shortage[activeCategory];
    headWarn.hidden = !info;
    if (info) {
      const tip = shortageTip(info);
      headWarn.dataset.tip = tip;
      headWarn.dataset.tipType = "shortage";
      headWarn.setAttribute("aria-label", tip);
    } else {
      delete headWarn.dataset.tip;
      delete headWarn.dataset.tipType;
      headWarn.removeAttribute("aria-label");
    }
  }
}

// dirty — є незбережені зміни (вмикає "Скасувати зміни"), empty — форма порожня (вимикає "Очистити все")
export function updateButtons({ dirty, empty }) {
  const reset = document.querySelector('[data-action="reset"]');
  const clear = document.querySelector('[data-action="clear"]');
  if (reset) reset.disabled = !dirty;
  if (clear) clear.disabled = empty;
}

export function updateCardsMeta(isCata, count) {
  $('pe-lines-count').textContent = isCata ? `Катаклізмів: ${count}` : `Рядків: ${count}`;
}

export function updateDescCounter() {
  $('pe-desc-counter').textContent = `${$('pe-desc').value.length}/${DESC_MAX}`;
}

// Стан кнопки (наприклад, "Збереження..." на час запиту)
export function setButtonState(btn, { disabled, text }) {
  btn.disabled = disabled;
  btn.textContent = text;
}
