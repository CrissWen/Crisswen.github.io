export function renderLobby() {
  return `
    <section class="block">
      <div class="block-head">
        <h2>Лобі</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">
        <button id="create-room-btn" style="padding: 10px; border-radius: 6px; background: var(--accent); color: #000; font-weight: bold; cursor: pointer; border: none;">Створити кімнату</button>
        <hr style="width: 100%; border-color: var(--metal-lt);">
        <input type="text" id="room-code" placeholder="Код кімнати (напр. ABCD)" style="padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text);">
        <button id="join-room-btn" style="padding: 10px; border-radius: 6px; background: var(--hazard); color: #000; font-weight: bold; cursor: pointer; border: none;">Приєднатися</button>
      </div>
    </section>
  `;
}