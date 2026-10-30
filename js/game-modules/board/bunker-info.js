import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

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
  const featuresHtml = features.length > 0
    ? features.map((f) => `<li class="equipment-item">${esc(f)}</li>`).join('')
    : `<li class="equipment-item equipment-item--empty">Спорядження відсутнє</li>`;

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      ${headHtml}
      <div class="block-body" id="${blockId}-body">
        
        <!-- Верхній ярус: Повноширинний формуляр опису з фірмовими кутовими засічками (як у катаклізмі) -->
        <div class="bunker-formular">
          <div class="bunker-corner bunker-corner-tl" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-tr" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-bl" aria-hidden="true"></div>
          <div class="bunker-corner bunker-corner-br" aria-hidden="true"></div>
          <div class="bunker-prefix">
            <span class="bunker-chevron" aria-hidden="true">▶</span>
            <span class="bunker-label">ПРОТОКОЛ СХОВИЩА</span>
            <span class="bunker-status-pill">АКТИВНИЙ</span>
          </div>
          <p class="bunker-desc">${esc(data.description)}</p>
        </div>

        <!-- Нижній ярус: Інвентар зліва + Характеристики справа -->
        <div class="bunker-details-row">
          
          <!-- Ліва колонка: Що є в бункері (чистий фірмовий список) -->
          <div class="bunker-equip-col">
            <h3 class="bunker-col-title">
              <span class="title-led" aria-hidden="true"></span>
              Що є в бункері
            </h3>
            <ul class="equipment-list">
              ${featuresHtml}
            </ul>
          </div>

          <!-- Права колонка: Характеристики бункера (сітка 2х2 в базовому стилі) -->
          <div class="bunker-stats-col">
            <h3 class="bunker-col-title">Характеристики бункера</h3>
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
