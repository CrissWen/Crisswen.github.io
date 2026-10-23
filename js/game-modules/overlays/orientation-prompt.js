// Вікно «Поверніть телефон горизонтально» — заблоковане: закрити його не можна.
// Показується ЛИШЕ на телефонах і ЛИШЕ в двох випадках (викликає game.js):
//   1) гра щойно почалася й роздалися характеристики;
//   2) гравець із лобі натиснув «Повернутися» і зайшов у кімнату, де гра вже йде.
// Поки телефон у портретній орієнтації — вікно висить і блокує екран; щойно його повернули в ландшафт — зникає саме.
// Якщо потім телефон знову поставити вертикально — вікно з'явиться знову (до виходу зі сторінки гри).

const OVERLAY_ID = 'orientation-prompt';

const portraitMq = window.matchMedia('(orientation: portrait)');
const coarseMq = window.matchMedia('(pointer: coarse)');

let overlayEl = null;
let listening = false;

// Телефон = сенсорний екран із короткою стороною ≤ 600px (планшети й ПК сюди не потрапляють)
function isPhone() {
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return coarseMq.matches && shortSide <= 600;
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.className = 'orientation-prompt';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'orientation-prompt-title');
  el.innerHTML = `
    <div class="orientation-prompt__card">
      <div class="orientation-prompt__icon" aria-hidden="true">
        <svg viewBox="0 0 140 100" width="168" height="120" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
          <!-- телефон: спершу стоїть вертикально, плавно повертається по годинниковій у горизонтальне положення -->
          <g class="orientation-prompt__phone">
            <rect x="38" y="33" width="64" height="34" rx="6"></rect>
            <!-- кнопка зліва: у вертикальному положенні (-90°) вона внизу -->
            <rect x="44" y="45" width="5" height="10" rx="2"></rect>
          </g>
          <!-- стрілки обертання по годинниковій: ліва вгору, права вниз (збігається з напрямком анімації) -->
          <g class="orientation-prompt__arrows">
            <path d="M26 80 Q8 50 26 20"></path>
            <polyline points="17.3 24.9 26 20 25.8 30"></polyline>
            <path d="M114 20 Q132 50 114 80"></path>
            <polyline points="122.7 75.1 114 80 114.2 70"></polyline>
          </g>
        </svg>
      </div>
      <h2 id="orientation-prompt-title" class="orientation-prompt__title">Поверніть телефон горизонтально</h2>
      <p class="orientation-prompt__text">Так таблицю гравців і характеристики буде набагато зручніше читати.</p>
    </div>
  `;
  return el;
}

// Єдина точка істини: показати вікно, лише якщо це телефон і він зараз у портреті
function sync() {
  if (!overlayEl) return;
  const shouldShow = isPhone() && portraitMq.matches;
  overlayEl.classList.toggle('is-visible', shouldShow);
  document.documentElement.classList.toggle('has-orientation-prompt', shouldShow);
}

export function showOrientationPrompt() {
  if (!overlayEl) {
    overlayEl = buildOverlay();
    document.body.appendChild(overlayEl);
  }
  if (!listening) {
    portraitMq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    listening = true;
  }
  sync();
}

export function hideOrientationPrompt() {
  if (listening) {
    portraitMq.removeEventListener('change', sync);
    window.removeEventListener('resize', sync);
    listening = false;
  }
  overlayEl?.remove();
  overlayEl = null;
  document.documentElement.classList.remove('has-orientation-prompt');
}
