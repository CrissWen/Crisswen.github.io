function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

// БЛОК 5 — ТАБЛИЦЯ "СПЕЦ МОЖЛИВОСТІ" (завжди рівно 2 колонки-можливості)
// Якщо можливість ще не відкрита гравцем — комірка просто порожня.
export function specialAbilitiesTable (players) {
  players = players || [
    { name: "Олена",  ability1: "Подвійний голос на голосуванні", ability2: null },
    { name: "Максим", ability1: null, ability2: null },
    { name: "Ірина",  ability1: "Блокування власного вигнання", ability2: "Обмін карткою з іншим гравцем" },
    { name: "Богдан", ability1: "Погляд у колоду дій", ability2: null }
  ];

  const cellHtml = (val) => {
    if (!val) return '<span class="cell-empty"></span>';
    const cleanVal = String(val).replace(/&amp;#39;|&amp;apos;/g, "'").replace(/&#39;|&apos;/g, "'");
    return `<span class="cell-value">${esc(cleanVal)}</span>`;
  };

  const rows = players
    .map((p) => {
      const rowClass = p.isKicked ? 'kicked-player' : '';
      const cleanName = String(p.name ?? '').replace(/&amp;#39;|&amp;apos;/g, "'").replace(/&#39;|&apos;/g, "'");
      const firstLetter = cleanName ? cleanName[0] : '';
      return `
        <tr data-player="${esc(cleanName)}" class="${rowClass}">
          <td class="player-cell"><span class="avatar">${esc(firstLetter)}</span>${esc(cleanName)}</td>
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

