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
        <button type="button" class="confirm-dialog__btn confirm-dialog__btn--no" data-confirm="no">Ні</button>
        <button type="button" class="confirm-dialog__btn confirm-dialog__btn--yes" data-confirm="yes">Так</button>
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
// resolve(true) при натисканні "Так", resolve(false) при "Ні" або Escape.
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
      document.removeEventListener('click', onOutsideClick);
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

    // Клік будь-де поза самим віконцем = та сама дія, що й кнопка "Ні" (тут немає окремого
    // затемненого "фону-оверлея" на весь екран — вікно компактне й прив'язане до кнопки,
    // тож "поза межами" перевіряємо через root.contains, а не порівнянням з overlay-елементом).
    function onOutsideClick(e) {
      if (root.contains(e.target)) return;
      finish(false);
    }

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);

    // Реєструємо клік-поза-вікном окремим макротаском: клік, яким саме відкрили це вікно
    // (наприклад, кнопка дії в панелі ведучого), у цей момент ще НЕ долетів по бульбашці до document —
    // якщо додати слухач синхронно, він спрацює на той самий клік і миттєво закриє щойно відкрите вікно.
    setTimeout(() => {
      if (!settled) document.addEventListener('click', onOutsideClick);
    }, 0);
  });
}
