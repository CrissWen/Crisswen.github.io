// БЛОК 4 — ТАБЛИЦЯ ГРАВЦІВ (перша колонка — ім'я, далі — характеристики)
// Якщо характеристика ще не відкрита гравцем — комірка просто порожня.
window.BunkerBlocks = window.BunkerBlocks || {};

window.BunkerBlocks.playersTable = function (columns, players) {
  columns = columns || ["Професія", "Здоров'я", "Хобі / навик", "Фобія", "Багаж"];
  players = players || [
    { name: "Олена",  cells: ["Хірург", null, "Гра на гітарі", null, null] },
    { name: "Максим", cells: [null, "Діабет 2 типу", null, null, "Генератор"] },
    { name: "Ірина",  cells: ["Інженер-електрик", null, null, "Темрява", null] },
    { name: "Богдан", cells: [null, null, "Виживання в лісі", null, null] }
  ];

  const cellHtml = (val) =>
    val ? `<span class="cell-value">${val}</span>` : `<span class="cell-empty"></span>`;

  const head = columns.map((c) => `<th>${c}</th>`).join("");

  const rows = players
    .map((p) => {
      const cells = p.cells
        .map((val, ci) => `<td data-col-label="${columns[ci]}">${cellHtml(val)}</td>`)
        .join("");
      return `
        <tr data-player="${p.name}">
          <td class="player-cell"><span class="avatar">${p.name[0]}</span>${p.name}</td>
          ${cells}
        </tr>`;
    })
    .join("");

  return `
    <section class="block" id="block-players-table">
      <div class="block-head">
        <h2>Гравці</h2>
      </div>
      <div class="block-body">
        <div class="table-scroll">
          <table class="bunker-table">
            <thead><tr><th>Гравець</th>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="char-hint">Порожні комірки з'являються, щойно гравець відкриє замочок у Блоці 3</p>
      </div>
    </section>
  `;
};

// синхронізація з Блоком 3: реагуємо лише на характеристики (не на спецможливості —
// для них є окрема таблиця в Блоці 5)
document.addEventListener("bunker:toggle-characteristic", function (e) {
  const { owner, group, label, value, open } = e.detail;
  if (group !== "characteristics") return;

  const row = document.querySelector(
    `#block-players-table tr[data-player="${owner}"]`
  );
  if (!row) return;

  const cell = row.querySelector(`td[data-col-label="${label}"]`);
  if (!cell) return; // характеристика без відповідної колонки в таблиці — пропускаємо

  cell.innerHTML = open
    ? `<span class="cell-value">${value}</span>`
    : `<span class="cell-empty"></span>`;
});
