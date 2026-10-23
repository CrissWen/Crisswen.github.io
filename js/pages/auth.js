import { supabase } from '../services/supabase.js';

export function renderAuth() {
  return `
    <section class="block">
      <div class="block-head">
        <h2>Авторизація</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">
        <p class="char-hint">Введіть своє ім'я, щоб увійти в гру.</p>
        <input type="text" id="username" placeholder="Ім'я гравця" style="padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text);">
        <button id="login-btn" style="padding: 10px; border-radius: 6px; background: var(--ok); color: #000; font-weight: bold; cursor: pointer; border: none;">Увійти</button>
        <p id="auth-error" style="color: var(--danger); font-size: 13px; display: none;"></p>
      </div>
    </section>
  `;
}

// Логіка, яка запускається після того, як HTML з'явився на сторінці
export function initAuth() {
  const loginBtn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('username');
  const errorText = document.getElementById('auth-error');

  loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) {
      errorText.textContent = "Будь ласка, введіть ім'я!";
      errorText.style.display = 'block';
      return;
    }

    loginBtn.textContent = "Завантаження...";
    loginBtn.disabled = true;

    try {
      // Авторизація гостя з передачею нікнейму (який підхопить наш SQL-тригер)
      const { data, error } = await supabase.auth.signInAnonymously({
        options: {
          data: { username: username }
        }
      });

      if (error) throw error;

      // Успішний вхід — перенаправляємо гравця в Лобі
      window.location.hash = '#/lobby';

    } catch (err) {
      errorText.textContent = "Помилка входу: " + err.message;
      errorText.style.display = 'block';
      loginBtn.textContent = "Увійти";
      loginBtn.disabled = false;
    }
  });
}