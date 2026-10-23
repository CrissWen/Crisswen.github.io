// ===== Підказки редактора паків: будь-який елемент із data-tip показує текст при наведенні / фокусі =====
// Один спільний <div class="pe-tip"> з position:fixed: на відміну від CSS-підказки всередині елемента, її не обрізають
// контейнери з overflow (бокова панель категорій). Звичайний title не підходить: з'являється із затримкою і не стилізується.
// initTips() можна викликати скільки завгодно разів — слухачі вішаються один раз на весь документ.

const GAP = 8;   // відстань між елементом і підказкою
const EDGE = 8;  // мінімальний відступ підказки від країв екрана

let tipEl = null;
let target = null;
let rafId = 0;
let bound = false;
let hideTimer = null;

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(delay = 180) {
  cancelHide();
  hideTimer = setTimeout(hide, delay);
}

function ensureTip() {
  if (tipEl?.isConnected) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'pe-tip';
  tipEl.setAttribute('role', 'tooltip');

  // Дозволяємо миші переходити у підказку для інтерактивних дій (напр. кнопка приховати попередження)
  tipEl.addEventListener('mouseenter', cancelHide);
  tipEl.addEventListener('mouseleave', e => {
    if (target && target.contains(e.relatedTarget)) return;
    scheduleHide(150);
  });
  tipEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="mute-shortage"]');
    if (btn) {
      hide();
      document.dispatchEvent(new CustomEvent('pack:mute-shortage'));
    }
  });

  document.body.appendChild(tipEl);
  return tipEl;
}

// Праворуч від елемента; якщо там немає місця — ліворуч; по вертикалі центруємо й тримаємо в межах екрана
function place(el) {
  const tip = ensureTip();
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();

  let left = r.right + GAP;
  if (left + t.width > window.innerWidth - EDGE) left = r.left - t.width - GAP;
  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, window.innerWidth - t.width - EDGE));

  let top = r.top + r.height / 2 - t.height / 2;
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, window.innerHeight - t.height - EDGE));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// Елемент міг зникнути зі сторінки, поки підказка відкрита (панель категорій перемальовується при кожній зміні) —
// тоді mouseout не прийде, тому поки підказка видима, стежимо за цим самі
function watch() {
  cancelAnimationFrame(rafId);
  const tick = () => {
    if (!target) return;
    if (!target.isConnected || !target.dataset.tip) { hide(); return; }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function show(el) {
  cancelHide();
  const text = el.dataset.tip;
  if (!text) return;
  const tip = ensureTip();
  if (el.dataset.tipType === 'shortage') {
    tip.classList.add('is-interactive');
    tip.innerHTML = `
      <div class="pe-tip__text">${text}</div>
      <button type="button" class="pe-tip__btn" data-action="mute-shortage">Більше не показувати для цього пака</button>
    `;
  } else {
    tip.classList.remove('is-interactive');
    tip.textContent = text;
  }
  target = el;
  place(el);
  tip.classList.add('is-visible');
  watch();
}

function hide() {
  cancelHide();
  target = null;
  cancelAnimationFrame(rafId);
  tipEl?.classList.remove('is-visible');
  tipEl?.classList.remove('is-interactive');
}

const tipOf = node => node?.closest?.('[data-tip]') || null;

export function initTips() {
  if (bound) return;
  bound = true;

  document.addEventListener('mouseover', e => {
    const el = tipOf(e.target);
    if (el) {
      cancelHide();
      if (el !== target) show(el);
    }
  });
  document.addEventListener('mouseout', e => {
    const el = tipOf(e.target);
    if (!el) return;
    const rel = e.relatedTarget;
    if (el.contains(rel) || tipEl?.contains(rel)) return;
    if (tipEl?.classList.contains('is-interactive')) {
      scheduleHide(200);
    } else {
      hide();
    }
  });

  // З клавіатури: фокус на кнопці, яка містить іконку (рядок категорії), показує підказку цієї іконки.
  // Лише :focus-visible — інакше клік мишею по рядку теж відкривав би підказку
  document.addEventListener('focusin', e => {
    const node = e.target;
    if (!node?.matches?.(':focus-visible')) return;
    const el = tipOf(node) || node.querySelector?.('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  // Дотик: tap по іконці показує підказку, tap деінде ховає
  document.addEventListener('pointerdown', e => {
    if (!tipOf(e.target) && !tipEl?.contains(e.target)) hide();
  });
}
