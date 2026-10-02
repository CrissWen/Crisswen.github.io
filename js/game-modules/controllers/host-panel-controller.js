import * as HostActions from '../../utils/host-actions.js';
import {
  renderHostPanel,
  refreshHostPanel,
  fillStageOptions,
  getHostPanelRoot,
  removeHostPanel,
  setHostPanelOpen,
  showHostToast,
  setHostDiceResult
} from '../host-panel/host-panel.js';
import { showCustomConfirm } from '../overlays/confirm-dialog.js';
import { getCataclysmTimerText } from '../timers/cataclysm-timer.js';

// ===== Панель ведучого: монтування, події, виклик дій =====
// Контролер не володіє станом гри: усе потрібне (код кімнати, id користувача, поточний стан кімнати) читається
// через ctx = { getRoomCode, getUserId, getRoomState, ... } з game.js у момент виклику, тож дані завжди свіжі.

function getPlayersList(playersState) {
  return Object.entries(playersState || {}).map(([id, p]) => ({ id, name: p.name || 'Гравець' }));
}

// Єдине місце, де збираються дані для панелі: і для першого рендеру, і для оновлень (refreshHostPanel)
function hostPanelData(roomData, ctx) {
  return {
    players: getPlayersList(roomData.players_state),
    currentUserId: ctx.getUserId(),
    capacity: roomData.bunker_state?.capacity,
    canUndo: HostActions.canUndo(),
    timer: {
      end: roomData.bunker_state?.global_timer_end,
      pausedLeft: roomData.bunker_state?.timer_paused_left
    }
  };
}

// Панель живе поза #game-board, тож перемальовування дошки її не зачіпає.
// Показуємо лише ведучому і лише після старту гри (до роздачі карт дії не мають сенсу).
export function syncHostPanel(roomData, isHost, ctx) {
  const isGameStarted = Object.keys(roomData.bunker_state || {}).length > 0;
  let root = getHostPanelRoot();

  if (!isHost || !isGameStarted) {
    if (root) removeHostPanel();
    HostActions.clearTimerAutoStop?.();
    return;
  }

  if (!root) {
    document.body.insertAdjacentHTML('beforeend', renderHostPanel(hostPanelData(roomData, ctx)));
    root = getHostPanelRoot();
    bindHostEvents(root, ctx);
    HostActions.getStageOptions()
      .then(stages => fillStageOptions(getHostPanelRoot(), stages))
      .catch(err => console.error('Не вдалося завантажити стадії:', err));
  }

  refreshHostPanel(root, hostPanelData(roomData, ctx));
  HostActions.syncTimerAutoStop?.(ctx.getRoomCode(), roomData.bunker_state);
}

// Таблиця дій: data-action кнопки -> що викликати (run), що показати в тості (ok) і що зробити після (after).
// Збирається фабрикою, а не константою, бо код кімнати береться з ctx у момент натискання.
function createHostActions(ctx) {
  const code = () => ctx.getRoomCode();

  return {
    timer:     { run: (f, arg) => HostActions.setGlobalTimer(code(), Number(arg)), ok: (r, f, arg) => `Таймер на ${arg} с запущено` },
    pauseTimer: {
      run: () => HostActions.pauseGlobalTimer(code()),
      ok: (r) => r === 'paused' ? 'Таймер на паузі' : 'Таймер відновлено'
    },
    stopTimer: { run: () => HostActions.stopGlobalTimer(code()), ok: 'Таймер зупинено' },
    cataclysm: { run: () => HostActions.changeCataclysm(code()), ok: 'Катаклізм змінено' },
    voting:    { run: () => HostActions.startVoting(code()), ok: 'Голосування розпочато' },
    capacity:  {
      run: (f, arg) => HostActions.changeBunkerCapacity(code(), Number(arg)),
      ok: (r) => `Місць у бункері: ${r}`,
      after: (root, r) => { const el = root.querySelector('[data-hp-capacity]'); if (el) el.textContent = r; }
    },

    changeCharacteristic: { run: f => HostActions.changeCharacteristic(code(), f.target, f.charType), ok: 'Характеристику змінено' },
    changeExperience:     { run: f => HostActions.changeExperience(code(), f.target, f.level), ok: 'Стаж змінено' },
    changeDiseaseSeverity:{ run: f => HostActions.changeDiseaseSeverity(code(), f.target, f.level), ok: 'Ступінь хвороби змінено' },
    invertGender:        { run: f => HostActions.invertGender(code(), f.target), ok: 'Стать змінено' },
    swapCharacteristics: { run: f => HostActions.swapCharacteristics(code(), f.charType, f.target), ok: 'Обмін виконано' },
    stealCharacteristic: { run: f => HostActions.stealCharacteristic(code(), f.thief, f.victim, f.charType), ok: 'Характеристику викрадено' },
    healPlayer:          { run: f => HostActions.healPlayer(code(), f.target, f.heal), ok: 'Лікування застосовано' },
    addExtraCharacteristic: {
      // Якщо текстове поле не порожнє — передаємо його як кастомне значення, інакше береться випадкова картка
      run: f => HostActions.addExtraCharacteristic(code(), f.target, f.category, (f.customExtra || '').trim()),
      ok: 'Картку додано',
      after: root => { const el = root.querySelector('[data-field="customExtra"]'); if (el) el.value = ''; }
    },
    deleteInventory:     { run: (f, arg) => HostActions.deleteInventory(code(), f.target, arg), ok: 'Інвентар видалено' },
    shift:               { run: (f, arg) => HostActions.shiftAnnulCharacteristics(code(), f.charType, arg), ok: 'Характеристики зсунуто' },
    changeBunker: {
      run: f => f.bunkerField === 'items'
        ? HostActions.changeBunkerItems(code(), f.itemAction, f.itemAction === 'remove' ? f.itemRemove : f.itemAddText)
        : HostActions.changeBunker(code(), f.bunkerField, f.customValue),
      ok: (r, f) => Array.isArray(r)
        ? 'Предмети бункера оновлено'
        : (f?.customValue || '').trim() ? 'Параметр бункера змінено' : `Випадкове значення: ${r}`,
      after: (root, result) => {
        const el = root.querySelector('[data-field="customValue"]');
        if (el) el.value = '';
        // Після дії з предметами чистимо поле додавання і перебудовуємо список для видалення за свіжим масивом
        if (Array.isArray(result)) applyBunkerItemActionUI(root, ctx, result);
      }
    },

    // Одна дія на обидві кнопки: тип кубика ('d20' / 'd6') приходить з data-arg натиснутої кнопки
    dice: {
      run: (f, arg) => HostActions.rollDice(code(), arg),
      ok: r => `${r.type}: ${r.value}`,
      after: (root, r) => setHostDiceResult(root, `${r.type}: ${r.value}`)
    },

    changeHost: {
      run: f => HostActions.changeHost(code(), f.newHost),
      ok: 'Права ведучого передано'
    },
    undo:    { run: () => HostActions.undoLastAction(code()), ok: 'Дію скасовано' },
    restart: {
      run: () => HostActions.restartGame(code()),
      ok: 'Гру скинуто'
    },
    closeRoom: {
      run: () => HostActions.closeRoom(code(), getCataclysmTimerText()), // час з екрана йде в bunker_state.stopped_timer разом із status: 'closed'
      ok: 'Кімнату закрито',
      after: () => { window.location.hash = '#/lobby'; }
    }
  };
}

// ===== Глобальний перехоплювач підтвердження: єдина точка для всіх кнопок панелі, окрім таймера. =====

// Кнопки таймера (15/30/60, пауза, стоп) та швидкі дії без реального ризику (кубики, +/- місткість)
// діють миттєво, без підтвердження
const NO_CONFIRM_ACTIONS = new Set(['timer', 'pauseTimer', 'stopTimer', 'dice', 'capacity']);

// Текст підтвердження для конкретних дій; все, чого немає тут, отримує DEFAULT_CONFIRM_TEXT
const CONFIRM_TEXTS = {
  closeRoom: 'Точно закрити кімнату? Усіх гравців буде відключено, дію не можна скасувати.',
  restart:   'Почати гру заново? Усі картки буде скинуто, гравці повернуться до кімнати очікування.',
  changeHost:'Передати права ведучого обраному гравцю? Ви втратите доступ до цієї панелі.'
};
const DEFAULT_CONFIRM_TEXT = 'Виконати цю дію з характеристикою?';

// Збирає значення всіх [data-field] всередині того ж акордеона, що й натиснута кнопка
function readHostFields(btn) {
  const scope = btn.closest('.hp-acc-body');
  const fields = {};
  scope?.querySelectorAll('[data-field]').forEach(el => { fields[el.dataset.field] = el.value; });
  return fields;
}

async function runHostAction(root, btn, actions) {
  const def = actions[btn.dataset.action];
  if (!def) return;

  // Блокуємо кнопку ще до підтвердження, щоб швидкий повторний клік під час очікування відповіді не відкрив другий діалог
  btn.disabled = true;

  // Єдина точка підтвердження: всі кнопки, крім таймера, чекають на відповідь в кастомному вікні
  if (!NO_CONFIRM_ACTIONS.has(btn.dataset.action)) {
    const message = CONFIRM_TEXTS[btn.dataset.action] || DEFAULT_CONFIRM_TEXT;
    const confirmed = await showCustomConfirm(message, btn);
    if (!confirmed) {
      btn.disabled = false;
      return;
    }
  }

  const arg = btn.dataset.arg;
  try {
    const fields = readHostFields(btn);
    const result = await def.run(fields, arg);
    const msg = typeof def.ok === 'function' ? def.ok(result, fields, arg) : def.ok;
    showHostToast(root, msg);
    def.after?.(root, result);
  } catch (err) {
    console.error('Помилка дії ведучого:', err);
    showHostToast(root, err.message || 'Не вдалося виконати дію', true);
  } finally {
    btn.disabled = false;
    // Оновлюємо лише стан кнопки undo; решту панелі перемалює подія з WebSocket
    const undoBtn = root.querySelector('[data-action="undo"]');
    if (undoBtn) undoBtn.disabled = !HostActions.canUndo();
  }
}

function bindHostEvents(root, ctx) {
  const actions = createHostActions(ctx);

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-hp-toggle]')) {
      setHostPanelOpen(root, !root.classList.contains('hp-open'));
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn && !btn.disabled) runHostAction(root, btn, actions);
  });

  // "Змінити параметр бункера": інтерфейс залежить від обраного параметра та дії (див. applyBunkerParamUI)
  root.addEventListener('change', (e) => {
    if (e.target.closest('#bunker-item-action')) applyBunkerItemActionUI(root, ctx);
    else if (e.target.closest('[data-field="bunkerField"]')) applyBunkerParamUI(root, ctx);
  });
}

const setShown = (el, shown) => { if (el) el.style.display = shown ? '' : 'none'; };

// Вибір параметра бункера: "items" ховає стандартне поле і відкриває керування предметами
// (дія за замовчуванням — "Додати"); будь-який інший параметр повертає стандартний вигляд.
function applyBunkerParamUI(root, ctx) {
  const isItems = root.querySelector('[data-field="bunkerField"]')?.value === 'items';
  setShown(root.querySelector('[data-field="customValue"]')?.closest('.hp-field'), !isItems);
  setShown(root.querySelector('#bunker-item-action'), isItems);
  if (isItems) {
    root.querySelector('#bunker-item-action').value = 'add';
    applyBunkerItemActionUI(root, ctx);
  } else {
    setShown(root.querySelector('#bunker-item-add-input'), false);
    setShown(root.querySelector('#bunker-item-remove-select'), false);
    const btn = root.querySelector('#bunker-submit-btn');
    if (btn) btn.textContent = 'Змінити';
  }
}

// Дія над предметами: "Додати" — текстове поле; "Видалити" — список («Видалити все» + поточні предмети).
// items можна передати явно (після збереження, коли локальний стан кімнати ще не оновився через Realtime).
function applyBunkerItemActionUI(root, ctx, items) {
  const action = root.querySelector('#bunker-item-action')?.value || 'add';
  const addInput = root.querySelector('#bunker-item-add-input');
  const removeSelect = root.querySelector('#bunker-item-remove-select');
  const btn = root.querySelector('#bunker-submit-btn');
  if (!addInput || !removeSelect) return;

  if (action === 'add') {
    addInput.value = '';
    setShown(addInput, true);
    setShown(removeSelect, false);
    if (btn) btn.textContent = 'Додати';
    return;
  }

  const roomItems = ctx.getRoomState()?.bunker_state?.items;
  const current = Array.isArray(items) ? items : (Array.isArray(roomItems) ? roomItems : []);
  removeSelect.replaceChildren();
  const allOpt = new Option('Видалити все', 'all');
  removeSelect.add(allOpt);
  current.forEach(item => removeSelect.add(new Option(item, item))); // Option ставить текст без HTML-інтерпретації
  setShown(addInput, false);
  setShown(removeSelect, true);
  if (btn) btn.textContent = 'Видалити';
}
