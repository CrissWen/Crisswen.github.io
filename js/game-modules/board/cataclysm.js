import { isBlockCollapsed } from './board-ui-state.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function cataclysm(data) {
  const blockId = 'block-cataclysm';
  const collapsed = isBlockCollapsed(blockId);
  const headHtml = `
    <button type="button" class="block-head block-head--collapsible" data-block-toggle="${blockId}" aria-expanded="${!collapsed}" aria-controls="${blockId}-body">
      <h2>Катаклізм</h2>
      <span class="block-toggle-arrow${collapsed ? ' is-collapsed' : ''}" aria-hidden="true">▼</span>
    </button>
  `;

  if (!data) {
    return `
      <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
        ${headHtml}
        <div class="block-body" id="${blockId}-body">
          <p class="cataclysm-desc" style="text-align: center; color: var(--text-mute);">Очікування генерації катаклізму...</p>
        </div>
      </section>
    `;
  }

  // Форматуємо число населення
  let popDisplay = "";
  if (data.population && data.population !== "Невідомо") {
    // Використовуємо toLocaleString для гарного форматування чисел, якщо це число
    const formattedPop = !isNaN(data.population) 
      ? Number(data.population).toLocaleString('uk-UA') 
      : data.population;
      
    popDisplay = `
      <div class="cataclysm-pop-wrapper">
        <div class="cataclysm-pop-label">Населення</div>
        <div class="cataclysm-pop-section">
          <div class="pop-mask"></div>
          <p class="cataclysm-population">${esc(formattedPop)}</p>
        </div>
      </div>
    `;
  }

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      ${headHtml}
      <div class="block-body" id="${blockId}-body">
        <div class="cataclysm-row">
          <div class="cataclysm-main">
            <div class="cataclysm-icon">${esc((data.icon || "☢").replace(/\uFE0F/g, '\uFE0E'))}</div>
            <div class="cataclysm-content">
              <p class="cataclysm-title">${esc(data.title)}</p>
              <p class="cataclysm-desc">${esc(data.desc)}</p>
            </div>
          </div>
          ${popDisplay}
        </div>
      </div>
    </section>
  `;
}
