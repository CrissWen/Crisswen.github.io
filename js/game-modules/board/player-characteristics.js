// БЛОК 3 — ОСОБИСТІ ХАРАКТЕРИСТИКИ ГРАВЦЯ
// Гравець завжди бачить свої власні значення. Замочок НЕ приховує значення
// від самого гравця — він керує тим, чи бачать цю характеристику ІНШІ гравці
// (і, відповідно, чи з'явиться значення в таблиці "Гравці" / "Спец можливості").
// Спец можливості показані окремим підблоком нижче основних характеристик,
// їх завжди рівно 2.

import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function playerCharacteristics(data) {
  data = data || {
    ownerName: "Олена",
    characteristics: [
      { label: "Професія",     value: "Хірург", open: true },
      { label: "Здоров'я",     value: "Астма (легка)", open: false },
      { label: "Хобі / навик", value: "Гра на гітарі", open: true },
      { label: "Фобія",        value: "Клаустрофобія", open: false },
      { label: "Багаж",        value: "Аптечка першої допомоги", open: false }
    ],
    abilities: [
      { label: "Спец можливість №1", value: "Подвійний голос на голосуванні", open: false },
      { label: "Спец можливість №2", value: "Погляд у колоду дій", open: false }
    ]
  };

  const ownerName = data.ownerName || "Гравець";
  const blockId = 'block-player-characteristics';
  const collapsed = isBlockCollapsed(blockId);

  const renderItem = (c, i, extraClass) => `
      <div class="char-item${c.open ? " open" : ""}${extraClass ? " " + extraClass : ""}" data-dbkey="${esc(c.dbKey || '')}" data-idx="${c.index !== undefined ? esc(c.index) : ''}">
        <div class="char-text">
          <span class="char-label">${esc(c.label)}</span>
          <span class="char-value">${c.value}</span>
        </div>
        <button type="button" class="char-lock" aria-label="Показати або приховати">
          <!-- Вказуємо шлях до папки з іконками -->
          <img src="${ICONS.LOCKED_LOCK}" alt="Закрито" class="lock-icon lock-closed">
          <img src="${ICONS.UNLOCKED_LOCK}" alt="Відкрито" class="lock-icon lock-open">
        </button>
      </div>`;

  const charItems = data.characteristics.map((c, i) => renderItem(c, i, "")).join("");
  const abilityItems = data.abilities.map((c, i) => renderItem(c, i, "ability-item")).join("");

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}" data-owner="${esc(ownerName)}">
      <button type="button" class="block-head block-head--collapsible" data-block-toggle="${blockId}" aria-expanded="${!collapsed}" aria-controls="${blockId}-body">
        <h2>Твої характеристики</h2>
        <span class="block-toggle-arrow${collapsed ? ' is-collapsed' : ''}" aria-hidden="true">▼</span>
      </button>
      <div class="block-body" id="${blockId}-body">
        <div class="char-list" data-group="characteristics">${charItems}</div>

        <div class="abilities-block">
          <h3 class="abilities-title">Спец можливості</h3>
          <div class="char-list abilities-list" data-group="abilities">${abilityItems}</div>
        </div>
      </div>
    </section>
  `;
}
