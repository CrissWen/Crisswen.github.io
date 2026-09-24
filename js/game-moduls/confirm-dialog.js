// Кастомне вікно підтвердження дії — заміна стандартного window.confirm().
// З'являється біля кнопки панелі ведучого (лівий нижній кут), а не як системний alert згори екрана.

const CONFIRM_ID = 'custom-confirm-root';

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

// showCustomConfirm(messageText) -> Promise<boolean>
// resolve(true) при натисканні "Да", resolve(false) при "Нет" або Escape.
export function showCustomConfirm(messageText) {
  return new Promise(resolve => {
    // Якщо десь лишилось попереднє вікно (наприклад, дуже швидкий подвійний клік) — прибираємо його без результату
    document.getElementById(CONFIRM_ID)?.remove();

    document.body.insertAdjacentHTML('beforeend', dialogHtml(messageText));
    const root = document.getElementById(CONFIRM_ID);

    // rAF, щоб браузер встиг застосувати початковий (закритий) стан ДО додавання .is-open —
    // інакше CSS-transition не програється і вікно з'являється миттєво, без анімації
    requestAnimationFrame(() => root.classList.add('is-open'));

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      root.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeydown);
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
