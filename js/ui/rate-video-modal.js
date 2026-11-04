// Модалка з відео для пункту футера «Оцінити проєкт».
// Відкривається кліком (js/ui/site-footer.js), одразу запускає відео з YouTube і при закритті знищує iframe, тож звук зупиняється.
// Автозапуск зі звуком браузери дозволяють саме тому, що iframe створюється всередині кліку користувача.
// Відео і запасне посилання: RATE_VIDEO у js/config/footer-config.js. Стилі: кінець css/footer.css (лише змінні теми).

import { RATE_VIDEO } from '../config/footer-config.js';

const ROOT_ID = 'rate-video-root';
const CLOSE_ANIM_MS = 160;

let current = null; // { root, opener, onKey }

function buildEmbedUrl(videoId) {
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', modestbranding: '1' });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

export function closeRateVideo() {
  if (!current) return;
  const { root, opener, onKey } = current;
  current = null;
  document.removeEventListener('keydown', onKey, true);
  root.classList.remove('is-open');

  // iframe прибираємо одразу, щоб відео не грало, поки програється анімація закриття
  root.querySelector('iframe')?.remove();
  setTimeout(() => root.remove(), CLOSE_ANIM_MS);
  document.body.classList.remove('has-rate-video');
  if (opener && opener.isConnected) opener.focus({ preventScroll: true });
}

export function openRateVideo(opener = null) {
  if (current) return;
  const { videoId, watchUrl } = RATE_VIDEO;
  if (!videoId) {
    if (watchUrl) window.open(watchUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'rate-video';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Відео');

  const box = document.createElement('div');
  box.className = 'rate-video__box';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'rate-video__close';
  close.setAttribute('aria-label', 'Закрити');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', closeRateVideo);

  const frameWrap = document.createElement('div');
  frameWrap.className = 'rate-video__frame';
  const iframe = document.createElement('iframe');
  iframe.src = buildEmbedUrl(videoId);
  iframe.title = 'Відео';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frameWrap.appendChild(iframe);

  box.append(close, frameWrap);

  if (watchUrl) {
    const fallback = document.createElement('a');
    fallback.className = 'rate-video__fallback';
    fallback.href = watchUrl;
    fallback.target = '_blank';
    fallback.rel = 'noopener noreferrer';
    fallback.textContent = 'Не відтворюється? Відкрити на YouTube';
    box.appendChild(fallback);
  }

  root.appendChild(box);

  // Клік повз вікно закриває
  root.addEventListener('mousedown', e => { if (e.target === root) closeRateVideo(); });

  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeRateVideo(); }
  };
  document.addEventListener('keydown', onKey, true);

  document.body.appendChild(root);
  document.body.classList.add('has-rate-video');
  requestAnimationFrame(() => root.classList.add('is-open'));
  close.focus({ preventScroll: true });

  current = { root, opener, onKey };
}
