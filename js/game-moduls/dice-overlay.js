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
let confettiTimeout = null;

// ===== Конфеті =====
const CONFETTI_COLORS = ['#f0a868', '#ef6f61', '#5fcdb0', '#8f8ff0', '#ffd54a', '#4aa3ff'];
const CONFETTI_MIN = 50;
const CONFETTI_MAX = 100;
const CONFETTI_CLEANUP_MS = 3000; // анімація ~1.8с, тобто частинки вже прозорі

const rand = (min, max) => Math.random() * (max - min) + min;

function clearConfetti() {
  clearTimeout(confettiTimeout);
  document.querySelector(`#${OVERLAY_ID} [data-confetti]`)?.replaceChildren();
}

// Вибух конфеті з центру екрана. Кожна частинка отримує власні CSS-змінні → усі летять по-різному.
function shootConfetti() {
  const container = document.querySelector(`#${OVERLAY_ID} [data-confetti]`);
  if (!container) return;
  clearConfetti();

  const count = Math.floor(rand(CONFETTI_MIN, CONFETTI_MAX + 1));
  const reach = Math.min(window.innerWidth, window.innerHeight);
  const frag = document.createDocumentFragment();

  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const power = rand(0.25, 0.7) * reach; // сила викиду
    const p = document.createElement('div');
    p.className = 'confetti-piece' + (Math.random() < 0.3 ? ' is-round' : '');
    p.style.setProperty('--dx', `${Math.cos(angle) * power * 1.3}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * power - reach * 0.1}px`);
    p.style.setProperty('--fall', `${rand(0.25, 0.6) * reach}px`);
    p.style.setProperty('--rx', rand(-1, 1).toFixed(2));
    p.style.setProperty('--ry', rand(-1, 1).toFixed(2));
    p.style.setProperty('--rz', rand(-1, 1).toFixed(2));
    p.style.setProperty('--size', `${rand(7, 14).toFixed(1)}px`);
    p.style.setProperty('--dur', `${rand(1.5, 2).toFixed(2)}s`);
    p.style.setProperty('--color', CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
    frag.appendChild(p);
  }
  container.appendChild(frag);

  // Сміттєзбірник: через 3 с прибираємо всі частинки з DOM
  confettiTimeout = setTimeout(clearConfetti, CONFETTI_CLEANUP_MS);
}

export function hideDiceRoll() {
  clearConfetti();
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
  clearConfetti(); // новий кидок під час показу — старе конфеті прибираємо
  valueEl.textContent = ''; // результат ще не відомий глядачам
  dice.className = `dice dice--${type}`; // єдиний слот: форма залежить лише від модифікатора

  overlay.classList.remove('is-hidden', 'is-rolling', 'is-revealed');
  void overlay.offsetWidth; // примусовий reflow, інакше браузер не перезапустить CSS-анімацію
  overlay.classList.add('is-rolling');

  revealTimeout = setTimeout(() => {
    valueEl.textContent = value;
    overlay.classList.add('is-revealed');
    shootConfetti(); // рівно в ту ж мілісекунду, коли з'являється число
    hideTimeout = setTimeout(hideDiceRoll, HOLD_AFTER_REVEAL_MS);
  }, ROLL_MS);
}
