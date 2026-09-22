export function renderAuth() {
  return `
    <section class="block">
      <div class="block-head">
        <h2>Авторизація</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">
        <p class="char-hint">Увійдіть або створіть акаунт, щоб грати.</p>
        <input type="text" id="username" placeholder="Ім'я гравця" style="padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text);">
        <button id="login-btn" style="padding: 10px; border-radius: 6px; background: var(--ok); color: #000; font-weight: bold; cursor: pointer; border: none;">Увійти</button>
      </div>
    </section>
  `;
}