function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function bunkerInfo(data) {
  if (!data) {
    return `
      <section class="block" id="block-bunker-info">
        <div class="block-head">
          <h2>Бункер</h2>
        </div>
        <div class="block-body">
          <p class="block-desc" style="text-align: center; color: var(--text-mute);">Очікування генерації бункера...</p>
        </div>
      </section>
    `;
  }

  const featuresHtml = (data.features || [])
    .map((f) => `<li>${esc(f)}</li>`)
    .join("");

  return `
    <section class="block" id="block-bunker-info">
      <div class="block-head">
        <h2>Бункер</h2>
      </div>
      <div class="block-body">
        <p class="block-desc">${esc(data.description)}</p>
        
        <div class="bunker-details-row">
          
          <!-- Ліва колонка: Інвентар -->
          ${featuresHtml ? `
            <div class="bunker-equip-col">
              <h3 class="equipment-title">Що є в бункері</h3>
              <ul class="equipment-list">${featuresHtml}</ul>
            </div>
          ` : ''}

          <!-- Права колонка: Характеристики (Сітка 2х2) -->
          <div class="bunker-stats-col">
            <div class="info-grid">
              <div class="info-stat">
                <div class="k">Площа</div>
                <div class="v">${esc(data.size)}</div>
              </div>
              <div class="info-stat">
                <div class="k">Час перебування</div>
                <div class="v">${esc(data.yearsInBunker)}</div>
              </div>
              <div class="info-stat">
                <div class="k">Запасів їжі/води на</div>
                <div class="v">${esc(data.foodSupply)}</div>
              </div>
              <div class="info-stat">
                <div class="k">Кількість місць</div>
                <div class="v">${esc(data.capacity)}</div>
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </section>
  `;
}