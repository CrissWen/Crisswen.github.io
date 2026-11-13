// Модалка з фото: відкривається кліком по картці автора (js/pages/info.js → initInfoPage).
// Вигляд і поведінка як у модалки «Оцінити проєкт» (js/ui/rate-video-modal.js): ті самі класи оболонки, закриття на ✕, Esc і клік повз вікно.
// Стилі: кінець css/footer.css (лише змінні теми). Фото — власний файл сайту (відносний шлях), зовнішні адреси не приймаємо.

const ROOT_ID = 'photo-modal-root';
const CLOSE_ANIM_MS = 160;

let current = null; // { root, opener, onKey, onHash }

// Дозволено лише відносний шлях до зображення всередині сайту: без протоколу, без «..», з відомим розширенням.
export function isSafePhotoPath(src) {
  return typeof src === 'string'
    && /^[a-z0-9_\-./]+\.(jpe?g|png|webp|gif|avif)$/i.test(src)
    && !src.startsWith('/')
    && !src.split('/').includes('..');
}

export function closePhotoModal() {
  if (!current) return;
  const { root, opener, onKey, onHash } = current;
  current = null;
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('hashchange', onHash);
  root.classList.remove('is-open');
  setTimeout(() => root.remove(), CLOSE_ANIM_MS);
  document.body.classList.remove('has-rate-video');
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function openPhotoModal({ src, alt = '', caption = '' } = {}, opener = null) {
  if (current || !isSafePhotoPath(src)) return;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'rate-video photo-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', caption || alt || 'Фото');

  const box = document.createElement('div');
  box.className = 'rate-video__box photo-modal__box';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rate-video__close';
  close.setAttribute('aria-label', 'Закрити');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', closePhotoModal);

  const img = document.createElement('img');
  img.className = 'photo-modal__img';
  img.alt = alt;
  img.decoding = 'async';
  img.addEventListener('error', () => {
    // Файл не лежить на сайті (або не завантажився): замість порожнього вікна — зрозуміле повідомлення
    const msg = document.createElement('p');
    msg.className = 'photo-modal__missing';
    msg.textContent = 'Фото не вдалося завантажити.';
    img.replaceWith(msg);
  });
  img.src = src;

  box.append(close, img);

  if (caption) {
    const cap = document.createElement('p');
    cap.className = 'photo-modal__caption';
    cap.textContent = caption;
    box.appendChild(cap);
  }

  root.appendChild(box);
  root.addEventListener('mousedown', e => { if (e.target === root) closePhotoModal(); });

  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); closePhotoModal(); }
  };
  const onHash = () => closePhotoModal(); // перехід на іншу сторінку закриває вікно
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', onHash);

  document.body.appendChild(root);
  document.body.classList.add('has-rate-video'); // той самий блок прокрутки фону, що й у відео
  requestAnimationFrame(() => root.classList.add('is-open'));
  close.focus({ preventScroll: true });

  current = { root, opener, onKey, onHash };
}
