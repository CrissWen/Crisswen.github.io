export function catastrophe(data) {
  // Якщо катаклізм ще не згенеровано
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

  // Якщо дані є — малюємо їх
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
          </div>
        </div>
      </div>
    </section>
  `;
}