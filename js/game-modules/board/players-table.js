import { describeScale } from '../../utils/auth/experience.js';
import { esc, unescapeApos, renderSafeNodes } from '../../utils/auth/security.js';
import { avatarImgHtml, getAvatarPaddingStyle, profileTriggerAttrs } from '../../utils/auth/avatar.js';
import { getPlayersViewMode, isPlayerCardExpanded } from './board-ui-state.js';
import { ICONS } from '../../constants/icons.js';
import { firstChar } from '../../utils/auth/initial.js';

// Безпечний рендер підказки: дозволяє лише текст, <b> та <br>, відкидає будь-які інші теги, атрибути та скрипти
function renderSafeTooltip(popup, rawTooltip) {
  renderSafeNodes(popup, rawTooltip, ['b', 'br']);
}

// Очищає HTML-теги (зокрема .info-icon) для короткого текстового прев'ю у шапці згорнутої картки гравця
function stripTooltipHtml(valHtml) {
  if (!valHtml) return '';
  return String(valHtml)
    .replace(/<span class="info-icon"[^>]*>.*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// БЛОК 4 — ТАБЛИЦЯ ГРАВЦІВ (перша колонка — ім'я, далі — характеристики) + МОБІЛЬНІ АКОРДЕОН-КАРТКИ
// aliveCount / totalCount — лічильник "Живі / Всі" у заголовку (#bunker-candidates-count).
// Якщо не передано, лічильник рахується по масиву players (стара поведінка).
// isHost — лише ведучий бачить кнопку "Вигнати" / "Повернути" (players[i].id, players[i].isKicked).
// stageScales — bunker_state.stage_scales ({ profession?: [...], hobby?: [...] }): шкала стадій пака для підказок.
// opts.final — фінальний режим (гру завершено): без кнопок «Вигнати», з позначками «Вибув / Пройшов» і значком замка біля характеристик,
// які не було відкрито (players[i].cellsOpen[ci] === false, див. board-view-model.js з reveal). aliveCount тут = кількість тих, хто пройшов.
export function playersTable(columns, players, aliveCount, totalCount, isHost, stageScales, opts = {}) {
  const isFinal = !!opts.final;
  columns = columns || ["Стать", "Статура", "Риса характеру", "Професія", "Здоров'я", "Хобі / Захоплення", "Фобія / Страх", "Великий багаж", "Рюкзак", "Додаткові відомості"];
  players = players || [
    { name: "Олена", cells: ["Жіноча", "Струнка", "Емпатія", "Хірург", "Астма (легка)", "Гра на гітарі", "Клаустрофобія", "Намет", "Аптечка", "Має карту"] }
  ];

  const getTooltip = (colName) => {
    const lowerCol = colName.toLowerCase();

    if (stageScales && typeof stageScales === 'object') {
      const type = (lowerCol.includes("професія") || lowerCol.includes("профессия")) ? 'profession'
        : (lowerCol.includes("хобі") || lowerCol.includes("захоплення")) ? 'hobby' : null;
      const lines = type ? describeScale(stageScales[type]) : [];
      if (!lines.length) return '';
      // esc двічі: один раз для атрибута, другий — щоб renderSafeTooltip не видав назву за HTML
      const text = lines.map(l => esc(esc(l))).join(';<br>') + '.';
      return `<span class="info-icon" data-tooltip="${text}" tabindex="0" role="button" aria-label="Підказка">i</span>`;
    }

    if (lowerCol.includes("професія") || lowerCol.includes("профессия")) {
      return `
      <span class="info-icon" data-tooltip="Новачок – до 3 місяців;
      <br>Стажер – від 3 місяців до 1 року;
      <br>Любитель – від 1 до 2 років;
      <br>Досвідчений – від 2 до 5 років;
      <br>Просунутий – від 5 до 10 років;
      <br>Майстер – понад 10 років." tabindex="0" role="button" aria-label="Підказка">i</span>`;
    }
    
    if (lowerCol.includes("хобі") || lowerCol.includes("захоплення")) {
      return `
      <span class="info-icon" data-tooltip="Новачок – до 3 місяців;
      <br>Любитель – від 3 місяців до 1 року;
      <br>Досвідчений – від 1 до 2 років;
      <br>Просунутий – від 2 до 5 років;
      <br>Майстер (гуру) – понад 5 років." tabindex="0" role="button" aria-label="Підказка">i</span>`;
    }
    
    return '';
  };

  const lockIcon = `<span class="cell-lock" style="-webkit-mask-image:url('${ICONS.LOCKED_LOCK}');mask-image:url('${ICONS.LOCKED_LOCK}');" aria-hidden="true"></span>`;
  const cellHtml = (val, open = true) => {
    if (!val) return `<span class="cell-empty"></span>`;
    if (open) return `<span class="cell-value">${val}</span>`;
    return `<span class="cell-value cell-value--unrevealed" title="Не було відкрито на момент завершення гри">${lockIcon}${val}</span>`;
  };
  const isOutPlayer = (p) => (isFinal ? !!p.isOut : !!p.isKicked);
  const statusBadge = (p) => {
    if (!isFinal) return '';
    return isOutPlayer(p)
      ? '<span class="final-badge final-badge--out">Вибув</span>'
      : '<span class="final-badge final-badge--passed">Пройшов</span>';
  };

  const head = columns.map((c) => `<th>${esc(c)} ${getTooltip(c)}</th>`).join("");

  const kickToggle = (p) => {
    if (isFinal || !isHost || !p.id) return "";
    const label = p.isKicked ? "Повернути" : "Вигнати";
    const stateClass = p.isKicked ? " is-return" : "";
    return `<div class="kick-action-btn${stateClass}" data-kick-id="${esc(p.id)}">${label}</div>`;
  };

  const rows = players
    .map((p, index) => {
      const cells = (p.cells || [])
        .map((val, ci) => `<td data-col-label="${esc(columns[ci] || '')}">${cellHtml(val, p.cellsOpen ? p.cellsOpen[ci] !== false : true)}</td>`)
        .join("");
      const rowClass = isOutPlayer(p) ? 'kicked-player' : '';
      const cleanName = unescapeApos(p.name);
      const firstLetter = firstChar(cleanName);
      const avatarPadding = getAvatarPaddingStyle(firstLetter, 2);
      return `
        <tr data-player="${esc(cleanName)}" class="${rowClass}">
          <td class="player-cell">
            <div class="player-info-wrapper">
              <span class="player-num">${index + 1}</span>
              <span class="avatar" style="${avatarPadding}" ${profileTriggerAttrs(p.id, cleanName, { focusable: true })}>${esc(firstLetter)}${avatarImgHtml(p.id)}</span>
              <div class="player-name-wrapper">
                <div class="player-nickname">${esc(cleanName)}</div>
                ${statusBadge(p)}
                ${kickToggle(p)}
              </div>
            </div>
          </td>
          ${cells}
        </tr>`;
    })
    .join("");

  // Мобільні акордеон-картки гравців
  const playerKeys = [];
  const cardsHtml = players
    .map((p, index) => {
      const cleanName = unescapeApos(p.name);
      const playerKey = String(p.id || cleanName || index);
      playerKeys.push(playerKey);
      const isExpanded = isPlayerCardExpanded(playerKey);
      const firstLetter = firstChar(cleanName);
      const avatarPadding = getAvatarPaddingStyle(firstLetter, 2);
      const kickedClass = isOutPlayer(p) ? ' kicked-player' : '';
      const expandedClass = isExpanded ? ' is-expanded' : '';

      const cellEntries = columns.map((colName, ci) => ({
        label: colName,
        val: p.cells?.[ci] ?? null,
        open: p.cellsOpen ? p.cellsOpen[ci] !== false : true
      }));
      const openedEntries = cellEntries.filter(e => !!e.val && e.open);
      const previewChips = openedEntries
        .slice(0, 3)
        .map(e => {
          const text = stripTooltipHtml(e.val);
          return text ? `<span class="player-acc-chip">${esc(e.label)}: <strong>${text}</strong></span>` : '';
        })
        .filter(Boolean)
        .join('');

      const fieldsHtml = cellEntries
        .map(e => `
          <div class="player-acc-field${e.val ? ' is-open' : ' is-hidden-val'}">
            <span class="player-acc-field__label">${esc(e.label)} ${getTooltip(e.label)}</span>
            <span class="player-acc-field__value">${e.val ? cellHtml(e.val, e.open) : '<span class="cell-empty-text">Приховано</span>'}</span>
          </div>
        `)
        .join('');

      return `
        <article class="player-acc-card${expandedClass}${kickedClass}" data-player-key="${esc(playerKey)}" data-player="${esc(cleanName)}">
          <div class="player-acc-card__top">
            <button type="button" class="player-acc-card__toggle" data-player-card-toggle="${esc(playerKey)}" aria-expanded="${isExpanded}">
              <div class="player-acc-card__identity">
                <span class="player-num">${index + 1}</span>
                <span class="avatar" style="${avatarPadding}" ${profileTriggerAttrs(p.id, cleanName)}>${esc(firstLetter)}${avatarImgHtml(p.id)}</span>
                <span class="player-nickname">${esc(cleanName)}</span>
                ${statusBadge(p)}
              </div>
              <div class="player-acc-card__meta">
                <span class="player-acc-card__badge" title="Відкрито характеристик">${openedEntries.length}/${columns.length}</span>
                <span class="player-acc-card__arrow" aria-hidden="true">▾</span>
              </div>
            </button>
            ${kickToggle(p)}
          </div>
          ${previewChips ? `<div class="player-acc-card__preview" data-player-card-toggle="${esc(playerKey)}">${previewChips}</div>` : ''}
          <div class="player-acc-card__body">
            <div class="player-acc-grid">${fieldsHtml}</div>
          </div>
        </article>
      `;
    })
    .join("");

  const alive = aliveCount ?? players.length;
  const total = totalCount ?? players.length;
  const viewMode = getPlayersViewMode();
  const allExpanded = playerKeys.length > 0 && playerKeys.every(k => isPlayerCardExpanded(k));

  return `
    <section class="block" id="block-players-table">
      <div class="block-head players-block-head">
        <h2 id="players-table-heading" style="margin: 0;">Охочі потрапити в бункер <span id="bunker-candidates-count" class="candidates-count">${alive} / ${total}</span></h2>
        <div class="players-view-controls" role="group" aria-label="Режим відображення гравців">
          <button type="button" class="players-view-btn${viewMode === 'cards' ? ' is-active' : ''}" data-players-view="cards" aria-pressed="${viewMode === 'cards'}">Картки</button>
          <button type="button" class="players-view-btn${viewMode === 'table' ? ' is-active' : ''}" data-players-view="table" aria-pressed="${viewMode === 'table'}">Таблиця</button>
          <button type="button" class="players-expand-all-btn" data-players-expand-all aria-expanded="${allExpanded}">${allExpanded ? 'Згорнути всі' : 'Розгорнути всі'}</button>
        </div>
      </div>
      <div class="block-body">
        <div class="players-board-container" data-view-mode="${esc(viewMode)}">
          <div class="players-cards-list">
            ${cardsHtml}
          </div>
          <div class="table-scroll" tabindex="0" role="region" aria-labelledby="players-table-heading">
            <table class="bunker-table">
              <thead><tr><th>№ Ім'я</th>${head}</tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <p class="survival-test-hint">
          Щоб дізнатися, чи вижив ваш бункер після закінчення гри, ви можете пройти тест
          <a class="survival-test-link" href="survival-test.html" target="_blank" rel="noopener noreferrer">"Оцінка виживання бункера"</a>
        </p>
      </div>
    </section>
  `;
}


// --- ГЛОБАЛЬНИЙ ТУЛТИП (Логіка відображення поверх усього екрану з підтримкою тач-екранів і меж вікна) ---
let activeTooltipIcon = null;

function ensureGlobalTooltip() {
  let popup = document.getElementById('global-tooltip');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'global-tooltip';
    popup.className = 'global-info-popup';
    document.body.appendChild(popup);
  }
  return popup;
}

function showTooltipForIcon(icon) {
  const popup = ensureGlobalTooltip();
  renderSafeTooltip(popup, icon.dataset.tooltip);
  activeTooltipIcon = icon;

  // Спочатку робимо видимим для точного вимірювання ширини/висоти
  popup.classList.remove('is-flipped');
  popup.classList.add('is-visible');

  const rect = icon.getBoundingClientRect();
  const popupWidth = popup.offsetWidth || 220;
  const popupHeight = popup.offsetHeight || 80;
  const margin = 12;

  const iconCenterX = rect.left + (rect.width / 2);
  const minCenterX = margin + (popupWidth / 2);
  const maxCenterX = Math.max(minCenterX, window.innerWidth - margin - (popupWidth / 2));
  const clampedCenterX = Math.min(maxCenterX, Math.max(minCenterX, iconCenterX));

  popup.style.left = clampedCenterX + 'px';

  if (rect.top - popupHeight - 12 < 8) {
    popup.classList.add('is-flipped');
    popup.style.top = (rect.bottom + 8) + 'px';
  } else {
    popup.style.top = (rect.top - 8) + 'px';
  }
}

export function hideGlobalTooltip() {
  const popup = document.getElementById('global-tooltip');
  if (popup) popup.classList.remove('is-visible', 'is-flipped');
  activeTooltipIcon = null;
}

document.addEventListener("mouseover", function(e) {
  const icon = e.target.closest('.info-icon');
  if (!icon) return;
  showTooltipForIcon(icon);
});

document.addEventListener("mouseout", function(e) {
  const icon = e.target.closest('.info-icon');
  if (!icon) return;
  hideGlobalTooltip();
});

// Підтримка тапу на телефонах: клік по .info-icon відкриває/закриває підказку, клік повз — закриває
document.addEventListener("click", function(e) {
  const icon = e.target.closest('.info-icon');
  if (icon) {
    e.stopPropagation();
    const popup = document.getElementById('global-tooltip');
    if (activeTooltipIcon === icon && popup?.classList.contains('is-visible')) {
      hideGlobalTooltip();
    } else {
      showTooltipForIcon(icon);
    }
    return;
  }
  if (activeTooltipIcon) {
    hideGlobalTooltip();
  }
}, true);

window.addEventListener("scroll", () => {
  if (activeTooltipIcon) hideGlobalTooltip();
}, { passive: true });
