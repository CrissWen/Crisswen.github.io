import { supabase } from '../services/supabase.js';

// Статуси кімнати, які вже не вважаються активними. closeRoom (host-actions.js) тепер сам виставляє status: 'closed'
// в тому ж запиті, що й bunker_state.room_closed, тож цей фільтр вже працює для нових закритих кімнат.
const EXCLUDED_ROOM_STATUSES = ['finished', 'closed'];

// Активні кімнати поточного гравця — наповнюється в initLobby(), читається подальшим рендером панелі активних кімнат (наступний етап).
let userActiveRooms = [];

// Гравець належить кімнаті, якщо він її хост (host_id) АБО його id є ключем у players_state (jsonb).
// PostgREST важко надійно запакувати в один .or() jsonb-фільтр контейнменту разом із звичайною умовою
// (коми/двокрапки в JSON ламають його or-синтаксис), тому робимо дві окремі вибірки і мерджимо/дедуплікуємо результат по room_code.
async function fetchUserActiveRooms(userId) {
  const statusFilter = `(${EXCLUDED_ROOM_STATUSES.join(',')})`;

  const [hostRes, memberRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('*')
      .eq('host_id', userId)
      .not('status', 'in', statusFilter),
    supabase
      .from('rooms')
      .select('*')
      // jsonb containment: players_state має містити ключ userId (будь-яке значення підходить, бо {} тривіально міститься в будь-якому об'єкті)
      .contains('players_state', { [userId]: {} })
      .not('status', 'in', statusFilter)
  ]);

  if (hostRes.error) throw hostRes.error;
  if (memberRes.error) throw memberRes.error;

  const byCode = new Map();
  [...(hostRes.data || []), ...(memberRes.data || [])].forEach(room => byCode.set(room.room_code, room));

  // Захист від "кімнат-привидів": старі записи, у яких bunker_state.room_closed === true,
  // але status так і лишився 'lobby' (з'явилися до того, як closeRoom почав одночасно писати й status).
  // Фільтруємо такі кімнати додатково, окрім фільтра по status вище.
  return Array.from(byCode.values()).filter(room => room.bunker_state?.room_closed !== true);
}

// Гра вважається розпочатою, якщо в кімнаті є bunker_state (той же критерій, що й isGameStarted у game.js) — на відміну від поля status,
// яке в ПРОЄКТІ ніде реально не виставляється в 'playing'. Саме поле status теж перевіряю на майбутнє, якщо воно з'явиться.
function isRoomPlaying(room) {
return Object.keys(room.bunker_state || {}).length > 0 || room.status === 'playing';
}

// HTML-вміст .reconnect-panel: або картки активних кімнат, або напис "Немає активних ігор", якщо масив порожній.
// Стилі — в css/styles.css (.reconnect-card, .reconnect-panel тощо); тут лише розмітка з класами.
function renderReconnectCards(rooms) {
if (!rooms || rooms.length === 0) {
return `<p class="reconnect-empty">Немає активних ігор</p>`;
}

return rooms.map(room => {
  const playing = isRoomPlaying(room);
    return `
      <div class="reconnect-card">
        <div class="reconnect-card__head">
          <span class="reconnect-card__code">Кімната: ${room.room_code}</span>
          <span class="reconnect-card__dot ${playing ? 'is-playing' : 'is-waiting'}" aria-hidden="true"></span>
        </div>
        <p class="reconnect-card__status">${playing ? 'Гра вже почалася' : 'Очікування гравців'}</p>
        <button type="button" class="reconnect-card__btn" data-reconnect-code="${room.room_code}">Повернутися</button>
      </div>
    `;
  }).join('');
}

// Оновлює і вміст, і видимість самого контейнера #reconnect-panel: якщо активних кімнат немає —
// ховаємо панель повністю (display:none), щоб порожній блок не займав місце над .lobby-main
// (макет тепер вертикальний, тому основний блок лобі просто лишається один по центру екрана).
// Текст "Немає активних ігор" з renderReconnectCards при цьому нікуди не дівається — він і далі
// лежить у internals, просто не показується, поки сам контейнер прихований.
function updateReconnectPanel(rooms) {
  const panel = document.getElementById('reconnect-panel');
  const panelBody = document.getElementById('reconnect-panel-body');
  if (panelBody) panelBody.innerHTML = renderReconnectCards(rooms);
  if (panel) panel.style.display = (rooms && rooms.length > 0) ? 'block' : 'none';
}

export function renderLobby() {
  return `
    <div class="lobby-layout">
      <section class="block lobby-main">
        <div class="block-head">
          <h2>Лобі</h2>
        </div>
        <div class="block-body" style="display: flex; flex-direction: column; gap: 14px;">
          <button id="create-room-btn" style="padding: 10px; border-radius: 6px; background: var(--accent); color: #000; font-weight: bold; cursor: pointer; border: none;">Створити кімнату</button>
          <hr style="width: 100%; border-color: var(--metal-lt);">
          <input type="text" id="room-code" placeholder="Код кімнати (напр. ABCD)" style="padding: 10px; border-radius: 6px; border: 1px solid var(--metal); background: var(--panel-2); color: var(--text); text-transform: uppercase;">
          <button id="join-room-btn" style="padding: 10px; border-radius: 6px; background: var(--hazard); color: #000; font-weight: bold; cursor: pointer; border: none;">Приєднатися</button>
        </div>
      </section>

      <aside id="reconnect-panel" class="block reconnect-panel" style="${userActiveRooms.length ? '' : 'display:none;'}">
        <div class="block-head">
          <h2 style="font-size: 18px;">Активні ігри</h2>
        </div>
        <div class="block-body reconnect-cards" id="reconnect-panel-body">
          ${renderReconnectCards(userActiveRooms)}
        </div>
      </aside>
    </div>
  `;
}

export function initLobby() {
  const createBtn = document.getElementById('create-room-btn');
  const joinBtn = document.getElementById('join-room-btn');
  const codeInput = document.getElementById('room-code');

  // 1. Отримуємо user_id і одразу тягнемо активні кімнати гравця (асинхронно, не блокуючи решту ініціалізації лобі нижче).
  // Результат лягає в userActiveRooms — рендер і видимість панелі оновлює updateReconnectPanel().
  // Одразу застосовуємо те, що вже відомо (наприклад, лишилось з попереднього відвідування лобі в межах цієї SPA-сесії) —
  // щоб не було зайвого миготіння панелі, поки триває fetch нижче.
  updateReconnectPanel(userActiveRooms);

  (async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return;

      userActiveRooms = await fetchUserActiveRooms(user.id);
      updateReconnectPanel(userActiveRooms);
    } catch (err) {
      console.error('Не вдалося завантажити активні кімнати:', err);
    }
  })();

  // Логіка ВИХОДУ з акаунта переїхала на екран #/login (див. auth.js, Контейнер Б — профіль залогіненого гравця),
  // куди веде кнопка "Профіль" у глобальному хедері (index.html).

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

  // Логіка ПРИЄДНАННЯ до кімнати — винесена в окрему функцію, щоб її можна було викликати й програмно (авто-приєднання за посиланням нижче), а не тільки кліком кнопки
  function joinRoom(code) {
    const trimmed = (code || '').trim().toUpperCase();
    if (trimmed.length === 0) {
      alert("Введіть код кімнати!");
      return;
    }
    // Просто переходимо на сторінку гри з цим кодом. 
    // Сама перевірка існування кімнати буде відбуватися вже на сторінці гри.
    window.location.hash = `#/game?room=${trimmed}`;
  }

  joinBtn.addEventListener('click', () => joinRoom(codeInput.value));

  // Клік по кнопці "Повернутися" на картці активної кімнати — делегування на #reconnect-panel, бо картки перемальовуються динамічно після fetchUserActiveRooms
  const reconnectPanel = document.getElementById('reconnect-panel');
  reconnectPanel?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-reconnect-code]');
    if (!btn) return;
    // Гравець уже є в БД цієї кімнати (інакше вона б не потрапила до userActiveRooms) — решту game.js відразу впізнає його й підвантажить стан
    window.location.hash = '#/game?room=' + btn.dataset.reconnectCode;
  });

  // Авто-приєднання за посиланням-запрошенням: #/lobby?join=КОД, збережений через роутер (app.js) + auth.js
  const joinQuery = window.location.hash.split('?')[1] || '';
  const joinCode = new URLSearchParams(joinQuery).get('join');
  if (joinCode) {
    codeInput.value = joinCode;

    // Прибираємо ?join=КОД з адресного рядка ДО навігації в кімнату, без перезавантаження сторінки,
    // щоб повторний F5 на #/lobby не намагався приєднати гравця вдруге
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/lobby');

    joinRoom(joinCode);
  }
}