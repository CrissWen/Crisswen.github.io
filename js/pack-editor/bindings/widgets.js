import { $ } from '../ui/helpers.js';
import { syncCustomSelect } from '../controllers/controllers.js';

// Степери, кастомні селекти і закриття випадаючих списків по кліку повз них (делегування на #pe-root)
export function bindWidgets(ctx) {
  const { signal } = ctx;

  $('pe-root')?.addEventListener('click', e => {
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

    const selectBtn = e.target.closest('.pe-select-custom__btn');
    if (selectBtn) {
      const wrap = selectBtn.closest('.pe-select-custom');
      const dropdown = wrap?.querySelector('.pe-select-custom__dropdown');
      if (dropdown) {
        const isOpening = dropdown.hidden;
        document.querySelectorAll('.pe-select-custom__dropdown').forEach(d => { d.hidden = true; });
        document.querySelectorAll('.pe-select-custom__btn').forEach(b => {
          b.classList.remove('is-open');
          b.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });

        dropdown.hidden = !isOpening;
        selectBtn.classList.toggle('is-open', isOpening);
        selectBtn.setAttribute('aria-expanded', String(isOpening));
      }
      return;
    }

    const selectItem = e.target.closest('.pe-select-custom__item');
    if (selectItem) {
      const wrap = selectItem.closest('.pe-select-custom');
      const hiddenSelect = wrap?.querySelector('.pe-hidden-select');
      const val = selectItem.dataset.value;
      if (hiddenSelect) {
        hiddenSelect.value = val;
        syncCustomSelect(hiddenSelect);
        hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
        hiddenSelect.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const dropdown = wrap?.querySelector('.pe-select-custom__dropdown');
      const btn = wrap?.querySelector('.pe-select-custom__btn');
      if (dropdown) dropdown.hidden = true;
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    if (!e.target.closest('.pe-select-custom')) {
      document.querySelectorAll('.pe-select-custom__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.pe-select-custom__btn').forEach(b => {
        b.classList.remove('is-open');
        b.setAttribute('aria-expanded', 'false');
      });
    }

    if (!e.target.closest('.pe-combo')) {
      document.querySelectorAll('.pe-combo__dropdown').forEach(d => { d.hidden = true; });
      document.querySelectorAll('.pe-combo__toggle').forEach(t => { t.classList.remove('is-open'); });
    }
  }, { signal });
}
