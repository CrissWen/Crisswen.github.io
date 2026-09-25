// Кастомне вікно підтвердження дії — заміна стандартного window.confirm().
// З'являється безпосередньо біля натиснутої кнопки (ліворуч від неї, по вертикалі по центру кнопки),
// а не в фіксованому кутку екрана і не як системний alert згори.

const CONFIRM_ID = 'custom-confirm-root';
const GAP = 12;       // відступ між кнопкою і вікном
const EDGE = 8;        // мінімальний відступ від країв екрана

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function dialogHtml(message) {
  return `
    <div id="${CONFIRM_ID}" class="confirm-dialog" role="alertdialog" aria-modal="true">
      <p class="confirm-dialog__text">${esc(message)}</p>
      <div class="confirm-dialog__row">
        <button type="button" class="confirm-dialog__btn confirm-dialog__btn--no" data-confirm="no">Нет</button>
        <button type="button" class="confirm-dialog__btn confirm-dialog__btn--yes" data-confirm="yes">Да</button>
      </div>
    </div>
  `;
}

// Вікно з'являється ЛІВОРУЧ від кнопки (панель ведучого — справа) і не повинно її перекривати.
// Якщо ліворуч бракує місця (вузький екран) — фолбек праворуч; координати завжди клемпляться в межі viewport.
function positionDialog(root, anchorEl) {
  const anchor = anchorEl.getBoundingClientRect();
  const dialog = root.getBoundingClientRect();

  let left = anchor.left - dialog.width - GAP;
  if (left < EDGE) {
    const rightLeft = anchor.right + GAP;
    if (rightLeft + dialog.width <= window.innerWidth - EDGE) left = rightLeft;
  }

  let top = anchor.top + anchor.height / 2 - dialog.height / 2;

  const maxLeft = Math.max(EDGE, window.innerWidth - dialog.width - EDGE);
  const maxTop = Math.max(EDGE, window.innerHeight - dialog.height - EDGE);
  left = Math.min(Math.max(left, EDGE), maxLeft);
  top = Math.min(Math.max(top, EDGE), maxTop);

  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

// showCustomConfirm(messageText, anchorEl) -> Promise<boolean>
// anchorEl — кнопка, біля якої показати вікно (обов'язковий параметр).
// resolve(true) при натисканні "Да", resolve(false) при "Нет" або Escape.
export function showCustomConfirm(messageText, anchorEl) {
  return new Promise(resolve => {
    // Якщо десь лишилось попереднє вікно (наприклад, дуже швидкий подвійний клік) — прибираємо його без результату
    document.getElementById(CONFIRM_ID)?.remove();

    document.body.insertAdjacentHTML('beforeend', dialogHtml(messageText));
    const root = document.getElementById(CONFIRM_ID);

    positionDialog(root, anchorEl);

    // rAF, щоб браузер встиг застосувати початкову (закриту) позицію ДО додавання .is-open —
    // інакше CSS-transition не програється і вікно з'являється миттєво, без анімації
    requestAnimationFrame(() => root.classList.add('is-open'));

    // Скрол/зміна розміру вікна поки діалог відкритий — перерахувати позицію відносно кнопки
    const reposition = () => positionDialog(root, anchorEl);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      root.classList.remove('is-open');
      // Даємо дограти анімацію зникнення, перш ніж прибрати елемент з DOM
      setTimeout(() => root.remove(), 220);
      resolve(result);
    };

    function onClick(e) {
      const btn = e.target.closest('[data-confirm]');
      if (!btn) return;
      finish(btn.dataset.confirm === 'yes');
    }
    function onKeydown(e) {
      if (e.key === 'Escape') finish(false);
    }

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
  });
}
