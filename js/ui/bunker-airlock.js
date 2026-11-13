/**
 * Інтерактивний оверлей розблокування аудіо та входу в бункер (Bunker Airlock).
 * Підтримує 3 контекстні режими:
 * 1. 'join' (Лобі очікування) — Контрольно-пропускний шлюз зі штурвалом (+45°), спалахом індикатора (#10b981) та розсуванням стулок (~240мс).
 * 2. 'reconnect' (Активна гра, релоад/повернення вкладки) — Аварійний термінал втрати сигналу з напівпрозорим блюром та миттєвим виходом (~100мс).
 * 3. 'spectator' (Новий глядач у розпочатій грі) — Термінал спостереження CCTV з бейджем «НАЖИВО» та миттєвим виходом (~100мс).
 */

import { soundManager, SOUND_IDS } from '../services/sound-manager.js';
import { esc } from '../utils/auth/security.js';
import { isLdmEnabled } from '../services/display-settings.js';

let activeCleanup = null;
let isGameStartedState = false;

function buildJoinMarkup({ code, name }) {
  return `
    <div class="bunker-airlock__leaves">
      <div class="bunker-airlock__leaf bunker-airlock__leaf--left" data-airlock-leaf="left">
        <div class="bunker-airlock__hazard-strip"></div>
      </div>
      <div class="bunker-airlock__leaf bunker-airlock__leaf--right" data-airlock-leaf="right">
        <div class="bunker-airlock__hazard-strip"></div>
      </div>
    </div>
    <div class="bunker-airlock__card bunker-airlock__card--join">
      <div class="bunker-airlock__beacon">
        <span class="bunker-airlock__dot bunker-airlock__dot--warning" data-airlock-status-dot></span>
        <span data-airlock-status-text aria-live="polite">СТАТУС: ОЧІКУВАННЯ ДОПУСКУ</span>
      </div>
      <div class="bunker-airlock__lock" aria-hidden="true">
        <svg class="bunker-airlock__wheel" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="14 6.5" />
          <circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" stroke-width="5" opacity="0.85" />
          <g stroke="currentColor" stroke-width="6" stroke-linecap="round">
            <line x1="60" y1="14" x2="60" y2="106" />
            <line x1="20.2" y1="37" x2="99.8" y2="83" />
            <line x1="20.2" y1="83" x2="99.8" y2="37" />
          </g>
          <circle cx="60" cy="60" r="21" fill="#12151e" stroke="currentColor" stroke-width="4" />
          <circle cx="60" cy="44" r="2.2" fill="currentColor" />
          <circle cx="73.8" cy="52" r="2.2" fill="currentColor" />
          <circle cx="73.8" cy="68" r="2.2" fill="currentColor" />
          <circle cx="60" cy="76" r="2.2" fill="currentColor" />
          <circle cx="46.2" cy="68" r="2.2" fill="currentColor" />
          <circle cx="46.2" cy="52" r="2.2" fill="currentColor" />
        </svg>
        <div class="bunker-airlock__core"></div>
      </div>
      <h2 class="bunker-airlock__title">ШЛЮЗ БУНКЕРА #${esc(code)}</h2>
      <p class="bunker-airlock__sub" data-airlock-sub>ВИЖИЛИЙ: <strong>${esc(name)}</strong> • СЕКТОР #${esc(code)}</p>
      <button type="button" class="bunker-airlock__btn bunker-airlock__btn--hazard" data-airlock-btn>
        <span data-airlock-btn-text>ВІДЧИНИТИ ГЕРМОШЛЮЗ</span>
      </button>
      <span class="bunker-airlock__hint">Клацніть у будь-якому місці або натисніть Enter для входу</span>
    </div>
  `;
}

function buildReconnectMarkup({ code }) {
  return `
    <div class="bunker-airlock__card bunker-airlock__card--reconnect">
      <div class="bunker-airlock__beacon bunker-airlock__beacon--danger">
        <span class="bunker-airlock__dot bunker-airlock__dot--danger"></span>
        <span>АВАРІЙНИЙ ПРОТОКОЛ ЗВ'ЯЗКУ</span>
      </div>
      <h2 class="bunker-airlock__title">СИГНАЛ БУНКЕРА ВТРАЧЕНО #${esc(code)}</h2>
      <p class="bunker-airlock__sub">Матч триває! Раунд у розпалі. Термінал очікує перепідключення.</p>
      <button type="button" class="bunker-airlock__btn bunker-airlock__btn--danger" data-airlock-btn>
        <span>ПОВЕРНУТИСЯ ДО ГРИ</span>
      </button>
      <span class="bunker-airlock__hint">Або натисніть будь-де / клавішу Enter</span>
    </div>
  `;
}

function buildSpectatorMarkup({ code }) {
  return `
    <div class="bunker-airlock__card bunker-airlock__card--spectator">
      <div class="bunker-airlock__beacon bunker-airlock__beacon--live">
        <span class="bunker-airlock__dot bunker-airlock__dot--live"></span>
        <span>НАЖИВО • РЕЖИМ СПОСТЕРЕЖЕННЯ</span>
      </div>
      <h2 class="bunker-airlock__title">ТЕРМІНАЛ СПОСТЕРІГАЧА #${esc(code)}</h2>
      <p class="bunker-airlock__sub">Матч у розпалі. Увімкніть аудіопотік для трансляції атмосфери бункера.</p>
      <button type="button" class="bunker-airlock__btn bunker-airlock__btn--spectator" data-airlock-btn>
        <span>ДИВИТИСЯ ГРУ</span>
      </button>
      <span class="bunker-airlock__hint">Клацніть у будь-якому місці або натисніть Enter</span>
    </div>
  `;
}

/**
 * Монтує інтерактивний шлюз бункера поверх гри, якщо аудіоконтекст ще заблоковано браузером.
 * @param {object} options
 * @param {string} options.roomCode
 * @param {'join'|'reconnect'|'spectator'} [options.mode='join']
 * @param {string} [options.userName='Гравець']
 * @param {Function} [options.onUnlocked]
 * @returns {Function} Функція примусового демонтажу (cleanup)
 */
export function mountBunkerAirlock({
  roomCode = '0000',
  mode = 'join',
  userName = 'Гравець',
  onUnlocked,
} = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return () => {};
  }

  if (typeof activeCleanup === 'function') {
    activeCleanup();
  }
  isGameStartedState = false;

  const normalizedMode = mode === 'reconnect' || mode === 'spectator' ? mode : 'join';
  const code = String(roomCode || '0000').toUpperCase();
  const name = String(userName || 'Гравець');

  const overlay = document.createElement('div');
  overlay.id = 'bunker-airlock-overlay';
  overlay.className = `bunker-airlock bunker-airlock--${normalizedMode}`;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('data-no-click-sound', 'true');
  overlay.setAttribute(
    'aria-label',
    normalizedMode === 'join'
      ? `Шлюз бункера ${code}`
      : normalizedMode === 'reconnect'
        ? `Відновлення сигналу бункера ${code}`
        : `Термінал спостерігача бункера ${code}`
  );

  if (normalizedMode === 'reconnect') {
    overlay.innerHTML = buildReconnectMarkup({ code });
  } else if (normalizedMode === 'spectator') {
    overlay.innerHTML = buildSpectatorMarkup({ code });
  } else {
    overlay.innerHTML = buildJoinMarkup({ code, name });
  }

  document.body.appendChild(overlay);

  const btn = overlay.querySelector('[data-airlock-btn]');
  if (btn && typeof btn.focus === 'function') {
    btn.focus();
  }

  let triggered = false;
  let cleaned = false;
  let exitTimer = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    isGameStartedState = false;
    if (exitTimer) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown, true);
    }
    overlay.removeEventListener('click', onActivate);
    overlay.remove();
    if (activeCleanup === cleanup) {
      activeCleanup = null;
    }
  };

  const onActivate = async (e) => {
    if (triggered || cleaned) return;
    triggered = true;
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }

    try {
      await soundManager.unlock();
    } catch (_) {}

    const clickSound = normalizedMode === 'join' ? SOUND_IDS.LOCK_TOGGLE : SOUND_IDS.UI_CLICK;
    soundManager.play(clickSound, { bypassThrottle: true });

    if (typeof onUnlocked === 'function') {
      try {
        onUnlocked();
      } catch (_) {}
    }

    // Без анімації відкривання: системне «зменшити анімацію» або ручний LDM (Профіль → Вигляд)
    const prefersReducedMotion =
      isLdmEnabled() ||
      (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (prefersReducedMotion) {
      cleanup();
      return;
    }

    overlay.classList.add('is-opening');
    const exitDurationMs = normalizedMode === 'join' && !isGameStartedState ? 240 : 110;
    exitTimer = setTimeout(() => {
      cleanup();
    }, exitDurationMs);
  };

  const onKeyDown = (e) => {
    if (triggered || cleaned) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
      onActivate(e);
    }
  };

  overlay.addEventListener('click', onActivate);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true);
  }

  activeCleanup = cleanup;
  return cleanup;
}

export function unmountBunkerAirlock() {
  if (typeof activeCleanup === 'function') {
    activeCleanup();
  }
  isGameStartedState = false;
}

export function isBunkerAirlockMounted() {
  return Boolean(
    typeof document !== 'undefined' &&
    document.getElementById('bunker-airlock-overlay')
  );
}

export function notifyAirlockGameStarted() {
  if (typeof document === 'undefined') return;
  const overlay = document.getElementById('bunker-airlock-overlay');
  if (!overlay || !overlay.classList.contains('bunker-airlock--join')) return;

  isGameStartedState = true;
  overlay.classList.add('bunker-airlock--game-started');
  overlay.setAttribute('aria-label', 'Увага! Гра розпочалася. Натисніть для входу в бункер');

  const dot = overlay.querySelector('[data-airlock-status-dot]');
  if (dot) {
    dot.className = 'bunker-airlock__dot bunker-airlock__dot--danger';
  }

  const statusText = overlay.querySelector('[data-airlock-status-text]');
  if (statusText) {
    statusText.textContent = 'УВАГА // ГРА РОЗПОЧАЛАСЯ!';
  }

  const sub = overlay.querySelector('[data-airlock-sub]');
  if (sub) {
    sub.textContent = 'Матч уже розпочато! Натисніть для негайного підключення.';
  }

  const btn = overlay.querySelector('[data-airlock-btn]');
  if (btn) {
    btn.className = 'bunker-airlock__btn bunker-airlock__btn--danger';
  }

  const btnText = overlay.querySelector('[data-airlock-btn-text]');
  if (btnText) {
    btnText.textContent = 'УВІЙТИ ДО ГРИ (МАТЧ ТРИВАЄ)';
  }
}

