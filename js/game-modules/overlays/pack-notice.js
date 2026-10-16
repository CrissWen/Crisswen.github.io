// Інформаційне вікно редактора паків: після збереження показує категорії, де власних карток менше, ніж потрібно для гри,
// і пояснює, що решту гра добере з базового пака. На відміну від pack-confirm.js, це модальне вікно на весь екран
// із затемненим фоном: воно не блокує збереження, а лише інформує.
// Закривається кнопкою «Закрити», Escape або кліком по фону. Чекбокс «Більше не показувати» зберігається в localStorage.

const NOTICE_ID = 'pack-notice-root';
const MUTE_KEY = 'pack_notice_muted';
const CLOSE_MS = 220;

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function isPackNoticeMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function setPackNoticeMuted(muted) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // сховище недоступне (приватний режим) — підказка просто показуватиметься знову
  }
}

function noticeHtml(short) {
  const rows = short.map(s => `
        <li class="pk-notice__item">
          <span class="pk-notice__name">${esc(s.label)}</span>
          <span class="pk-notice__count"><b>${s.have}</b> з ${s.need}</span>
        </li>`).join('');

  return `
    <div id="${NOTICE_ID}" class="pk-notice" role="dialog" aria-modal="true" aria-labelledby="${NOTICE_ID}-title">
      <div class="pk-notice__card">
        <h2 class="pk-notice__title" id="${NOTICE_ID}-title">Пак збережено</h2>
        <p class="pk-notice__text">
          У цих категоріях менше характеристик, ніж потрібно для повної гри. Якщо знадобиться,
          гра добере решту з базового пака: ваші власні картки завжди йдуть першими.
        </p>
        <ul class="pk-notice__list">${rows}
        </ul>
        <div class="pk-notice__foot">
          <label class="pe-check">
            <input type="checkbox" class="pe-check__input" data-notice-mute>
            <span class="pe-check__box" aria-hidden="true"></span>
            <span>Більше не показувати</span>
          </label>
          <button type="button" class="pk-btn pk-btn--primary" data-notice-close>Закрити</button>
        </div>
      </div>
    </div>
  `;
}

// showPackNotice(short) -> { closed: Promise<void>, close(): void }
// short — результат findShortCategories. closed вирішується, коли вікно закрите (будь-яким способом).
export function showPackNotice(short) {
  document.getElementById(NOTICE_ID)?.remove();
  document.body.insertAdjacentHTML('beforeend', noticeHtml(short));
  const root = document.getElementById(NOTICE_ID);
  const muteBox = root.querySelector('[data-notice-mute]');
  const closeBtn = root.querySelector('[data-notice-close]');

  let settled = false;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });

  // rAF, щоб браузер застосував початковий (прихований) стан до додавання .is-open — інакше анімації не буде
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    closeBtn.focus();
  });

  function close() {
    if (settled) return;
    settled = true;
    setPackNoticeMuted(muteBox.checked);
    document.removeEventListener('keydown', onKeydown);
    root.removeEventListener('click', onClick);
    root.classList.remove('is-open');
    setTimeout(() => root.remove(), CLOSE_MS);
    resolveClosed();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  function onClick(e) {
    // клік по затемненому фону (поза карткою) або по «Закрити»
    if (e.target === root || e.target.closest('[data-notice-close]')) close();
  }

  document.addEventListener('keydown', onKeydown);
  root.addEventListener('click', onClick);

  return { closed, close };
}
