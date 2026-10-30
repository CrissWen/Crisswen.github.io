import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Видаляємо тестовий плаваючий перемикач батлу, якщо він залишився в DOM
if (typeof document !== 'undefined') {
  document.getElementById('bunker-floating-battle-switcher')?.remove();
  try {
    localStorage.removeItem('truebunker_bunker_battle_variant');
  } catch (_) {}
}

export function bunkerInfo(data) {
  const blockId = 'block-bunker-info';
  const collapsed = isBlockCollapsed(blockId);
  const headHtml = `
    <button type="button" class="block-head block-head--collapsible" data-block-toggle="${blockId}" aria-expanded="${!collapsed}" aria-controls="${blockId}-body">
      <h2>Бункер</h2>
      <span class="block-toggle-arrow${collapsed ? ' is-collapsed' : ''}" aria-hidden="true">▼</span>
    </button>
  `;

  if (!data) {
    return `
      <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
        ${headHtml}
        <div class="block-body" id="${blockId}-body">
          <p class="bunker-desc" style="text-align: center; color: var(--text-mute);">Очікування генерації бункера...</p>
        </div>
      </section>
    `;
  }

  const features = data.features || [];
  const cargoHtml = features.length > 0
    ? features.map((f, i) => `
        <div class="bunker-cargo-slot">
          <span class="bunker-cargo-tag">CRG-0${i + 1}</span>
          <span class="bunker-cargo-name">${esc(f)}</span>
          <span class="bunker-cargo-led" aria-hidden="true"></span>
        </div>
      `).join('')
    : `<div class="bunker-cargo-empty">ВІДСІК ПОРОЖНІЙ</div>`;

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      ${headHtml}
      <div class="block-body" id="${blockId}-body">
        
        <!-- Відсік А: Житловий сектор (Опис) -->
        <div class="bunker-compartment bunker-compartment--life">
          <div class="bunker-comp-header">
            <span class="bunker-comp-badge">СЕКТОР-А</span>
            <span class="bunker-comp-title">ЖИТЛОВИЙ БЛОК ТА КОНФІГУРАЦІЯ</span>
            <span class="bunker-comp-status">АКТИВНИЙ</span>
          </div>
          <p class="bunker-desc">${esc(data.description)}</p>
        </div>

        <!-- Нижній ярус модулів -->
        <div class="bunker-modules-row">
          
          <!-- Відсік Б: Карго / Склад -->
          <div class="bunker-compartment bunker-compartment--cargo">
            <div class="bunker-comp-header">
              <span class="bunker-comp-badge">СЕКТОР-Б</span>
              <span class="bunker-comp-title">СКЛАДСЬКИЙ ВІДСІК</span>
              <span class="bunker-comp-count">${features.length} ПОЗ.</span>
            </div>
            <div class="bunker-cargo-list">
              ${cargoHtml}
            </div>
          </div>

          <!-- Відсік В: Системи життєзабезпечення (без кольорових смуг) -->
          <div class="bunker-compartment bunker-compartment--systems">
            <div class="bunker-comp-header">
              <span class="bunker-comp-badge">СЕКТОР-В</span>
              <span class="bunker-comp-title">ЖИТТЄЗАБЕЗПЕЧЕННЯ</span>
            </div>
            <div class="bunker-gauges-grid">
              <div class="bunker-gauge">
                <span class="bunker-gauge-icon" style="-webkit-mask-image: url('${ICONS.BUNKER_SIZE}'); mask-image: url('${ICONS.BUNKER_SIZE}');" aria-hidden="true"></span>
                <div class="bunker-gauge-body">
                  <span class="bunker-gauge-label">ПЛОЩА</span>
                  <span class="bunker-gauge-value">${esc(data.size)}</span>
                </div>
              </div>
              <div class="bunker-gauge">
                <span class="bunker-gauge-icon" style="-webkit-mask-image: url('${ICONS.STAY_TIME}'); mask-image: url('${ICONS.STAY_TIME}');" aria-hidden="true"></span>
                <div class="bunker-gauge-body">
                  <span class="bunker-gauge-label">ТЕРМІН</span>
                  <span class="bunker-gauge-value">${esc(data.yearsInBunker)}</span>
                </div>
              </div>
              <div class="bunker-gauge">
                <span class="bunker-gauge-icon" style="-webkit-mask-image: url('${ICONS.FOOD}'); mask-image: url('${ICONS.FOOD}');" aria-hidden="true"></span>
                <div class="bunker-gauge-body">
                  <span class="bunker-gauge-label">ПРОВІЗІЯ</span>
                  <span class="bunker-gauge-value">${esc(data.foodSupply)}</span>
                </div>
              </div>
              <div class="bunker-gauge">
                <span class="bunker-gauge-icon" style="-webkit-mask-image: url('${ICONS.CAPACITY}'); mask-image: url('${ICONS.CAPACITY}');" aria-hidden="true"></span>
                <div class="bunker-gauge-body">
                  <span class="bunker-gauge-label">МІСТКІСТЬ</span>
                  <span class="bunker-gauge-value">${esc(data.capacity)}</span>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  `;
}
