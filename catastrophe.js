// БЛОК 1 — КАТАКЛІЗМ
window.BunkerBlocks = window.BunkerBlocks || {};

window.BunkerBlocks.catastrophe = function (data) {
  data = data || {
    icon: "☢",
    title: "Ядерна війна",
    desc: "Обмін ядерними ударами між кількома державами. Поверхня забруднена радіацією, рівень якої спаде не раніше ніж за 40 років. Вижити на поверхні неможливо."
  };

  return `
    <section class="block" id="block-catastrophe">
      <div class="block-head">
        <h2>Катаклізм</h2>
      </div>
      <div class="block-body">
        <div class="cata-row">
          <div class="cata-icon">${data.icon}</div>
          <div>
            <p class="cata-title">${data.title}</p>
            <p class="cata-desc">${data.desc}</p>
          </div>
        </div>
      </div>
    </section>
  `;
};
