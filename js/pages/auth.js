import { supabase } from '../services/supabase.js';

const inputStyle = "padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text);";

const HINT_TEXT = {
  login: "Введіть ім'я та пароль, щоб увійти в гру.",
  register: "Придумайте ім'я та пароль, щоб створити акаунт."
};

const BUTTON_TEXT = {
  login: "Увійти",
  register: "Створити акаунт"
};

export function renderAuth() {
  return `
    <section class="block layout-small-centered">
      <div class="block-head">
        <h2>Авторизація</h2>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">

        <!-- Контейнер А: форма входу/реєстрації. Видно, коли сесії немає (стандартний сценарій). -->
        <div id="auth-form-container" style="display: flex; flex-direction: column; gap: 14px;">
          <div id="auth-mode-switch" style="display: flex; border: 1px solid var(--metal); border-radius: 6px; overflow: hidden;">
            <button type="button" class="auth-mode-tab is-active" data-mode="login"
              style="flex: 1; padding: 10px; border: none; cursor: pointer; font-weight: 600; background: var(--panel-2); color: var(--text);">
              Увійти
            </button>
            <button type="button" class="auth-mode-tab" data-mode="register"
              style="flex: 1; padding: 10px; border: none; border-left: 1px solid var(--metal); cursor: pointer; font-weight: 600; background: transparent; color: var(--text-mute);">
              Зареєструватися
            </button>
          </div>

          <p class="char-hint" id="auth-hint">${HINT_TEXT.login}</p>

          <input type="text" id="username" placeholder="Ім'я гравця" style="${inputStyle}">
          <input type="password" id="password" placeholder="Пароль" style="${inputStyle}">

          <button id="login-btn" style="padding: 10px; border-radius: 6px; background: var(--ok); color: #000; font-weight: bold; cursor: pointer; border: none;">${BUTTON_TEXT.login}</button>
          <p id="auth-error" style="color: var(--danger); font-size: 13px; display: none;"></p>
        </div>

        <!-- Контейнер Б: профіль уже залогіненого гравця. Прихований за замовчуванням — показує initAuth(),
             якщо supabase.auth.getSession() поверне активну сесію (наприклад, гравець зайшов сюди через кнопку "Профіль" у хедері). -->
        <div id="auth-profile-container" style="display: none; flex-direction: column; gap: 14px;">
          <p id="auth-profile-text" style="margin: 0; font-size: 15px; color: var(--text);"></p>
          <button id="profile-lobby-btn" style="padding: 10px; border-radius: 6px; background: var(--accent); color: #000; font-weight: bold; cursor: pointer; border: none;">Повернутися в лобі</button>
          <button id="profile-logout-btn" style="padding: 10px; border-radius: 6px; background: var(--danger); color: #1a0806; font-weight: bold; cursor: pointer; border: none;">Вийти з акаунта</button>
        </div>

      </div>
    </section>
  `;
}

// Логіка, яка запускається після того, як HTML з'явився на сторінці
export async function initAuth() {
  const formContainer = document.getElementById('auth-form-container');
  const profileContainer = document.getElementById('auth-profile-container');
  const profileText = document.getElementById('auth-profile-text');
  const profileLobbyBtn = document.getElementById('profile-lobby-btn');
  const profileLogoutBtn = document.getElementById('profile-logout-btn');

  const modeSwitch = document.getElementById('auth-mode-switch');
  const hintEl = document.getElementById('auth-hint');
  const loginBtn = document.getElementById('login-btn');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorText = document.getElementById('auth-error');

  // Поточний режим форми: 'login' або 'register'. Сама логіка входу/реєстрації —
  // окремий етап (тут лише перемикання вигляду форми, як просить ТЗ).
  let mode = 'login';

  function setMode(newMode) {
    mode = newMode;

    modeSwitch.querySelectorAll('.auth-mode-tab').forEach(tab => {
      const isActive = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', isActive);
      tab.style.background = isActive ? 'var(--panel-2)' : 'transparent';
      tab.style.color = isActive ? 'var(--text)' : 'var(--text-mute)';
    });

    hintEl.textContent = HINT_TEXT[mode];
    loginBtn.textContent = BUTTON_TEXT[mode];

    errorText.style.display = 'none';
  }

  modeSwitch.addEventListener('click', (e) => {
    const tab = e.target.closest('.auth-mode-tab');
    if (tab && tab.dataset.mode !== mode) setMode(tab.dataset.mode);
  });

  loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username) {
      errorText.textContent = "Будь ласка, введіть ім'я!";
      errorText.style.display = 'block';
      return;
    }
    if (!password) {
      errorText.textContent = "Будь ласка, введіть пароль!";
      errorText.style.display = 'block';
      return;
    }
    // Вимога Supabase: пароль — мінімум 6 символів
    if (password.length < 6) {
      errorText.textContent = "Пароль має містити мінімум 6 символів";
      errorText.style.display = 'block';
      return;
    }

    // Supabase Auth працює з email, тому для входу за нікнеймом використовуємо фейкову пошту
    const fakeEmail = `${username}@bunker.local`;

    const loadingText = mode === 'register' ? "Реєстрація..." : "Завантаження...";
    loginBtn.textContent = loadingText;
    loginBtn.disabled = true;

    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: fakeEmail,
          password: password,
          options: {
            data: { username: username }
          }
        });

        if (error) {
          // Ім'я (username) має UNIQUE-обмеження в БД — зайняте ім'я повертає помилку від тригера/таблиці
          throw new Error("Це ім'я вже зайняте");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: fakeEmail,
          password: password
        });

        if (error) throw new Error("Невірне ім'я або пароль");
      }

      // Успішний вхід/реєстрація — перенаправляємо гравця в Лобі. Якщо він прийшов за посиланням-запрошенням (#/login?join=КОД, збережений роутером у app.js),
      // ведемо його одразу до кімнати, а не в порожнє лобі.
      const currentQuery = (window.location.hash.split('?')[1] || '');
      const joinCode = new URLSearchParams(currentQuery).get('join');
      window.location.hash = joinCode ? `#/lobby?join=${joinCode}` : '#/lobby';

    } catch (err) {
      errorText.textContent = err.message;
      errorText.style.display = 'block';
      loginBtn.textContent = BUTTON_TEXT[mode];
      loginBtn.disabled = false;
    }
  });

  // ===== Контейнер Б: кнопки профілю (лише коли сесія є, прив'язуємо завжди — байдуже, бо приховано) =====

  profileLobbyBtn.addEventListener('click', () => {
    window.location.hash = '#/lobby';
  });

  profileLogoutBtn.addEventListener('click', async () => {
    profileLogoutBtn.disabled = true;
    profileLogoutBtn.textContent = 'Вихід...';
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Помилка виходу:', err);
    } finally {
      // Сесії більше немає — скидаємо сторінку до стану Контейнера А (форма), не чіпаючи роут:
      // ми вже на #/login, тож просто повертаємо видимість і чистимо форму на випадок старих значень.
      profileContainer.style.display = 'none';
      formContainer.style.display = 'flex';
      usernameInput.value = '';
      passwordInput.value = '';
      setMode('login');
      profileLogoutBtn.disabled = false;
      profileLogoutBtn.textContent = 'Вийти з акаунта';
    }
  });

  // ===== Перевірка сесії: яким із двох контейнерів зустріти гравця =====

  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // Сесія є — гравець зайшов сюди свідомо (напр. кнопка "Профіль" у хедері): ховаємо форму, показуємо профіль.
    const username = session.user?.user_metadata?.username || 'Гравець';
    profileText.textContent = `Ви авторизовані як: ${username}`;
    formContainer.style.display = 'none';
    profileContainer.style.display = 'flex';
  } else {
    // Сесії немає — стандартний сценарій: форма входу/реєстрації, включно з підхопленням ?join= після кліку "Увійти" вище.
    formContainer.style.display = 'flex';
    profileContainer.style.display = 'none';
  }
}
