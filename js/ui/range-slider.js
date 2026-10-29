/**
 * Універсальний механізм кастомних повзунків (Range Sliders / Мікшерів) — .bunker-slider
 *
 * Автоматично синхронізує CSS-змінні прогресу (--slider-progress, --control-value, --attr-min, --attr-max)
 * для всіх <input type="range" class="bunker-slider">, забезпечуючи однаковий вигляд заповненої доріжки
 * у всіх браузерах (Chromium, Firefox, Safari) як при ручному перетягуванні, так і при програмній зміні значення.
 */

let globalListenerAttached = false;

/**
 * Оновлює візуальний прогрес заповнення конкретного повзунка.
 * @param {HTMLInputElement} slider
 */
export function syncRangeSlider(slider) {
  if (!slider || slider.tagName !== 'INPUT' || slider.type !== 'range') return;

  const min = Number(slider.min !== '' ? slider.min : 0);
  const max = Number(slider.max !== '' ? slider.max : 100);
  const val = Number(slider.value !== '' ? slider.value : 0);

  const range = max - min;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((val - min) / range) * 100)) : 0;

  slider.style.setProperty('--attr-min', String(min));
  slider.style.setProperty('--attr-max', String(max));
  slider.style.setProperty('--control-value', String(val));
  slider.style.setProperty('--slider-progress', `${pct}%`);
  slider.setAttribute('aria-valuenow', String(Math.round(val)));
  slider.setAttribute('aria-valuetext', `${Math.round(pct)}%`);
}

/**
 * Програмно встановлює значення повзунка та одразу синхронізує його візуальну заливку.
 * @param {HTMLInputElement} slider
 * @param {number|string} value
 */
export function setRangeSliderValue(slider, value) {
  if (!slider) return;
  if (document.activeElement !== slider) {
    slider.value = String(value);
  }
  syncRangeSlider(slider);
}

/**
 * Ініціалізує всі .bunker-slider усередині переданого контейнера (або документа)
 * та підключає глобальний делегований слухач події 'input'.
 * @param {ParentNode} [root=document]
 */
export function initRangeSliders(root = document) {
  if (typeof document === 'undefined') return;

  if (!globalListenerAttached) {
    globalListenerAttached = true;
    document.addEventListener(
      'input',
      (e) => {
        const target = e.target;
        if (target && target.tagName === 'INPUT' && target.type === 'range' && target.classList.contains('bunker-slider')) {
          syncRangeSlider(target);
        }
      },
      { passive: true }
    );
  }

  const sliders = root.querySelectorAll('input[type="range"].bunker-slider');
  sliders.forEach((slider) => syncRangeSlider(slider));
}

