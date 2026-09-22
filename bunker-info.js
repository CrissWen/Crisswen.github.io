// БЛОК 2 — ІНФОРМАЦІЯ ПРО БУНКЕР
window.BunkerBlocks = window.BunkerBlocks || {};

window.BunkerBlocks.bunkerInfo = function (data) {
  data = data || {
    description: "Бункер збудований близько 20 років тому й відтоді жодного разу не проходив повного капремонту. Основні системи справні, але повітряні фільтри застаріли і потребують заміни — під час тривалого перебування це буде проблемою.",
    size: "180 м²",
    yearsInBunker: "5 років",
    foodSupply: "3 роки",
    capacity: "9",
    features: ["Генератор", "Фільтри води", "Аптека", "Теплиця", "Майстерня"]
  };

  const featuresHtml = data.features
    .map((f) => `<li>${f}</li>`)
    .join("");

  return `
    <section class="block" id="block-bunker-info">
      <div class="block-head">
        <h2>Бункер</h2>
      </div>
      <div class="block-body">
        <p class="block-desc">${data.description}</p>
        <div class="info-grid">
          <div class="info-stat">
            <div class="k">Площа</div>
            <div class="v">${data.size}</div>
          </div>
          <div class="info-stat">
            <div class="k">Скільки років перебувати у бункері</div>
            <div class="v">${data.yearsInBunker}</div>
          </div>
          <div class="info-stat">
            <div class="k">Запасів їжі вистачить на</div>
            <div class="v">${data.foodSupply}</div>
          </div>
          <div class="info-stat">
            <div class="k">Кількість місць</div>
            <div class="v">${data.capacity}</div>
          </div>
        </div>
        <h3 class="equipment-title">Що є в бункері</h3>
        <ul class="equipment-list">${featuresHtml}</ul>
      </div>
    </section>
  `;
};
