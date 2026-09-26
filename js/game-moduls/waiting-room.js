export function waitingRoom({ roomCode, playersState, isHost }) {
  const pState = playersState || {};
  
  const playersListHtml = Object.values(pState)
    .map(p => `<li style="padding: 8px 12px; background: var(--panel-2); border: 1px solid var(--metal); border-radius: var(--radius-sm); margin-bottom: 8px;">${p.name}</li>`)
    .join('');

  return `
    <section class="block layout-small-centered" id="block-waiting-room">
      <div class="block-head" style="display: flex; justify-content: space-between; align-items: center;">
        <h2>Кімната очікування: <span style="color: var(--accent);">${roomCode}</span></h2>
        <span style="font-size: 13px; color: var(--text-mute);">Гравців: ${Object.keys(pState).length}</span>
      </div>
      <div class="block-body">
        <ul style="list-style: none; padding: 0; margin: 0 0 20px 0;">
          ${playersListHtml}
        </ul>
        ${isHost ? `
          <button id="start-game-btn" style="width: 100%; padding: 12px; border-radius: 6px; background: var(--hazard); color: #000; font-weight: bold; cursor: pointer; border: none; font-size: 15px;">
            Почати гру (Роздати карти)
          </button>
        ` : `
          <p style="text-align: center; color: var(--text-mute); font-size: 14px; margin: 0;">Очікуємо, поки хост запустить гру...</p>
        `}
      </div>
    </section>
  `;
}