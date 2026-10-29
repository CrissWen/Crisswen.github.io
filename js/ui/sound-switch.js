import { isSfxMuted, setSfxMuted } from '../utils/sfx.js';

// ===== Перемикач звуку (повзунок з іконкою-динаміком) =====
// Один на всі рулетки гри. Стан «звук вимкнено» зберігає utils/sfx.js у localStorage (ключ bunker-sfx-muted), тож він
// спільний для всіх сторінок і вкладок: вимкнув у рулетці катаклізму — вимкнено й у рулетці тесту, і навпаки.
// Стилі — .cr-sound* у css/components/roulette.css. Яку іконку видно, вирішує CSS за aria-checked (true — звук увімкнено).

// Розмітка статична (без користувацьких даних), тому innerHTML безпечний
const SWITCH_HTML =
  '<span class="cr-sound-knob" aria-hidden="true">' +
  '<svg class="cr-sound-on" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>' +
  '<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
  '<svg class="cr-sound-off" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>' +
  '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
  '</span>';

export function createSoundSwitch() {
  const button = document.createElement('button');
  button.className = 'cr-sound';
  button.type = 'button';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-label', 'Звук');
  button.innerHTML = SWITCH_HTML;

  const sync = () => button.setAttribute('aria-checked', String(!isSfxMuted()));
  sync();
  button.addEventListener('click', () => {
    setSfxMuted(!isSfxMuted());
    sync();
  });
  return button;
}
