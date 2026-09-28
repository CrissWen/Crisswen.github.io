// Модальне вікно ручного вибору предметів бункера.
// Викликається з панелі ведучого: "Змінити параметр бункера" -> параметр "items" -> "Змінити".
// На відміну від confirm-dialog.js (просте так/ні), тут форма: по одному <select> на кожен поточний
// предмет ("слот"), заповнений усім пулом можливих предметів, + кнопки "Зберегти"/"Скасувати".
//
// showItemsPickerModal(currentItems, pool) -> Promise<string[] | null>
//   currentItems — поточні предмети бункера (визначає кількість select-слотів і їхні початкові значення)
//   pool         — усі можливі назви предметів з pools.bunker.items (варіанти в кожному select)
//   Повертає масив обраних значень при "Зберегти", або null при "Скасувати" / кліку по фону / Escape.

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function slotHtml(index, pool, selectedValue) {
  const options = pool.map(value =>
    `<option value="${esc(value)}"${value === selectedValue ? ' selected' : ''}>${esc(value)}</option>`
  ).join('');
  return `
    <label class="items-picker__slot">
      <span>Слот ${index + 1}</span>
      <select class="hp-select item-select-dropdown" data-slot="${index}">${options}</select>
    </label>
  `;
}

export function showItemsPickerModal(currentItems, pool) {
  return new Promise(resolve => {
    // Захист від порожнього пула/набору, щоб завжди був хоча б один слот і хоч один варіант у ньому
    const uniquePool = pool && pool.length ? pool : ['Немає доступних предметів'];
    const slots = currentItems && currentItems.length ? currentItems : [uniquePool[0]];

    const root = document.createElement('div');
    root.className = 'items-picker-modal';
    root.id = 'items-picker-modal';
    root.innerHTML = `
      <div class="items-picker-modal__card" role="dialog" aria-modal="true" aria-label="Зміна предметів бункера">
        <h3 class="items-picker-modal__title">Предмети бункера</h3>
        <div class="items-picker-modal__slots">
          ${slots.map((value, i) => slotHtml(i, uniquePool, value)).join('')}
        </div>
        <div class="items-picker-modal__actions">
          <button type="button" class="items-picker-modal__btn items-picker-modal__btn--cancel" data-picker="cancel">Скасувати</button>
          <button type="button" class="items-picker-modal__btn items-picker-modal__btn--save" data-picker="save">Зберегти</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
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
      // Клік по темному фону (сам root, а не картка всередині) — те саме, що "Скасувати"
      if (e.target === root) { finish(null); return; }

      const btn = e.target.closest('[data-picker]');
      if (!btn) return;

      if (btn.dataset.picker === 'cancel') { finish(null); return; }

      // "Зберегти" — зібрати значення всіх select-слотів у масив
      const values = Array.from(root.querySelectorAll('.item-select-dropdown')).map(sel => sel.value);
      finish(values);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') finish(null);
    }

    root.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeydown);
  });
}
