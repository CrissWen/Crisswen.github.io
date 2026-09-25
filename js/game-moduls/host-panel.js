import {
  CHARACTERISTIC_TYPES,
  EXTRA_CHARACTERISTIC_TYPES,
  BUNKER_FIELDS,
  HEAL_PERFECT
} from '../utils/host-actions.js';

// Цей модуль відповідає ЛИШЕ за HTML/DOM-вигляд панелі.
// Уся логіка дій — у utils/host-actions.js, підключення подій — у pages/game.js.

const HOST_PANEL_ID = 'host-panel-root';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Підпис гравця: ім'я, а при збігу імен додається короткий фрагмент ID
function playerLabel(player, players) {
  const dup = players.filter(p => p.name === player.name).length > 1;
  return dup ? `${player.name} | ${player.id.slice(0, 4)}` : player.name;
}

function optionsHtml(items) {
  return items.map(i => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('');
}

function playerOptions(players, { withAll = false, excludeId = null } = {}) {
  const list = players.filter(p => p.id !== excludeId).map(p => ({ value: p.id, label: playerLabel(p, players) }));
  return optionsHtml(withAll ? [{ value: 'all', label: 'Для всіх' }, ...list] : list);
}

// Тип select-а з гравцями визначається атрибутом data-players
const PLAYER_SELECT_MODES = {
  all:    { withAll: true },
  only:   { withAll: false },
  others: { withAll: false, excludeSelf: true }
};

const charTypeOptions = () => optionsHtml(CHARACTERISTIC_TYPES.map(c => ({ value: c.key, label: c.label })));
const extraTypeOptions = () => optionsHtml(EXTRA_CHARACTERISTIC_TYPES.map(c => ({ value: c.key, label: c.label })));
const bunkerFieldOptions = () => optionsHtml(BUNKER_FIELDS.map(f => ({ value: f.key, label: f.label })));

function acc(title, body) {
  return `
    <details class="hp-acc">
      <summary>${title}</summary>
      <div class="hp-acc-body">${body}</div>
    </details>
  `;
}

const field = (label, control) => `
  <label class="hp-field"><span>${label}</span>${control}</label>
`;

const playersSelect = (mode, fieldName = 'target') =>
  `<select class="hp-select" data-field="${fieldName}" data-players="${mode}"></select>`;

const actionBtn = (label, action, extra = '') =>
  `<button type="button" class="hp-btn" data-action="${action}" ${extra}>${label}</button>`;

// Кнопки Пауза/Стоп виводяться лише, коли таймер дійсно запущено (йде або на паузі) —
// аби не мозолити очі, коли його ще ніхто не запускав. Кнопка Пауза/Старт завжди має один
// data-action="pauseTimer" — міняється лише візуал, pauseGlobalTimer в host-actions.js сам розбирається з напрямом.
// timer = { end: bunker_state.global_timer_end, pausedLeft: bunker_state.timer_paused_left }
function timerControlsHtml(timer = {}) {
  // Строга перевірка (а не просте !!), бо pausedLeft === 0 (пауза точно на нулі) — валідний активний стан,
  // а !!0 хибно вважав би таймер незапущеним. Узгоджено з game-timer.js.
  const isPaused = timer.pausedLeft !== null && timer.pausedLeft !== undefined;
  const isActive = !!timer.end || isPaused;
  if (!isActive) return '';

  const pauseLabel = isPaused
    ? '<span class="hp-icon-play" aria-hidden="true"></span> Старт'
    : '<span class="hp-icon-pause" aria-hidden="true"></span> Пауза';

  return `
    <div class="hp-row">
      ${actionBtn(pauseLabel, 'pauseTimer')}
      ${actionBtn('<span class="hp-icon-stop" aria-hidden="true"></span> Стоп', 'stopTimer')}
    </div>
  `;
}

export function renderHostPanel({ capacity = 1, canUndo = false, timer = {} } = {}) {
  return `
    <div id="${HOST_PANEL_ID}" class="hp-root">
      <button type="button" class="hp-fab" data-hp-toggle aria-label="Панель ведучого">
        <span class="hp-fab-icon">
          <svg class="hp-grid-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            ${[4, 12, 20].map(y => [4, 12, 20].map(x => `<circle cx="${x}" cy="${y}" r="2"/>`).join('')).join('')}
          </svg>
          <svg class="hp-cross-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <line x1="5" y1="5" x2="19" y2="19"/>
            <line x1="19" y1="5" x2="5" y2="19"/>
          </svg>
        </span>
        <span>Панель ведучого</span>
      </button>

      <div class="hp-backdrop" data-hp-toggle></div>

      <aside class="hp-panel" role="dialog" aria-label="Панель ведучого">
        <header class="hp-head">
          <h2>Панель ведучого</h2>
          <button type="button" class="hp-close" data-hp-toggle aria-label="Закрити">✕</button>
        </header>

        <div class="hp-scroll">
          <!-- Блок 1: глобальні таймери та події -->
          <section class="hp-section">
            <h3>Таймер</h3>
            <div class="hp-row">
              ${[15, 30, 60].map(s => actionBtn(`${s} с`, 'timer', `data-arg="${s}"`)).join('')}
            </div>
            <div data-hp-timer-controls>${timerControlsHtml(timer)}</div>
            <div class="hp-row hp-row-stack">
              ${actionBtn('Змінити катаклізм', 'cataclysm')}
              ${actionBtn('Почати голосування', 'voting')}
            </div>
            <div class="hp-counter">
              <span>Місць у бункері</span>
              <div class="hp-counter-ctrl">
                <button type="button" class="hp-btn hp-btn-red hp-btn-sq" data-action="capacity" data-arg="-1" aria-label="Менше місць">−</button>
                <strong data-hp-capacity>${esc(capacity)}</strong>
                <button type="button" class="hp-btn hp-btn-green hp-btn-sq" data-action="capacity" data-arg="1" aria-label="Більше місць">+</button>
              </div>
            </div>
          </section>

          <!-- Блок 2: акордеони дій -->
          <section class="hp-section">
            <h3>Дії</h3>

            ${acc('Змінити характеристику', `
              ${field('Гравець', playersSelect('all'))}
              ${field('Характеристика', `<select class="hp-select" data-field="charType">${charTypeOptions()}</select>`)}
              ${actionBtn('Змінити на випадкову', 'changeCharacteristic')}
            `)}

            ${acc('Змінити стаж професії', `
              ${field('Гравець', playersSelect('all'))}
              ${field('Стаж', `<select class="hp-select" data-field="level" data-stages="profession"></select>`)}
              ${actionBtn('Застосувати', 'changeExperience')}
            `)}

            ${acc('Змінити ступінь хвороби', `
              ${field('Гравець', playersSelect('all'))}
              ${field('Ступінь', `<select class="hp-select" data-field="level" data-stages="health"></select>`)}
              ${actionBtn('Застосувати', 'changeDiseaseSeverity')}
            `)}

            ${acc('Змінити стать на протилежну', `
              ${field('Гравець', playersSelect('all'))}
              ${actionBtn('Змінити стать', 'invertGender')}
            `)}

            ${acc('Обмінятися характеристиками', `
              ${field('Гравець (для всіх — випадковий обмін між усіма)', playersSelect('all'))}
              ${field('Характеристика', `<select class="hp-select" data-field="charType">${charTypeOptions()}</select>`)}
              ${actionBtn('Обміняти', 'swapCharacteristics')}
            `)}

            ${acc('Вкрасти характеристику', `
              ${field('Хто краде', playersSelect('only', 'thief'))}
              ${field('У кого краде', playersSelect('only', 'victim'))}
              ${field('Характеристика', `<select class="hp-select" data-field="charType">${charTypeOptions()}</select>`)}
              ${actionBtn('Вкрасти', 'stealCharacteristic')}
            `)}

            ${acc('Лікування', `
              ${field('Гравець', playersSelect('all'))}
              ${field('Ефект', `
                <select class="hp-select" data-field="heal" data-stages="health" data-with-static>
                  <option value="${HEAL_PERFECT}" data-static>Зробити ідеально здоровим</option>
                </select>`)}
              ${actionBtn('Вилікувати', 'healPlayer')}
            `)}

            ${acc('Додати доп. характеристику', `
              ${field('Гравець', playersSelect('all'))}
              ${field('Категорія', `<select class="hp-select" data-field="category">${extraTypeOptions()}</select>`)}
              <input type="text" class="hp-input" data-field="customExtra" placeholder="Або введіть вручну..." maxlength="300">
              ${actionBtn('Додати', 'addExtraCharacteristic')}
            `)}

            ${acc('Видалити інвентар', `
              ${field('Гравець', playersSelect('all'))}
              <div class="hp-row hp-row-stack">
                ${actionBtn('Видалити крупний інвентар', 'deleteInventory', 'data-arg="large_inventory"')}
                ${actionBtn('Видалити рюкзак', 'deleteInventory', 'data-arg="backpack"')}
              </div>
            `)}

            ${acc('Зсув характеристик', `
              ${field('Характеристика', `<select class="hp-select" data-field="charType">${charTypeOptions()}</select>`)}
              <div class="hp-row hp-row-stack">
                ${actionBtn('За годинниковою стрілкою', 'shift', 'data-arg="cw"')}
                ${actionBtn('Проти годинникової стрілки', 'shift', 'data-arg="ccw"')}
              </div>
            `)}

            ${acc('Змінити параметр бункера', `
              ${field('Параметр', `<select class="hp-select" data-field="bunkerField">${bunkerFieldOptions()}</select>`)}
              ${field('Ваша характеристика', `<input type="text" class="hp-input" data-field="customValue" placeholder="Власне значення" maxlength="300">`)}
              ${actionBtn('Змінити', 'changeBunker')}
            `)}

            ${acc('Кубики', `
              <div class="hp-row">
                ${actionBtn('D6', 'dice', 'data-arg="6"')}
                ${actionBtn('D20', 'dice', 'data-arg="20"')}
              </div>
              <div class="hp-dice-result" data-hp-dice>—</div>
            `)}

            ${acc('Передати роль ведучого', `
              ${field('Новий ведучий', playersSelect('others', 'newHost'))}
              ${actionBtn('Передати права', 'changeHost')}
            `)}
          </section>
        </div>

        <!-- Блок 3: керування кімнатою -->
        <footer class="hp-foot">
          <button type="button" class="hp-btn hp-btn-gray" data-action="undo" ${canUndo ? '' : 'disabled'}>Скасувати попередню дію</button>
          <button type="button" class="hp-btn hp-btn-green" data-action="restart">Почати гру наново</button>
          <button type="button" class="hp-btn hp-btn-red" data-action="closeRoom">Закрити кімнату</button>
          <div class="hp-toast" data-hp-toast role="status"></div>
        </footer>
      </aside>
    </div>
  `;
}

// ===== DOM-хелпери, які викликає game.js при кожному оновленні кімнати =====

export function getHostPanelRoot() {
  return document.getElementById(HOST_PANEL_ID);
}

export function removeHostPanel() {
  getHostPanelRoot()?.remove();
}

// Оновлює лише списки гравців, лічильник, кнопку undo та блок керування таймером — сама панель не перемальовується,
// тож відкриті акордеони та введений текст не губляться.
export function refreshHostPanel(root, { players, currentUserId, capacity, canUndo, timer }) {
  if (!root) return;

  // Списки перебудовуємо, лише якщо склад гравців змінився (щоб не закривати відкритий dropdown)
  const sig = players.map(p => `${p.id}:${p.name}`).join('|');
  if (root.dataset.playersSig !== sig) {
    root.dataset.playersSig = sig;
    root.querySelectorAll('select[data-players]').forEach(sel => {
      const mode = PLAYER_SELECT_MODES[sel.dataset.players] || {};
      const prev = sel.value;
      sel.innerHTML = playerOptions(players, {
        withAll: !!mode.withAll,
        excludeId: mode.excludeSelf ? currentUserId : null
      });
      if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    });
  }

  const cap = root.querySelector('[data-hp-capacity]');
  if (cap) cap.textContent = capacity ?? 1;

  const undoBtn = root.querySelector('[data-action="undo"]');
  if (undoBtn) undoBtn.disabled = !canUndo;

  // Блок Пауза/Стоп перемальовуємо ціликом при кожному оновленні кімнати — він сам статичний
  // (текст/іконка кнопки Pause/Start і сама наявність рядка), тож перезапис його HTML не шкодить UX.
  const timerSlot = root.querySelector('[data-hp-timer-controls]');
  if (timerSlot) timerSlot.innerHTML = timerControlsHtml(timer || {});
}

// stages = { profession: [...], health: [...], hobby: [...] } з getStageOptions()
export function fillStageOptions(root, stages) {
  if (!root) return;
  root.querySelectorAll('select[data-stages]').forEach(sel => {
    const list = stages[sel.dataset.stages] || [];
    const prev = sel.value;
    sel.querySelectorAll('option:not([data-static])').forEach(o => o.remove());
    sel.insertAdjacentHTML('beforeend', optionsHtml(list.map(s => ({ value: s, label: s }))));
    if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  });
}

export function setHostPanelOpen(root, open) {
  root?.classList.toggle('hp-open', open);
  // Клас .is-active саме на кнопці — він запускає CSS-морфінг “9 точок” ↔ “хрестик”
  root?.querySelector('.hp-fab')?.classList.toggle('is-active', open);
}

export function showHostToast(root, message, isError = false) {
  const el = root?.querySelector('[data-hp-toast]');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('hp-toast-error', isError);
  el.classList.add('hp-toast-show');
  clearTimeout(showHostToast._t);
  showHostToast._t = setTimeout(() => el.classList.remove('hp-toast-show'), 3500);
}

export function setHostDiceResult(root, text) {
  const el = root?.querySelector('[data-hp-dice]');
  if (el) el.textContent = text;
}
