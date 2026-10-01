export function catastrophe(data) {
  if (!data) {
    return `
      <section class="block" id="block-catastrophe">
        <div class="block-head">
          <h2>Катаклізм</h2>
        </div>
        <div class="block-body">
          <p class="cata-desc" style="text-align: center; color: var(--text-mute);">Очікування генерації катаклізму...</p>
        </div>
      </section>
    `;
  }

  // Форматуємо число населення (наприклад, 184220100 -> 184 220 100)
  let popDisplay = "";
  if (data.population && data.population !== "Невідомо") {
    // Використовуємо toLocaleString для гарного форматування чисел, якщо це число
    const formattedPop = !isNaN(data.population) 
      ? Number(data.population).toLocaleString('uk-UA') 
      : data.population;
      
    popDisplay = `<p class="cata-population" style="margin: 6px 0 0; font-family: var(--mono); font-size: 13.5px; color: var(--hazard);">Залишок населення: ${formattedPop}</p>`;
  }

  return `
    <section class="block" id="block-catastrophe">
      <div class="block-head">
        <h2>Катаклізм</h2>
      </div>
      <div class="block-body">
        <div class="cata-row">
          <div class="cata-icon">${data.icon || "☢"}</div>
          <div>
            <p class="cata-title">${data.title}</p>
            <p class="cata-desc">${data.desc}</p>
            ${popDisplay}
          </div>
        </div>
      </div>
    </section>
  `;
}