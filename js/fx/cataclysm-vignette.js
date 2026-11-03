/**
 * Модуль атмосферної червоної димки/віньєтки катаклізму (Cataclysm Hazard Vignette).
 * Нагнітає напругу по краях екрана за 5 секунд до падіння таймера на нуль
 * та зберігається на підсумковому екрані запечатаного бункера.
 */

const VIGNETTE_ID = 'cataclysm-hazard-vignette';

export function isCataclysmVignetteMounted() {
  if (typeof document === 'undefined') return false;
  return Boolean(document.getElementById(VIGNETTE_ID));
}

export function mountCataclysmVignette() {
  if (typeof document === 'undefined' || !document.body) return null;
  let el = document.getElementById(VIGNETTE_ID);
  if (el) return el;

  el = document.createElement('div');
  el.id = VIGNETTE_ID;
  el.classList.add('cataclysm-hazard-vignette');
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      el.classList.add('is-active');
    });
  } else {
    el.classList.add('is-active');
  }

  return el;
}

export function unmountCataclysmVignette() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(VIGNETTE_ID);
  if (!el) return;
  el.classList.remove('is-active');
  el.remove();
}
