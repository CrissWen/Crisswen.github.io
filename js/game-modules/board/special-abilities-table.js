// БЛОК 5 — ТАБЛИЦЯ "СПЕЦ МОЖЛИВОСТІ" (завжди рівно 2 колонки-можливості)
// Якщо можливість ще не відкрита гравцем — комірка просто порожня.
export function specialAbilitiesTable (players) {
  players = players || [
    { name: "Олена",  ability1: "Подвійний голос на голосуванні", ability2: null },
    { name: "Максим", ability1: null, ability2: null },
    { name: "Ірина",  ability1: "Блокування власного вигнання", ability2: "Обмін карткою з іншим гравцем" },
    { name: "Богдан", ability1: "Погляд у колоду дій", ability2: null }
  ];

  const cellHtml = (val) =>
    val ? `<span class="cell-value">${val}</span>` : `<span class="cell-empty"></span>`;

  const rows = players
    .map((p) => {
      const rowClass = p.isKicked ? 'kicked-player' : '';
      return `
        <tr data-player="${p.name}" class="${rowClass}">
          <td class="player-cell"><span class="avatar">${p.name[0]}</span>${p.name}</td>
          <td data-col-label="Спец можливість №1">${cellHtml(p.ability1)}</td>
          <td data-col-label="Спец можливість №2">${cellHtml(p.ability2)}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="block" id="block-special-abilities">
      <div class="block-head">
        <h2>Спец можливості</h2>
      </div>
      <div class="block-body">
        <div class="table-scroll">
          <table class="bunker-table">
            <thead>
              <tr>
                <th>Гравець</th>
                <th>Спец можливість №1</th>
                <th>Спец можливість №2</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
};

// синхронізація з Блоком 3: реагуємо лише на спецможливості
document.addEventListener("bunker:toggle-characteristic", function (e) {
  const { owner, group, label, value, open } = e.detail;
  if (group !== "abilities") return;

  const row = document.querySelector(`#block-special-abilities tr[data-player="${owner}"]`);
  if (!row) return;

  const cell = row.querySelector(`td[data-col-label="${label}"]`);
  if (!cell) return;

  cell.innerHTML = open
    ? `<span class="cell-value">${value}</span>`
    : `<span class="cell-empty"></span>`;
});
