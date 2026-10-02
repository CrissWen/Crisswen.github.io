export function cataclysm(data) {
  if (!data) {
    return `
      <section class="block" id="block-cataclysm">
        <div class="block-head">
          <h2>Катаклізм</h2>
        </div>
        <div class="block-body">
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
          <p class="cataclysm-population">${formattedPop}</p>
        </div>
      </div>
    `;
  }

  return `
    <section class="block" id="block-cataclysm">
      <div class="block-head">
        <h2>Катаклізм</h2>
      </div>
      <div class="block-body">
        <div class="cataclysm-row">
          <div class="cataclysm-main">
            <div class="cataclysm-icon">${(data.icon || "☢").replace(/\uFE0F/g, '\uFE0E')}</div>
            <div class="cataclysm-content">
              <p class="cataclysm-title">${data.title}</p>
              <p class="cataclysm-desc">${data.desc}</p>
            </div>
          </div>
          ${popDisplay}
        </div>
      </div>
    </section>
  `;
}