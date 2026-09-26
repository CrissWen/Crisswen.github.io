// БЛОК 4 — ТАБЛИЦЯ ГРАВЦІВ (перша колонка — ім'я, далі — характеристики)
export function playersTable(columns, players) {
  columns = columns || ["Стать", "Статура", "Риса характеру", "Професія", "Здоров'я", "Хобі / Захоплення", "Фобія / Страх", "Великий багаж", "Рюкзак", "Додаткові відомості"];
  players = players || [
    { name: "Олена", cells: ["Жіноча", "Струнка", "Емпатія", "Хірург", "Астма (легка)", "Гра на гітарі", "Клаустрофобія", "Намет", "Аптечка", "Має карту"] }
  ];

  const getTooltip = (colName) => {
    const lowerCol = colName.toLowerCase();
    
    if (lowerCol.includes("професія") || lowerCol.includes("профессия")) {
      // Ховаємо текст у data-tooltip, жодних вкладених блоків
      return `<span class="info-icon" data-tooltip="Новачок – до 3 місяців;<br>Стажер – від 3 місяців до 1 року;<br>Аматор – від 1 до 2 років;<br>Досвідчений – від 2 до 5 років;<br>Професіонал – від 5 до 10 років;<br>Експерт – понад 10 років.">i</span>`;
    }
    
    if (lowerCol.includes("хобі") || lowerCol.includes("захоплення")) {
      return `<span class="info-icon" data-tooltip="Новачок – до 3 місяців;<br>Аматор – від 3 місяців до 1 року;<br>Досвідчений – від 1 до 2 років;<br>Просунутий – від 2 до 5 років;<br>Майстер (гуру) – понад 5 років.">i</span>`;
    }
    
    return '';
  };

  const cellHtml = (val) =>
    val ? `<span class="cell-value">${val}</span>` : `<span class="cell-empty"></span>`;

  const head = columns.map((c) => `<th>${c} ${getTooltip(c)}</th>`).join("");

  const rows = players
    .map((p, index) => {
      const cells = p.cells
        .map((val, ci) => `<td data-col-label="${columns[ci]}">${cellHtml(val)}</td>`)
        .join("");
      return `
        <tr data-player="${p.name}">
          <td class="player-cell">
            <div class="player-info-wrapper">
              <span class="player-num">${index + 1}</span>
              <span class="avatar">${p.name[0]}</span>
              <span class="player-name">${p.name}</span>
            </div>
          </td>
          ${cells}
        </tr>`;
    })
    .join("");

  return `
    <section class="block" id="block-players-table">
      <div class="block-head" style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0;">Охочі потрапити в бункер: <span style="color: var(--text-mute); font-size: 18px;">${players.length}</span></h2>
      </div>
      <div class="block-body">
        <div class="table-scroll">
          <table class="bunker-table">
            <thead><tr><th>№ Ім'я</th>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </section>
  `;
}

// Синхронізація з Блоком 3
document.addEventListener("bunker:toggle-characteristic", function (e) {
  const { owner, group, label, value, open } = e.detail;
  if (group !== "characteristics") return;

  const row = document.querySelector(
    `#block-players-table tr[data-player="${owner}"]`
  );
  if (!row) return;

  const cell = row.querySelector(`td[data-col-label="${label}"]`);
  if (!cell) return;

  cell.innerHTML = open
    ? `<span class="cell-value">${value}</span>`
    : `<span class="cell-empty"></span>`;
});


// --- ГЛОБАЛЬНИЙ ТУЛТИП (Логіка відображення поверх усього екрану) ---
document.addEventListener("mouseover", function(e) {
  const icon = e.target.closest('.info-icon');
  if (!icon) return;

  // 1. Шукаємо або створюємо глобальний контейнер для підказки в корені сторінки
  let popup = document.getElementById('global-tooltip');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'global-tooltip';
    popup.className = 'global-info-popup';
    document.body.appendChild(popup);
  }

  // 2. Вставляємо текст із властивості data-tooltip нашої іконки
  popup.innerHTML = icon.dataset.tooltip;
  
  // 3. Визначаємо абсолютні координати іконки на екрані
  const rect = icon.getBoundingClientRect();

  // 4. Позиціонуємо підказку рівно над іконкою (віднімаємо 8px для відступу)
  popup.style.left = rect.left + (rect.width / 2) + 'px';
  popup.style.top = (rect.top - 8) + 'px';
  
  popup.classList.add('is-visible');
});

document.addEventListener("mouseout", function(e) {
  const icon = e.target.closest('.info-icon');
  if (!icon) return;
  
  const popup = document.getElementById('global-tooltip');
  if (popup) popup.classList.remove('is-visible');
});