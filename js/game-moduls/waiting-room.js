// minPlayers / maxPlayers — з конфігу балансу (config-manager.js: minPlayersToStart / maxPlayersInLobby), викликач — game.js.
// Тут немає зашитих чисел: інакше локальне перевизначення в game-config.local.js не змінювало б кнопку «Почати гру» і підказку.
export function waitingRoom({ roomCode, playersState, isHost, minPlayers, maxPlayers }) {
  const pState = playersState || {};
  const playersCount = Object.keys(pState).length;

  // Ліміти лобі: мінімум для старту гри та максимум місць у кімнаті до старту (перевірка максимуму при вході — в game.js)
  const MIN_PLAYERS_TO_START = minPlayers;
  const MAX_PLAYERS_IN_LOBBY = maxPlayers;
  const canStart = playersCount >= MIN_PLAYERS_TO_START;

  // Повне посилання на основі поточного домену: origin + pathname (без старого hash), далі власний #/lobby?join=
  const inviteLink = `${window.location.origin}${window.location.pathname}#/lobby?join=${roomCode}`;

  const playersListHtml = Object.values(pState)
    .map(p => `<li style="padding: 8px 12px; background: var(--panel-2); border: 1px solid var(--metal); border-radius: var(--radius-sm); margin-bottom: 8px;">${p.name}</li>`)
    .join('');

  return `
    <section class="block layout-small-centered" id="block-waiting-room">
      <div class="block-head">
        <h2>Кімната очікування: <span style="color: var(--accent);">${roomCode}</span></h2>
      </div>
      <div class="block-body">
        <div style="margin-bottom: 20px; padding: 14px; background: var(--panel-2); border: 1px solid var(--metal); border-radius: var(--radius-sm);">
          <p style="margin: 0 0 12px; font-size: 13px; color: var(--text-mute);">Запросіть друзів</p>

          <label style="display: block; font-size: 11.5px; color: var(--text-mute); margin-bottom: 4px;">Код кімнати</label>
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
            <input type="text" readonly value="${roomCode}" data-copy-source="code"
              style="flex: 1; min-width: 0; padding: 9px 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel); color: var(--text); font-family: var(--mono); font-size: 15px; letter-spacing: .1em;">
            <button type="button" data-copy-target="code"
              style="padding: 9px 12px; border-radius: 6px; border: 1px solid var(--metal-lt); background: var(--panel); color: var(--text); cursor: pointer; font-size: 13px; white-space: nowrap; font-family: var(--body);">Копіювати</button>
          </div>

          <label style="display: block; font-size: 11.5px; color: var(--text-mute); margin-bottom: 4px;">Посилання-запрошення</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" readonly value="${inviteLink}" data-copy-source="link"
              style="flex: 1; min-width: 0; padding: 9px 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel); color: var(--text); font-size: 13px;">
            <button type="button" data-copy-target="link"
              style="padding: 9px 12px; border-radius: 6px; border: 1px solid var(--metal-lt); background: var(--panel); color: var(--text); cursor: pointer; font-size: 13px; white-space: nowrap; font-family: var(--body);">Копіювати</button>
          </div>
        </div>

        <hr class="section-divider">

        <div class="players-list-head">
          <strong>Гравці:</strong>
          <span id="list-players-count">${playersCount}</span>
        </div>

        <ul style="list-style: none; padding: 0; margin: 0 0 20px 0;">
          ${playersListHtml}
        </ul>
        ${isHost ? `
          <p class="lobby-start-hint ${canStart ? 'is-ready' : ''}" id="lobby-start-hint">
            Щоб почати гру, потрібно як мінімум ${MIN_PLAYERS_TO_START} осіб. (${playersCount}/${MAX_PLAYERS_IN_LOBBY})
          </p>
          <button id="start-game-btn" ${canStart ? '' : 'disabled'} style="width: 100%; padding: 12px; border-radius: 6px; background: var(--hazard); color: #000; font-weight: bold; cursor: pointer; border: none; font-size: 15px;">
            Почати гру
          </button>
        ` : ` 
          <p style="text-align: center; color: var(--text-mute); font-size: 14px; margin: 0;">Очікуємо, поки хост запустить гру...</p>
        `}
      </div>
    </section>
  `;
}