import { esc, unescapeApos } from '../../utils/security.js';
import { avatarImgHtml, profileTriggerAttrs } from '../../utils/avatar.js';
import { isBlockCollapsed } from './board-ui-state.js';

// БЛОК 5 — ТАБЛИЦЯ "СПЕЦ МОЖЛИВОСТІ" (завжди рівно 2 колонки-можливості)
// Якщо можливість ще не відкрита гравцем — комірка просто порожня.
export function specialAbilitiesTable(players) {
  players = players || [
    { name: "Олена",  ability1: "Подвійний голос на голосуванні", ability2: null },
    { name: "Максим", ability1: null, ability2: null },
    { name: "Ірина",  ability1: "Блокування власного вигнання", ability2: "Обмін карткою з іншим гравцем" },
    { name: "Богдан", ability1: "Погляд у колоду дій", ability2: null }
  ];

  const blockId = 'block-special-abilities';
  const collapsed = isBlockCollapsed(blockId);

  const cellHtml = (val) => {
    if (!val) return '<span class="cell-empty"></span>';
    return `<span class="cell-value">${esc(unescapeApos(val))}</span>`;
  };

  const rows = players
    .map((p) => {
      const rowClass = p.isKicked ? 'kicked-player' : '';
      const cleanName = unescapeApos(p.name);
      const firstLetter = cleanName ? cleanName[0] : '';
      return `
        <tr data-player="${esc(cleanName)}" class="${rowClass}">
          <td class="player-cell"><span class="avatar" ${profileTriggerAttrs(p.id, cleanName, { focusable: true })}>${esc(firstLetter)}${avatarImgHtml(p.id)}</span>${esc(cleanName)}</td>
          <td data-col-label="Спец можливість №1">${cellHtml(p.ability1)}</td>
          <td data-col-label="Спец можливість №2">${cellHtml(p.ability2)}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="block${collapsed ? ' is-collapsed' : ''}" id="${blockId}">
      <button type="button" class="block-head block-head--collapsible" data-block-toggle="${blockId}" aria-expanded="${!collapsed}" aria-controls="${blockId}-body">
        <h2 id="special-abilities-heading">Спец можливості</h2>
        <span class="block-toggle-arrow${collapsed ? ' is-collapsed' : ''}" aria-hidden="true">▼</span>
      </button>
      <div class="block-body special-abilities-container" id="${blockId}-body">
        <div class="table-scroll" tabindex="0" role="region" aria-labelledby="special-abilities-heading">
          <table class="bunker-table special-abilities-table">
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
}
