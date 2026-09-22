// БЛОК 3 — ОСОБИСТІ ХАРАКТЕРИСТИКИ ГРАВЦЯ
// Гравець завжди бачить свої власні значення. Замочок НЕ приховує значення
// від самого гравця — він керує тим, чи бачать цю характеристику ІНШІ гравці
// (і, відповідно, чи з'явиться значення в таблиці "Гравці" / "Спец можливості").
// Спец можливості показані окремим підблоком нижче основних характеристик,
// їх завжди рівно 2.
window.BunkerBlocks = window.BunkerBlocks || {};

window.BunkerBlocks.playerCharacteristics = function (data) {
  data = data || {
    ownerName: "Олена",
    characteristics: [
      { label: "Професія",     value: "Хірург", open: true },
      { label: "Здоров'я",     value: "Астма (легка)", open: false },
      { label: "Хобі / навик", value: "Гра на гітарі", open: true },
      { label: "Фобія",        value: "Клаустрофобія", open: false },
      { label: "Багаж",        value: "Аптечка першої допомоги", open: false }
    ],
    abilities: [
      { label: "Спец можливість №1", value: "Подвійний голос на голосуванні", open: false },
      { label: "Спец можливість №2", value: "Погляд у колоду дій", open: false }
    ]
  };

  const ownerName = data.ownerName || "Гравець";

  const renderItem = (c, i, extraClass) => `
      <div class="char-item${c.open ? " open" : ""}${extraClass ? " " + extraClass : ""}" data-idx="${i}" data-label="${c.label}">
        <div class="char-text">
          <span class="char-label">${c.label}</span>
          <span class="char-value">${c.value}</span>
        </div>
        <button type="button" class="char-lock" aria-label="Показати або приховати характеристику для інших гравців">
          <!-- ЗАГЛУШКА: тут будуть SVG lock-closed.svg / lock-open.svg -->
          <span class="lock-icon lock-closed" aria-hidden="true">🔒</span>
          <span class="lock-icon lock-open" aria-hidden="true">🔓</span>
        </button>
      </div>`;

  const charItems = data.characteristics.map((c, i) => renderItem(c, i, "")).join("");
  const abilityItems = data.abilities.map((c, i) => renderItem(c, i, "ability-item")).join("");

  return `
    <section class="block" id="block-player-characteristics" data-owner="${ownerName}">
      <div class="block-head">
        <h2>Твої характеристики</h2>
      </div>
      <div class="block-body">
        <div class="char-list" data-group="characteristics">${charItems}</div>
        <p class="char-hint">Ти завжди бачиш свої характеристики. Замочок відкриває їх іншим гравцям у таблиці</p>

        <div class="abilities-block">
          <h3 class="abilities-title">Спец можливості</h3>
          <div class="char-list abilities-list" data-group="abilities">${abilityItems}</div>
        </div>
      </div>
    </section>
  `;
};

// делегований обробник кліку — перемикає видимість ДЛЯ ІНШИХ і сповіщає
// відповідну таблицю (Блок 4 для characteristics, Блок 5 для abilities)
document.addEventListener("click", function (e) {
  const lockBtn = e.target.closest("#block-player-characteristics .char-lock");
  if (!lockBtn) return;

  const item = lockBtn.closest(".char-item");
  const list = lockBtn.closest(".char-list");
  const section = lockBtn.closest("#block-player-characteristics");
  const isOpen = item.classList.toggle("open");
  const label = item.dataset.label;
  const valueEl = item.querySelector(".char-value");
  const group = list.dataset.group; // "characteristics" | "abilities"

  document.dispatchEvent(
    new CustomEvent("bunker:toggle-characteristic", {
      detail: {
        owner: section.dataset.owner,
        group: group,
        label: label,
        value: valueEl.textContent,
        open: isOpen
      }
    })
  );
});
