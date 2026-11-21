import { $ } from '../ui/shared.js';

// Степери, закриття .pe-combo по кліку повз нього та блокування wheel на числових полях (#pe-root)
export function bindWidgets(ctx) {
  const { signal } = ctx;
  const root = $('pe-root');

  root?.addEventListener('click', e => {
    const stepperBtn = e.target.closest('.pe-stepper__btn');
    if (stepperBtn) {
      const stepper = stepperBtn.closest('.pe-stepper');
      const numInput = stepper?.querySelector('input[type="number"]');
      if (numInput && !numInput.disabled) {
        if (stepperBtn.dataset.step === 'up') numInput.stepUp();
        else numInput.stepDown();
        numInput.dispatchEvent(new Event('input', { bubbles: true }));
        numInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    if (!e.target.closest('.pe-combo')) {
      document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.pe-combo__toggle').forEach(t => { t.classList.remove('is-open'); });
    }
  }, { signal });

  // У Chrome скрол мишею у сфокусованому input[type="number"] миттєво крутить значення на кожну wheel-подію
  root?.addEventListener('wheel', e => {
    if (e.target?.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target) {
      e.preventDefault();
    }
  }, { signal, passive: false });
}
