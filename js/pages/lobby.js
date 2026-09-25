import { supabase } from '../services/supabase.js';
export function renderLobby() {
  return `
    <section class="block">
      <div class="block-head" style="display: flex; align-items: center; justify-content: space-between;">
        <h2>Лобі</h2>
        <button id="logout-btn" style="padding: 8px 14px; border-radius: 6px; background: transparent; color: var(--text); font-weight: bold; cursor: pointer; border: 1px solid var(--metal);">Вийти з акаунта</button>
      </div>
      <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">
        <button id="create-room-btn" style="padding: 10px; border-radius: 6px; background: var(--accent); color: #000; font-weight: bold; cursor: pointer; border: none;">Створити кімнату</button>
        <hr style="width: 100%; border-color: var(--metal-lt);">
        <input type="text" id="room-code" placeholder="Код кімнати (напр. ABCD)" style="padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text); text-transform: uppercase;">
        <button id="join-room-btn" style="padding: 10px; border-radius: 6px; background: var(--hazard); color: #000; font-weight: bold; cursor: pointer; border: none;">Приєднатися</button>
      </div>
    </section>
  `;
}

export function initLobby() {
  const createBtn = document.getElementById('create-room-btn');
  const joinBtn = document.getElementById('join-room-btn');
  const codeInput = document.getElementById('room-code');
  const logoutBtn = document.getElementById('logout-btn');

  // Логіка ВИХОДУ з акаунта
  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Вихід...';
    try {
      await supabase.auth.signOut();
    } catch (err) {
      alert("Помилка виходу: " + err.message);
    } finally {
      // Роутер з Етапу 3 не пустить назад без сесії, навіть якщо signOut відпрацював з помилкою
      window.location.hash = '#/login';
    }
  });

  // Логіка СТВОРЕННЯ кімнати
  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    createBtn.textContent = 'Створення...';

    try {
      // 1. Перевіряємо, хто зараз авторизований
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Ви не авторизовані. Поверніться на сторінку входу.");

      // 2. Генеруємо випадковий 4-значний код (тільки літери та цифри)
      const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

      // 3. Робимо запит до вашої таблиці rooms
      const { data, error } = await supabase
        .from('rooms')
        .insert([
          { 
            room_code: roomCode, 
            host_id: user.id,
            status: 'lobby',
            bunker_state: {}, // Поки порожньо, заповнимо пізніше
            players_state: {} 
          }
        ])
        .select()
        .single();

      if (error) throw error;

      // 4. Успіх! Переходимо на сторінку гри, передаючи код кімнати через URL-параметр
      window.location.hash = `#/game?room=${roomCode}`;

    } catch (err) {
      alert("Помилка створення кімнати: " + err.message);
      createBtn.disabled = false;
      createBtn.textContent = 'Створити кімнату';
    }
  });

  // Логіка ПРИЄДНАННЯ до кімнати
  joinBtn.addEventListener('click', () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length === 0) {
      alert("Введіть код кімнати!");
      return;
    }
    // Просто переходимо на сторінку гри з цим кодом. 
    // Сама перевірка існування кімнати буде відбуватися вже на сторінці гри.
    window.location.hash = `#/game?room=${code}`;
  });
}