import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';
import { esc } from '../../utils/security.js';

// Видаляємо тестовий плаваючий перемикач, якщо він залишився в DOM
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
  const hasFeatures = features.length > 0;

  const cargoContentHtml = hasFeatures
    ? `
      <ul class="bunker-cargo-list">
        ${features.map((f, i) => `
          <li class="bunker-cargo-item">
            <span class="bunker-cargo-tag">CRG-0${i + 1}</span>
            <span class="bunker-cargo-name">${esc(f)}</span>
            <span class="bunker-cargo-led" aria-hidden="true"></span>
          </li>
        `).join('')}
      </ul>
    `
    : `
      <div class="bunker-cargo-empty-wrap">
        <p class="bunker-cargo-empty-text">Відсік порожній</p>
      </div>
    `;

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      ${headHtml}
      <div class="block-body" id="${blockId}-body">
        
        <!-- Сектор А: Житловий блок (Верхній відсік на всю ширину) -->
        <div class="bunker-sector-box bunker-sector-box--life">
          <div class="bunker-corner bunker-corner-tl" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-tr" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-bl" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-br" aria-hidden="true"></div>
          
          <div class="bunker-sector-header">
            <span class="sector-badge">СЕКТОР-А</span>
            <span class="sector-title">ЖИТЛОВИЙ БЛОК ТА КОНФІГУРАЦІЯ</span>
            <div class="sector-status">
              <span class="status-led" aria-hidden="true"></span>
              <span>АКТИВНИЙ</span>
            </div>
          </div>
          <p class="bunker-desc">${esc(data.description)}</p>
        </div>

        <!-- Нижній ярус модулів: Сектор Б (Карго) зліва + Сектор В (Життєзабезпечення) справа -->
        <div class="bunker-sectors-row">
          
          <!-- Сектор Б: Складський відсік (Повністю вирівняний із Сектором А) -->
          <div class="bunker-sector-box bunker-sector-box--cargo">
            <div class="bunker-corner bunker-corner-tl" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-tr" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-bl" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-br" aria-hidden="true"></div>

            <div class="bunker-sector-header">
              <span class="sector-badge">СЕКТОР-Б</span>
              <span class="sector-title">СКЛАДСЬКИЙ ВІДСІК</span>
              <span class="sector-count">${features.length} ПОЗ.</span>
            </div>
            ${cargoContentHtml}
          </div>

          <!-- Сектор В: Системи життєзабезпечення -->
          <div class="bunker-sector-box bunker-sector-box--systems">
            <div class="bunker-corner bunker-corner-tl" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-tr" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-bl" aria-hidden="true"></div>
            <div class="bunker-corner bunker-corner-br" aria-hidden="true"></div>

            <div class="bunker-sector-header">
              <span class="sector-badge">СЕКТОР-В</span>
              <span class="sector-title">ЖИТТЄЗАБЕЗПЕЧЕННЯ</span>
            </div>
            <div class="info-grid">
              <div class="info-stat">
                <span class="info-stat-icon" style="-webkit-mask-image: url('${ICONS.BUNKER_SIZE}'); mask-image: url('${ICONS.BUNKER_SIZE}');" aria-hidden="true"></span>
                <div class="info-stat-content">
                  <div class="k">Площа</div>
                  <div class="v">${esc(data.size)}</div>
                </div>
              </div>
              <div class="info-stat">
                <span class="info-stat-icon" style="-webkit-mask-image: url('${ICONS.STAY_TIME}'); mask-image: url('${ICONS.STAY_TIME}');" aria-hidden="true"></span>
                <div class="info-stat-content">
                  <div class="k">Час перебування</div>
                  <div class="v">${esc(data.yearsInBunker)}</div>
                </div>
              </div>
              <div class="info-stat">
                <span class="info-stat-icon" style="-webkit-mask-image: url('${ICONS.FOOD}'); mask-image: url('${ICONS.FOOD}');" aria-hidden="true"></span>
                <div class="info-stat-content">
                  <div class="k">Запасів їжі/води на</div>
                  <div class="v">${esc(data.foodSupply)}</div>
                </div>
              </div>
              <div class="info-stat">
                <span class="info-stat-icon" style="-webkit-mask-image: url('${ICONS.CAPACITY}'); mask-image: url('${ICONS.CAPACITY}');" aria-hidden="true"></span>
                <div class="info-stat-content">
                  <div class="k">Кількість місць</div>
                  <div class="v">${esc(data.capacity)}</div>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  `;
}
