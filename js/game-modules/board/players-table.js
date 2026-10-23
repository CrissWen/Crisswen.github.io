function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

// Безпечний рендер підказки: дозволяє лише текст, <b> та <br>, відкидає будь-які інші теги, атрибути та скрипти
function renderSafeTooltip(popup, rawTooltip) {
  popup.textContent = '';
  if (!rawTooltip) return;

  const parser = new DOMParser();
  const doc = parser.parseFromString(rawTooltip, 'text/html');

  function appendSafe(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'b') {
        const b = document.createElement('b');
        for (const child of node.childNodes) {
          appendSafe(child, b);
        }
        target.appendChild(b);
      } else if (tag === 'br') {
        target.appendChild(document.createElement('br'));
      } else {
        for (const child of node.childNodes) {
          appendSafe(child, target);
        }
      }
    }
  }

  for (const child of doc.body.childNodes) {
    appendSafe(child, popup);
  }
}

// БЛОК 4 — ТАБЛИЦЯ ГРАВЦІВ (перша колонка — ім'я, далі — характеристики)
// aliveCount / totalCount — лічильник "Живі / Всі" у заголовку (#bunker-candidates-count).
// Якщо не передано, лічильник рахується по масиву players (старa поведінка).
// isHost — лише ведучий бачить кнопку "Вигнати" / "Повернути" (players[i].id, players[i].isKicked).
export function playersTable(columns, players, aliveCount, totalCount, isHost) {
  columns = columns || ["Стать", "Статура", "Риса характеру", "Професія", "Здоров'я", "Хобі / Захоплення", "Фобія / Страх", "Великий багаж", "Рюкзак", "Додаткові відомості"];
  players = players || [
    { name: "Олена", cells: ["Жіноча", "Струнка", "Емпатія", "Хірург", "Астма (легка)", "Гра на гітарі", "Клаустрофобія", "Намет", "Аптечка", "Має карту"] }
  ];

  const getTooltip = (colName) => {
    const lowerCol = colName.toLowerCase();
    
    if (lowerCol.includes("професія") || lowerCol.includes("профессия")) {
      // Ховаємо текст у data-tooltip, жодних вкладених блоків
      return `
      <span class="info-icon" data-tooltip="Новачок – до 3 місяців;
      <br>Стажер – від 3 місяців до 1 року;
      <br>Любитель – від 1 до 2 років;
      <br>Досвідчений – від 2 до 5 років;
      <br>Просунутий – від 5 до 10 років;
      <br>Майстер – понад 10 років.">i</span>`;
    }
    
    if (lowerCol.includes("хобі") || lowerCol.includes("захоплення")) {
      return `
      <span class="info-icon" data-tooltip="Новачок – до 3 місяців;
      <br>Любитель – від 3 місяців до 1 року;
      <br>Досвідчений – від 1 до 2 років;
      <br>Просунутий – від 2 до 5 років;
      <br>Майстер (гуру) – понад 5 років.">i</span>`;
    }
    
    return '';
  };

  const cellHtml = (val) =>
    val ? `<span class="cell-value">${val}</span>` : `<span class="cell-empty"></span>`;

  const head = columns.map((c) => `<th>${esc(c)} ${getTooltip(c)}</th>`).join("");

  const kickToggle = (p) => {
    if (!isHost || !p.id) return "";
    const label = p.isKicked ? "Повернути" : "Вигнати";
    const stateClass = p.isKicked ? " is-return" : "";
    return `<div class="kick-action-btn${stateClass}" data-kick-id="${esc(p.id)}">${label}</div>`;
  };

  const rows = players
    .map((p, index) => {
      const cells = p.cells
        .map((val, ci) => `<td data-col-label="${esc(columns[ci])}">${cellHtml(val)}</td>`)
        .join("");
      const rowClass = p.isKicked ? 'kicked-player' : '';
      const firstLetter = (p.name || '').charAt(0);
      const avatarPadding = /^[gjpqyуфщц]/i.test(firstLetter) ? 'padding-bottom: 2px;' : 'padding-bottom: 0;';
      return `
        <tr data-player="${esc(p.name)}" class="${rowClass}">
          <td class="player-cell">
            <div class="player-info-wrapper">
              <span class="player-num">${index + 1}</span>
              <span class="avatar" style="${avatarPadding}">${esc(firstLetter)}</span>
              <div class="player-name-wrapper">
                <div class="player-nickname">${esc(p.name)}</div>
                ${kickToggle(p)}
              </div>
            </div>
          </td>
          ${cells}
        </tr>`;
    })
    .join("");

  const alive = aliveCount ?? players.length;
  const total = totalCount ?? players.length;

  return `
    <section class="block" id="block-players-table">
      <div class="block-head" style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0;">Охочі потрапити в бункер <span id="bunker-candidates-count" style="color: var(--text-mute); font-size: 18px;">${alive} / ${total}</span></h2>
      </div>
      <div class="block-body">
        <div class="table-scroll">
          <table class="bunker-table">
            <thead><tr><th>№ Ім'я</th>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="survival-test-hint">
          Щоб дізнатися, чи вижив ваш бункер після закінчення гри, ви можете пройти тест
          <a class="survival-test-link" href="survival-test.html" target="_blank" rel="noopener noreferrer">"Оцінка виживання бункера"</a>
        </p>
      </div>
    </section>
  `;
}


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

  // 2. Вставляємо безпечно вміст із властивості data-tooltip нашої іконки
  renderSafeTooltip(popup, icon.dataset.tooltip);
  
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