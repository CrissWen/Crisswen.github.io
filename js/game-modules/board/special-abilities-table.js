import { esc, unescapeApos } from '../../utils/security.js';
import { avatarImgHtml, profileTriggerAttrs } from '../../utils/avatar.js';
import { isBlockCollapsed } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';
import { firstChar } from '../../utils/initial.js';

// БЛОК 5 — ТАБЛИЦЯ "СПЕЦ МОЖЛИВОСТІ" (завжди рівно 2 колонки-можливості)
// Якщо можливість ще не відкрита гравцем — комірка просто порожня.
// opts.final — фінал гри: усі здібності показані, невідкриті (players[i].abilityNOpen === false) зі значком замка, додано «Вибув / Пройшов».
export function specialAbilitiesTable(players, opts = {}) {
  const isFinal = !!opts.final;
  players = players || [
    { name: "Олена",  ability1: "Подвійний голос на голосуванні", ability2: null },
    { name: "Максим", ability1: null, ability2: null },
    { name: "Ірина",  ability1: "Блокування власного вигнання", ability2: "Обмін карткою з іншим гравцем" },
    { name: "Богдан", ability1: "Погляд у колоду дій", ability2: null }
  ];

  const blockId = 'block-special-abilities';
  const collapsed = isBlockCollapsed(blockId);

  const lockIcon = `<span class="cell-lock" style="-webkit-mask-image:url('${ICONS.LOCKED_LOCK}');mask-image:url('${ICONS.LOCKED_LOCK}');" aria-hidden="true"></span>`;
  const cellHtml = (val, open = true) => {
    if (!val) return '<span class="cell-empty"></span>';
    const text = esc(unescapeApos(val));
    if (open) return `<span class="cell-value">${text}</span>`;
    return `<span class="cell-value cell-value--unrevealed" title="Не було відкрито на момент завершення гри">${lockIcon}${text}</span>`;
  };
  const isOutPlayer = (p) => (isFinal ? !!p.isOut : !!p.isKicked);
  const statusBadge = (p) => {
    if (!isFinal) return '';
    return isOutPlayer(p)
      ? ' <span class="final-badge final-badge--out">Вибув</span>'
      : ' <span class="final-badge final-badge--passed">Пройшов</span>';
  };

  const rows = players
    .map((p) => {
      const rowClass = isOutPlayer(p) ? 'kicked-player' : '';
      const cleanName = unescapeApos(p.name);
      const firstLetter = firstChar(cleanName);
      return `
        <tr data-player="${esc(cleanName)}" class="${rowClass}">
          <td class="player-cell"><span class="avatar" ${profileTriggerAttrs(p.id, cleanName, { focusable: true })}>${esc(firstLetter)}${avatarImgHtml(p.id)}</span>${esc(cleanName)}${statusBadge(p)}</td>
          <td data-col-label="Спец можливість №1">${cellHtml(p.ability1, p.ability1Open !== false)}</td>
          <td data-col-label="Спец можливість №2">${cellHtml(p.ability2, p.ability2Open !== false)}</td>
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
