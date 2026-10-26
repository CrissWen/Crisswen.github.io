import { esc } from './security.js';
import { getCachedAvatar, hasCachedAvatar, fetchAvatars } from '../services/avatar-service.js';

// ===== Відображення аватарок =====
// Літера імені завжди лежить під картинкою як запасний варіант: поки фото вантажиться або якщо воно не завантажилось,
// гравець бачить звичну літеру. Контейнер має бути position: relative (див. css/components/avatar.css).

const brokenUrls = new Set(); // адреси, які браузер не зміг завантажити — повторно не підставляємо

// Одна пара обробників на весь сайт: картинка, що не завантажилась, просто зникає і лишається літера
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('avatar-img')) {
    brokenUrls.add(img.getAttribute('src'));
    img.remove();
  }
}, true);

function usableUrl(url) {
  return url && !brokenUrls.has(url) ? url : null;
}

// <img> для вставки в рядок-шаблон (після літери всередині контейнера). Порожній рядок, якщо аватарки немає.
export function avatarImgHtml(userId) {
  const url = usableUrl(getCachedAvatar(userId));
  if (!url) return '';
  return `<img class="avatar-img" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`;
}

// Готовий круглий бейдж (літера + фото) заданого розміру — для списків, де окремого контейнера аватарки ще немає
export function avatarBadgeHtml(userId, name, size = 28) {
  const letter = String(name ?? '').charAt(0);
  const fontSize = Math.max(10, Math.round(size * 0.46));
  return `<span class="avatar-badge" style="--avatar-size:${size}px;font-size:${fontSize}px;">${esc(letter)}${avatarImgHtml(userId)}</span>`;
}

// Заповнює готовий DOM-елемент (хедер, профіль): літера + за наявності фото
export function setAvatarEl(el, letter, url) {
  if (!el) return;
  el.textContent = letter;
  const safe = usableUrl(url);
  if (!safe) return;

  const img = document.createElement('img');
  img.className = 'avatar-img';
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.draggable = false;
  img.src = safe;
  el.appendChild(img);
}

// Малює аватарку поточного гравця: одразу з кешу, а якщо його ще немає — після одного запиту до БД
export function showUserAvatar(el, userId, letter) {
  if (!el || !userId) return;
  const paint = () => setAvatarEl(el, letter, getCachedAvatar(userId));
  if (hasCachedAvatar(userId)) {
    paint();
    return;
  }
  fetchAvatars([userId]).then(paint);
}

// Літери з нижнім виносним елементом («хвостиком»), для яких потрібен оптичний зсув у крузі
const DESCENDER_REGEX = /^[gjpqyуфщц]/i;

export function hasLetterDescender(text) {
  const char = String(text ?? '').trim().charAt(0);
  return DESCENDER_REGEX.test(char);
}

export function applyAvatarLetterPadding(el, text, paddingPx = 3) {
  if (!el) return;
  el.style.paddingBottom = hasLetterDescender(text) ? `${paddingPx}px` : '0';
}

export function getAvatarPaddingStyle(text, paddingPx = 2) {
  return hasLetterDescender(text) ? `padding-bottom: ${paddingPx}px;` : 'padding-bottom: 0;';
}
