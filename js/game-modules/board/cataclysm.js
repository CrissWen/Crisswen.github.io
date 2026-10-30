import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS, isSquareFrameIcon, isWideFrameIcon } from '../../constants/icons.js';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function renderCataclysmIcon(icon) {
  const iconSrc = icon || ICONS.HAZARD;
  const isSvg = typeof iconSrc === 'string' && (iconSrc.toLowerCase().includes('.svg') || iconSrc === ICONS.HAZARD);

  if (isSvg) {
    const isSquare = isSquareFrameIcon(iconSrc);
    const isWide = isWideFrameIcon(iconSrc);
    const fitClass = isSquare
      ? ' cataclysm-mask-icon--square-fit'
      : (isWide ? ' cataclysm-mask-icon--wide-fit' : '');
    return `<span class="cataclysm-mask-icon${fitClass}" style="-webkit-mask-image: url('${esc(iconSrc)}'); mask-image: url('${esc(iconSrc)}');" aria-hidden="true"></span>`;
  }

  // Аварійна заглушка для текстових емодзі (на випадок сторонніх даних)
  return `<span class="cataclysm-emoji-icon">${esc(String(iconSrc).replace(/\uFE0F/g, '\uFE0E'))}</span>`;
}

// Видаляємо тестове плаваюче віконце, якщо воно залишилось у DOM
if (typeof document !== 'undefined') {
  document.getElementById('cataclysm-floating-preview')?.remove();
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
    const formattedPop = !isNaN(data.population) 
      ? Number(data.population).toLocaleString('uk-UA') 
      : data.population;
      
    popDisplay = `
      <div class="cataclysm-pop-wrapper">
        <div class="cataclysm-pop-label">Населення</div>
        <div class="cataclysm-pop-section">
          <div class="pop-mask" style="-webkit-mask-image: url('${ICONS.POPULATION}'); mask-image: url('${ICONS.POPULATION}');" aria-hidden="true"></div>
          <p class="cataclysm-population">${esc(formattedPop)}</p>
        </div>
      </div>
    `;
  }

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      ${headHtml}
      <div class="block-body" id="${blockId}-body">
        <div class="cataclysm-card">
          <div class="cataclysm-header">
            <div class="cataclysm-title-row">
              <div class="cataclysm-icon">${renderCataclysmIcon(data.icon)}</div>
              <p class="cataclysm-title">${esc(data.title)}</p>
            </div>
            ${popDisplay}
          </div>
          
          <div class="cataclysm-desc-wrap">
            <div class="cataclysm-formular">
              <div class="cataclysm-corner cataclysm-corner-tl" aria-hidden="true"></div>
              <div class="cataclysm-corner cataclysm-corner-tr" aria-hidden="true"></div>
              <div class="cataclysm-corner cataclysm-corner-bl" aria-hidden="true"></div>
              <div class="cataclysm-corner cataclysm-corner-br" aria-hidden="true"></div>
              <div class="cataclysm-prefix">
                <span class="cataclysm-chevron" aria-hidden="true">▶</span>
                <span class="cataclysm-label">ПРОТОКОЛ СПОСТЕРЕЖЕННЯ ЗАГРОЗИ</span>
              </div>
              <p class="cataclysm-desc">${esc(data.desc)}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
