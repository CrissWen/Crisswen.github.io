// ===== Модалка «Час сплив» (відлік катаклізму дійшов до нуля) =====
// Самодостатній DOM-оверлей: гру не блокує. Стан модуля (флаги нижче) живе лише в пам'яті вкладки.

let hasSeenCataclysmEnd = false; // щоб модалка не вискакувала повторно
let trackedCataclysmTimerEnd = null; // останнє відоме cataclysm_timer_end (для скидання флага при НОВОМУ катаклізмі)

// Скидає флаг модалки, коли ведучий ставить новий катаклізм (інше значення cataclysm_timer_end) —
// щоб модалка могла показатись знову для наступного відліку. Викликається з game.js на кожне оновлення кімнати.
export function trackCataclysmEnd(end) {
  const value = end ?? null;
  if (value !== trackedCataclysmTimerEnd) {
    trackedCataclysmTimerEnd = value;
    hasSeenCataclysmEnd = false;
  }
}

// Захист від спаму: відлік досягає нуля рівно один раз (цей колбек викликає модуль
// cataclysm-timer.js рівно один раз на кожне окреме end), але додатково перевіряємо флаг
// так, як це описано в ТЗ (без нього модалка вискочила б при кожному рендері сторінки).
export function onCataclysmTimerExpired() {
  if (hasSeenCataclysmEnd) return;
  hasSeenCataclysmEnd = true;
  showCataclysmEndModal();
}

export function showCataclysmEndModal() {
  if (document.getElementById('cataclysm-end-modal')) return; // вже показана — другої не створюємо
  document.body.insertAdjacentHTML('beforeend', `
    <div id="cataclysm-end-modal" class="cataclysm-end-modal" role="alertdialog" aria-modal="true">
      <div class="cataclysm-end-modal__card">
        <div class="cataclysm-end-modal__icon" aria-hidden="true">☠</div>
        <p class="cataclysm-end-modal__text">Час сплив. Ви не потрапили у бункер :(</p>
        <button type="button" class="cataclysm-end-modal__btn" data-cata-modal-close>Закрити</button>
      </div>
    </div>
  `);

  const root = document.getElementById('cataclysm-end-modal');
  requestAnimationFrame(() => root.classList.add('is-open'));

  const close = () => {
    root.classList.remove('is-open');
    setTimeout(() => root.remove(), 200);
    root.removeEventListener('click', onRootClick);
    document.removeEventListener('keydown', onKeydown);
  };
  function onRootClick(e) {
    // Закрити кнопкою або кліком по підкладці за межами картки — гра при цьому не блокується, це лише DOM-оверлей
    if (e.target === root || e.target.closest('[data-cata-modal-close]')) close();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  root.addEventListener('click', onRootClick);
  document.addEventListener('keydown', onKeydown);
}
