/**
 * Контролер кінематографічного переходу старту гри «Бункерні гермодвері» (Bunker Blast Doors).
 * Побудований на Vector SVG + Web Animations API (WAAPI) + Hardware Compositor CSS (transform, opacity).
 */

import { soundManager, SOUND_IDS } from '../services/sound-manager.js';

let activeTransition = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveRoomCode(roomCode) {
  let code = roomCode;
  if (!code && typeof window !== 'undefined' && window.location?.hash) {
    const match = window.location.hash.match(/#\/game\/([a-zA-Z0-9_-]+)/i);
    if (match?.[1]) code = match[1];
  }
  if (!code) return 'БУНКЕР-01';
  const clean = String(code).trim().replace(/^#/, '').toUpperCase();
  return clean ? `БУНКЕР-${clean}` : 'БУНКЕР-01';
}

/**
 * Повертає HTML-розмітку векторного оверлею шлюзу бункера.
 */
function buildBunkerOverlayMarkup({ roomCode } = {}) {
  const displayCode = resolveRoomCode(roomCode);
  return `
    <div class="bunker-vault-stage" data-vault-stage>
      <div class="bunker-vault-backdrop" data-vault-backdrop></div>

      <div class="bunker-vault-frame-bar bunker-vault-frame-bar--top" data-vault-bar-top></div>
      <div class="bunker-vault-frame-bar bunker-vault-frame-bar--bottom" data-vault-bar-bottom></div>

      <!-- ЛІВА БРОНЕСТУЛКА -->
      <div class="bunker-door-leaf bunker-door-leaf--left" data-vault-left>
        <div class="bunker-door__hazard-edge"></div>
        <!-- Вертикальні запірні ригелі в раму (стелю та підлогу) -->
        <div class="bunker-door__vbolt-sleeve bunker-door__vbolt-sleeve--top">
          <div class="bunker-door__vbolt bunker-door__vbolt--top" data-vault-bolt></div>
        </div>
        <div class="bunker-door__vbolt-sleeve bunker-door__vbolt-sleeve--bottom">
          <div class="bunker-door__vbolt bunker-door__vbolt--bottom" data-vault-bolt></div>
        </div>
        <div class="bunker-door__plate">
          <svg class="bunker-door__ribs" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="0" x2="400" y2="600" stroke="currentColor" stroke-width="3" />
            <line x1="400" y1="0" x2="0" y2="600" stroke="currentColor" stroke-width="3" />
            <rect x="14" y="14" width="372" height="572" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 8" />
          </svg>
          <div class="bunker-door__piston"></div>
          <div class="bunker-door__stencil">
            <span class="bunker-door__stencil-sub">ЗАХИСНИЙ КОНТУР // СЕКТОР 01</span>
            <span class="bunker-door__stencil-code" data-vault-room-code>${escapeHtml(displayCode)}</span>
            <!-- Емблема радіаційної/біологічної ізоляції -->
            <svg class="bunker-door__watermark" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
              <circle cx="32" cy="32" r="6" />
              <path d="M32 8a24 24 0 0 1 20.78 12l-12.12 7a10 10 0 0 0-8.66-5V8zm20.78 36A24 24 0 0 1 32 56V42a10 10 0 0 0 8.66-5l12.12 7zM11.22 44l12.12-7a10 10 0 0 0 0-10l-12.12-7a24 24 0 0 0 0 24z"/>
              <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" stroke-width="2.5" />
            </svg>
          </div>
          <div class="bunker-door__piston"></div>
        </div>
      </div>

      <!-- ПРАВА БРОНЕСТУЛКА -->
      <div class="bunker-door-leaf bunker-door-leaf--right" data-vault-right>
        <div class="bunker-door__hazard-edge"></div>
        <!-- Вертикальні запірні ригелі в раму (стелю та підлогу) -->
        <div class="bunker-door__vbolt-sleeve bunker-door__vbolt-sleeve--top">
          <div class="bunker-door__vbolt bunker-door__vbolt--top" data-vault-bolt></div>
        </div>
        <div class="bunker-door__vbolt-sleeve bunker-door__vbolt-sleeve--bottom">
          <div class="bunker-door__vbolt bunker-door__vbolt--bottom" data-vault-bolt></div>
        </div>
        <div class="bunker-door__plate">
          <svg class="bunker-door__ribs" viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" y1="0" x2="400" y2="600" stroke="currentColor" stroke-width="3" />
            <line x1="400" y1="0" x2="0" y2="600" stroke="currentColor" stroke-width="3" />
            <rect x="14" y="14" width="372" height="572" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 8" />
          </svg>
          <div class="bunker-door__piston"></div>
          <div class="bunker-door__stencil">
            <span class="bunker-door__stencil-sub">ПРОТИРАДІАЦІЙНИЙ ГЕРМОШЛЮЗ</span>
            <span class="bunker-door__stencil-code">ШЛЮЗ MK-IV</span>
            <!-- Емблема шестерні Сховища -->
            <svg class="bunker-door__watermark" viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
              <path d="M27 4h10l2 8 7.5 3.1 7.1-4.2 7.1 7.1-4.2 7.1L59.6 32l-3.1 7.5 4.2 7.1-7.1 7.1-7.1-4.2L39 52.6 37 60H27l-2-7.4-7.5-3.1-7.1 4.2-7.1-7.1 4.2-7.1L4.4 32l3.1-7.5-4.2-7.1 7.1-7.1 7.1 4.2L25 12l2-8zm5 16a12 12 0 1 0 0 24 12 12 0 0 0 0-24z"/>
            </svg>
          </div>
          <div class="bunker-door__piston"></div>
        </div>
      </div>

      <!-- ПНЕВМАТИЧНИЙ ВИКИД ПАРИ -->
      <div class="bunker-vault-steam" data-vault-steam></div>

      <!-- ЦЕНТРАЛЬНИЙ ЗАМОК-ШТУРВАЛ ТА HUD ТАБЛО -->
      <div class="bunker-vault-center">
        <div class="bunker-vault-lock" data-vault-lock>
          <svg class="bunker-vault-wheel" data-vault-wheel viewBox="0 0 120 120" aria-hidden="true">
            <!-- Зовнішній зубчастий обід -->
            <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" stroke-width="6" stroke-dasharray="14 6.5" />
            <circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" stroke-width="5" opacity="0.85" />
            <!-- 6 силових спиць штурвала -->
            <g stroke="currentColor" stroke-width="6" stroke-linecap="round">
              <line x1="60" y1="14" x2="60" y2="106" />
              <line x1="20.2" y1="37" x2="99.8" y2="83" />
              <line x1="20.2" y1="83" x2="99.8" y2="37" />
            </g>
            <!-- Центральна маточина з болтами -->
            <circle cx="60" cy="60" r="21" fill="#12151e" stroke="currentColor" stroke-width="4" />
            <circle cx="60" cy="44" r="2.2" fill="currentColor" />
            <circle cx="73.8" cy="52" r="2.2" fill="currentColor" />
            <circle cx="73.8" cy="68" r="2.2" fill="currentColor" />
            <circle cx="60" cy="76" r="2.2" fill="currentColor" />
            <circle cx="46.2" cy="68" r="2.2" fill="currentColor" />
            <circle cx="46.2" cy="52" r="2.2" fill="currentColor" />
          </svg>
          <div class="bunker-vault-lock__core"></div>
        </div>

        <div class="bunker-vault-hud" data-vault-hud>
          <div class="bunker-vault-hud__beacon">
            <span class="bunker-vault-hud__dot"></span>
            <span data-vault-beacon-text>ТРИВОГА // ПРОТОКОЛ ІЗОЛЯЦІЇ</span>
          </div>
          <h3 class="bunker-vault-hud__title" data-vault-title>УВАГА! ЗАКРИТТЯ ШЛЮЗУ</h3>
          <div class="bunker-vault-hud__sub" data-vault-sub>LOCKDOWN PROTOCOL // INITIATED</div>
        </div>
      </div>







    </div>
  `;
}

/**
 * Безпечне очікування Web Animation або таймера з підтримкою переривання (AbortSignal).
 */
function waitMs(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Допоміжна обгортка для Web Animations API з гарантованим завершенням за тайм-аутом,
 * щоб фонова вкладка або специфічний браузер ніколи не заблокували перехід гри.
 */
function animateElement(el, keyframes, options, signal) {
  if (!el || typeof el.animate !== 'function' || signal?.aborted) {
    return Promise.resolve();
  }
  const duration = Number(options?.duration) || 0;
  const delay = Number(options?.delay) || 0;
  const anim = el.animate(keyframes, { fill: 'forwards', ...options });

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve(anim);
    };
    const onAbort = () => {
      try {
        anim.cancel();
      } catch (_) {}
      finish();
    };
    const safetyTimer = setTimeout(finish, duration + delay + 120);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (anim.finished && typeof anim.finished.then === 'function') {
      anim.finished.then(finish).catch(finish);
    } else {
      anim.onfinish = finish;
      anim.oncancel = finish;
    }
  });
}

/**
 * Перевіряє, чи виконується зараз анімація бункерних дверей.
 */
export function isBunkerDoorTransitionActive() {
  return Boolean(activeTransition);
}

/**
 * Примусово скасовує активний перехід (наприклад, при виході з кімнати).
 */
export function cancelBunkerDoorTransition() {
  if (!activeTransition) return;
  activeTransition.cancel();
}

/**
 * Запускає повноекранний перехід старту гри «Бункерні двері».
 *
 * @param {object} [options]
 * @param {string} [options.roomCode] - Код кімнати гри (відображається трафаретом на дверях замість Бункер-01)
 * @param {() => void | Promise<void>} [options.onSealed] - Викликається в момент повної герметизації (екран 100% перекритий)
 * @param {() => void} [options.onComplete] - Викликається після повного відкриття дверей або пропуску
 * @param {boolean} [options.allowSkip=true] - Дозволити пропуск по Esc або кнопці
 * @returns {Promise<void>}
 */
export async function playBunkerDoorTransition({
  roomCode,
  onSealed,
  onComplete,
  allowSkip = true,
} = {}) {
  if (typeof document === 'undefined' || !document.body) {
    if (typeof onSealed === 'function') await onSealed();
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  // Якщо попередній перехід ще триває — акуратно завершуємо його перед новим
  if (activeTransition) {
    activeTransition.skipToEnd();
  }

  const abortController = new AbortController();
  const { signal } = abortController;

  let sealedCalled = false;
  let completeCalled = false;
  let cleanedUp = false;

  const runSealedCallback = async () => {
    if (sealedCalled) return;
    sealedCalled = true;
    if (typeof onSealed === 'function') {
      try {
        await onSealed();
      } catch (err) {
        console.error('[BunkerTransition] Помилка у колбеку onSealed:', err);
      }
    }
  };

  const runCompleteCallback = () => {
    if (completeCalled) return;
    completeCalled = true;
    if (typeof onComplete === 'function') {
      try {
        onComplete();
      } catch (err) {
        console.error('[BunkerTransition] Помилка у колбеку onComplete:', err);
      }
    }
  };

  const overlay = document.createElement('div');
  overlay.className = 'bunker-vault-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'Запуск гри: герметизація бункера');
  overlay.dataset.phase = 'closing';
  overlay.innerHTML = buildBunkerOverlayMarkup({ roomCode });
  document.body.appendChild(overlay);

  const stageEl = overlay.querySelector('[data-vault-stage]');
  const backdropEl = overlay.querySelector('[data-vault-backdrop]');
  const topBarEl = overlay.querySelector('[data-vault-bar-top]');
  const bottomBarEl = overlay.querySelector('[data-vault-bar-bottom]');
  const leftLeafEl = overlay.querySelector('[data-vault-left]');
  const rightLeafEl = overlay.querySelector('[data-vault-right]');
  const boltsEls = Array.from(overlay.querySelectorAll('[data-vault-bolt]'));
  const steamEl = overlay.querySelector('[data-vault-steam]');
  const lockEl = overlay.querySelector('[data-vault-lock]');
  const wheelEl = overlay.querySelector('[data-vault-wheel]');
  const hudEl = overlay.querySelector('[data-vault-hud]');
  const beaconTextEl = overlay.querySelector('[data-vault-beacon-text]');
  const titleEl = overlay.querySelector('[data-vault-title]');
  const subEl = overlay.querySelector('[data-vault-sub]');


  const setHudPhase = (phase, beacon, title, sub) => {
    if (signal.aborted) return;
    overlay.dataset.phase = phase;
    if (beaconTextEl) beaconTextEl.textContent = beacon;
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = sub;
  };

  const cleanupDOM = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    if (activeTransition?.overlay === overlay) {
      activeTransition = null;
    }
  };

  const skipToEnd = async () => {
    if (cleanedUp) return;
    abortController.abort();
    await runSealedCallback();
    cleanupDOM();
    runCompleteCallback();
  };

  const cancel = () => {
    if (cleanedUp) return;
    abortController.abort();
    cleanupDOM();
  };

  function onKeyDown(e) {
    if (!allowSkip) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      skipToEnd();

    }
  }

  if (allowSkip) {
    window.addEventListener('keydown', onKeyDown, true);




  }

  activeTransition = {
    overlay,
    skipToEnd,
    cancel,
  };

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===========================================================================
  // СЦЕНАРІЙ A: СПОКІЙНИЙ ПЕРЕХІД (PREFERS-REDUCED-MOTION)
  // ===========================================================================
  if (prefersReducedMotion) {
    await Promise.all([
      animateElement(backdropEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }, signal),
      animateElement(hudEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' }, signal),
    ]);
    if (signal.aborted) return;

    setHudPhase('sealed', 'СТАТУС: ГЕРМЕТИЧНО', 'ГЕРМЕТИЗАЦІЯ ЗАВЕРШЕНА', 'ДОСТУП ДО БУНКЕРА НАДАНО');
    await runSealedCallback();
    await waitMs(220, signal);
    if (signal.aborted) return;

    await animateElement(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-in' }, signal);
    cleanupDOM();
    runCompleteCallback();
    return;
  }

  // ===========================================================================
  // СЦЕНАРІЙ B: ПОВНИЙ КІНЕМАТОГРАФІЧНИЙ ТАЙМЛАЙН БРОНЕДВЕРЕЙ (~5.0с)
  // ===========================================================================

  // --- Фаза 0 + 1: Передчуття, сирена та повільне масивне насування стулок (0.0s -> 1.60s) ---
  soundManager.play(SOUND_IDS.BUNKER_DOOR_CLOSE, { bypassThrottle: true });

  const closeEasing = 'cubic-bezier(0.82, 0, 0.18, 1)';

  animateElement(
    topBarEl,
    [{ transform: 'translate3d(0, -100%, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: 340, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
    signal
  );
  animateElement(
    bottomBarEl,
    [{ transform: 'translate3d(0, 100%, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
    { duration: 340, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' },
    signal
  );
  animateElement(
    backdropEl,
    [{ opacity: 0 }, { opacity: 0.6, offset: 0.75 }, { opacity: 1 }],
    { duration: 1450, easing: 'ease-in' },
    signal
  );
  animateElement(
    hudEl,
    [
      { opacity: 0, transform: 'translate3d(0, 16px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 520, delay: 220, easing: 'ease-out' },
    signal
  );
  animateElement(
    lockEl,
    [
      { opacity: 0, transform: 'scale3d(0.65, 0.65, 1)' },
      { opacity: 1, transform: 'scale3d(1, 1, 1)' },
    ],
    { duration: 560, delay: 680, easing: 'cubic-bezier(0.34, 1.45, 0.64, 1)' },
    signal
  );

  await Promise.all([
    animateElement(
      leftLeafEl,
      [{ transform: 'translate3d(-104%, 0, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 1400, delay: 180, easing: closeEasing },
      signal
    ),
    animateElement(
      rightLeafEl,
      [{ transform: 'translate3d(104%, 0, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: 1400, delay: 180, easing: closeEasing },
      signal
    ),
  ]);

  if (signal.aborted) return;

  // --- Фаза 2: Нищівний удар зіткнення + глибокий Camera Shake (1.60s -> 2.05s) ---
  soundManager.play(SOUND_IDS.BUNKER_DOOR_SLAM, { bypassThrottle: true });

  // Глибокий струс камери від зіткнення багатотонних бронеплит
  animateElement(
    stageEl,
    [
      { transform: 'translate3d(0, 0, 0)' },
      { transform: 'translate3d(-6px, 5px, 0)' },
      { transform: 'translate3d(6px, -4px, 0)' },
      { transform: 'translate3d(-4px, -3px, 0)' },
      { transform: 'translate3d(3px, 3px, 0)' },
      { transform: 'translate3d(-2px, 1px, 0)' },
      { transform: 'translate3d(1px, -1px, 0)' },
      { transform: 'translate3d(0, 0, 0)' },
    ],
    { duration: 360, easing: 'ease-out' },
    signal
  );

  // Потужний викид пари декомпресії по центральному шву
  animateElement(
    steamEl,
    [
      { opacity: 0, transform: 'scale3d(0.2, 0.6, 1)' },
      { opacity: 0.9, transform: 'scale3d(1.25, 1.05, 1)', offset: 0.3 },
      { opacity: 0, transform: 'scale3d(2.0, 1.25, 1)' },
    ],
    { duration: 750, easing: 'ease-out' },
    signal
  );

  await waitMs(260, signal);
  if (signal.aborted) return;

  // --- Фаза 3: Замикання ригелів, поворот штурвала та саспенс герметизації (2.05s -> 3.50s) ---
  setHudPhase(
    'sealed',
    'СТАТУС: ГЕРМЕТИЧНО',
    'ГЕРМЕТИЗАЦІЯ ЗАВЕРШЕНА',
    'СИНХРОНІЗАЦІЯ СИСТЕМ БУНКЕРА // 100%'
  );

  soundManager.play(SOUND_IDS.BUNKER_HYDRAULIC, { bypassThrottle: true });

  const boltAnimations = boltsEls.map((boltEl) => {
    const isTop = boltEl?.classList?.contains?.('bunker-door__vbolt--top') ?? String(boltEl?.className || '').includes('bunker-door__vbolt--top');
    const targetY = isTop ? -38 : 38;
    return animateElement(
      boltEl,
      [
        { transform: 'translate3d(-50%, 0, 0)' },
        { transform: `translate3d(-50%, ${targetY}px, 0)` },
      ],
      { duration: 380, delay: isTop ? 40 : 120, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      signal
    );
  });

  const wheelLockAnim = animateElement(
    wheelEl,
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(90deg)' }],
    { duration: 680, easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)' },
    signal
  );

  // Поки стулки гарантовано закриті на 100% — монтуємо активну дошку гри під оверлеєм
  await Promise.all([runSealedCallback(), wheelLockAnim, ...boltAnimations]);
  // Атмосферна пауза повної ізоляції для читання статусу та занурення в атмосферу
  await waitMs(650, signal);
  if (signal.aborted) return;

  // --- Фаза 4: Розгерметизація та величне гідравлічне відкриття (3.50s -> 4.85s) ---
  setHudPhase(
    'opening',
    'ДОСТУП ДОЗВОЛЕНО',
    'ДОСТУП НАДАНО',
    'ЛАСКАВО ПРОСИМО У БУНКЕР'
  );

  soundManager.play(SOUND_IDS.BUNKER_DOOR_OPEN, { bypassThrottle: true });

  // Втягуємо вертикальні ригелі та розблоковуємо штурвал
  boltsEls.forEach((boltEl) => {
    const isTop = boltEl?.classList?.contains?.('bunker-door__vbolt--top') ?? String(boltEl?.className || '').includes('bunker-door__vbolt--top');
    const fromY = isTop ? -38 : 38;
    animateElement(
      boltEl,
      [
        { transform: `translate3d(-50%, ${fromY}px, 0)` },
        { transform: 'translate3d(-50%, 0, 0)' },
      ],
      { duration: 240, easing: 'ease-in' },
      signal
    );
  });

  await animateElement(
    wheelEl,
    [{ transform: 'rotate(90deg)' }, { transform: 'rotate(0deg)' }],
    { duration: 340, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    signal
  );
  if (signal.aborted) return;

  // Відкриваємо фонову підкладку, щоб гравець бачив нову дошку за стулками
  animateElement(
    backdropEl,
    [{ opacity: 1 }, { opacity: 0 }],
    { duration: 420, easing: 'ease-out' },
    signal
  );

  animateElement(
    lockEl,
    [
      { opacity: 1, transform: 'scale3d(1, 1, 1)' },
      { opacity: 0, transform: 'scale3d(0.72, 0.72, 1)' },
    ],
    { duration: 420, delay: 100, easing: 'ease-in' },
    signal
  );

  animateElement(
    hudEl,
    [
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      { opacity: 0, transform: 'translate3d(0, -14px, 0)' },
    ],
    { duration: 420, delay: 140, easing: 'ease-in' },
    signal
  );

  const openEasing = 'cubic-bezier(0.16, 1, 0.3, 1)';

  await Promise.all([
    animateElement(
      leftLeafEl,
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(-104%, 0, 0)' }],
      { duration: 1300, easing: openEasing },
      signal
    ),
    animateElement(
      rightLeafEl,
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(104%, 0, 0)' }],
      { duration: 1300, easing: openEasing },
      signal
    ),
    animateElement(
      topBarEl,
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, -100%, 0)' }],
      { duration: 380, delay: 850, easing: 'ease-in' },
      signal
    ),
    animateElement(
      bottomBarEl,
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, 100%, 0)' }],
      { duration: 380, delay: 850, easing: 'ease-in' },
      signal
    ),
  ]);

  if (signal.aborted) return;

  cleanupDOM();
  runCompleteCallback();
}

if (typeof window !== 'undefined') {
  window.playBunkerDoorTransition = playBunkerDoorTransition;
}
