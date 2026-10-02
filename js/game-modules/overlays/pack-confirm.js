// Вікно підтвердження для сторінок паків (#/packs, #/pack-editor). Окрема копія confirm-dialog.js, щоб не чіпати глобальне вікно гри
// (панель ведучого, char-lock) і мати власний вигляд та захист від випадкового кліку:
//  1) безпечна кнопка «Скасувати» стоїть з боку, ближчого до кнопки-якоря (де зазвичай курсор), а небезпечна — з протилежного;
//  2) кнопка підтвердження перші LOCK_MS мс неактивна, тож швидкий або подвійний клік нічого не видалить;
//  3) фокус одразу на «Скасувати»: випадковий Enter теж нічого не робить.

const CONFIRM_ID = 'pack-confirm-root';
const GAP = 12;        // відступ між кнопкою-якорем і вікном
const EDGE = 8;        // мінімальний відступ від країв екрана
const LOCK_MS = 450;   // скільки кнопка підтвердження неактивна після появи вікна

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Порядок у DOM: «Скасувати» першим (природний порядок Tab); візуально його сторону визначає data-side у CSS
function dialogHtml(message, { confirmLabel, cancelLabel, danger }) {
  return `
    <div id="${CONFIRM_ID}" class="pk-confirm${danger ? ' pk-confirm--danger' : ''}" role="alertdialog" aria-modal="true" data-side="left">
      <p class="pk-confirm__text">${esc(message)}</p>
      <div class="pk-confirm__row">
        <button type="button" class="pk-confirm__btn pk-confirm__btn--cancel" data-confirm="no">${esc(cancelLabel)}</button>
        <button type="button" class="pk-confirm__btn pk-confirm__btn--ok is-locked" data-confirm="yes" disabled>${esc(confirmLabel)}</button>
      </div>
    </div>
  `;
}

// Вікно з'являється ЛІВОРУЧ від якоря; якщо там немає місця — праворуч. Повертає, з якого боку воно опинилось,
// щоб «Скасувати» поставити ближче до якоря (CSS за data-side).
function positionDialog(root, anchorEl) {
  const anchor = anchorEl.getBoundingClientRect();
  const dialog = root.getBoundingClientRect();

  let side = 'left';
  let left = anchor.left - dialog.width - GAP;
  if (left < EDGE) {
    const rightLeft = anchor.right + GAP;
    if (rightLeft + dialog.width <= window.innerWidth - EDGE) {
      left = rightLeft;
      side = 'right';
    }
  }

  let top = anchor.top + anchor.height / 2 - dialog.height / 2;

  const maxLeft = Math.max(EDGE, window.innerWidth - dialog.width - EDGE);
  const maxTop = Math.max(EDGE, window.innerHeight - dialog.height - EDGE);
  left = Math.min(Math.max(left, EDGE), maxLeft);
  top = Math.min(Math.max(top, EDGE), maxTop);

  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.dataset.side = side;
}

// showPackConfirm(messageText, anchorEl, options?) -> Promise<boolean>
// options: { confirmLabel = 'Видалити', cancelLabel = 'Скасувати', danger = true }
// resolve(true) лише при натисканні кнопки підтвердження (після розблокування); «Скасувати», Escape і клік поза вікном — false.
export function showPackConfirm(messageText, anchorEl, options = {}) {
  const { confirmLabel = 'Видалити', cancelLabel = 'Скасувати', danger = true } = options;

  return new Promise(resolve => {
    // Попереднє вікно (дуже швидкий повторний клік) прибираємо без результату
    document.getElementById(CONFIRM_ID)?.remove();

    document.body.insertAdjacentHTML('beforeend', dialogHtml(messageText, { confirmLabel, cancelLabel, danger }));
    const root = document.getElementById(CONFIRM_ID);
    const okBtn = root.querySelector('[data-confirm="yes"]');
    const cancelBtn = root.querySelector('[data-confirm="no"]');

    positionDialog(root, anchorEl);

    // rAF, щоб браузер застосував початковий стан ДО .is-open — інакше transition не програється
    requestAnimationFrame(() => root.classList.add('is-open'));
    cancelBtn.focus({ preventScroll: true });

    const unlockTimer = setTimeout(() => {
      okBtn.disabled = false;
      okBtn.classList.remove('is-locked');
    }, LOCK_MS);

    const reposition = () => positionDialog(root, anchorEl);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(unlockTimer);
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onOutsideClick);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), 220); // даємо дограти анімацію зникнення
      resolve(result);
    };

    function onClick(e) {
      const btn = e.target.closest('[data-confirm]');
      if (!btn || btn.disabled) return;
      finish(btn.dataset.confirm === 'yes');
    }
    function onKeydown(e) {
      if (e.key === 'Escape') finish(false);
    }
    // Клік поза вікном = «Скасувати»
    function onOutsideClick(e) {
      if (root.contains(e.target)) return;
      finish(false);
    }

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    // Слухач кліку-поза-вікном додаємо окремим макротаском, щоб клік, яким відкрили вікно, його не закрив
    setTimeout(() => {
      if (!settled) document.addEventListener('click', onOutsideClick);
    }, 0);
  });
}
