// Оверлей кидка ОДНОГО кубика (d20 або d6). Розмітка лежить в index.html (#dice-overlay), стилі й @keyframes — у styles.css.
// Викликається з Realtime-підписки в game.js, коли в bunker_state з'являється нова подія latest_dice,
// тому всі клієнти кімнати (ведучий, гравці, глядачі) бачать анімацію одночасно.

const OVERLAY_ID = 'dice-overlay';
const DICE_TYPES = ['d20', 'd6'];
// Тривалість польоту/скачків кубика (має збігатися з dice-throw у styles.css). До цього моменту число ПРИХОВАНЕ.
const ROLL_MS = 1500;
// Скільки результат лишається на екрані після зупинки, перш ніж оверлей закриється
const HOLD_AFTER_REVEAL_MS = 3000;
let revealTimeout = null;
let hideTimeout = null;

export function hideDiceRoll() {
  clearTimeout(revealTimeout);
  clearTimeout(hideTimeout);
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;
  overlay.classList.remove('is-rolling', 'is-revealed');
  overlay.classList.add('is-hidden');
  const valueEl = overlay.querySelector('[data-dice-value]');
  if (valueEl) valueEl.textContent = ''; // автозакриття очищає цифру
}

// showDiceRoll(type, value) — type: 'd20' | 'd6'. Ставить єдиному кубику модифікатор форми, запускає анімацію кидка
// і вписує число лише в момент зупинки (інтрига: під час польоту грань порожня).
// Повторний виклик під час показу перезапускає анімацію з новим кубиком і скидає всі таймери.
export function showDiceRoll(type, value) {
  if (!DICE_TYPES.includes(type)) return;
  const overlay = document.getElementById(OVERLAY_ID);
  const dice = overlay?.querySelector('[data-dice]');
  const valueEl = overlay?.querySelector('[data-dice-value]');
  if (!overlay || !dice || !valueEl) return;

  clearTimeout(revealTimeout);
  clearTimeout(hideTimeout);

  valueEl.textContent = ''; // результат ще не відомий глядачам
  dice.className = `dice dice--${type}`; // єдиний слот: форма залежить лише від модифікатора

  overlay.classList.remove('is-hidden', 'is-rolling', 'is-revealed');
  void overlay.offsetWidth; // примусовий reflow, інакше браузер не перезапустить CSS-анімацію
  overlay.classList.add('is-rolling');

  revealTimeout = setTimeout(() => {
    valueEl.textContent = value;
    overlay.classList.add('is-revealed');
    hideTimeout = setTimeout(hideDiceRoll, HOLD_AFTER_REVEAL_MS);
  }, ROLL_MS);
}
