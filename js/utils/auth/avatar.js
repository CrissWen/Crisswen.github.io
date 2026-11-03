import { esc } from './security.js';
import { firstChar } from './initial.js';
import { getCachedAvatar, hasCachedAvatar, fetchAvatars } from '../../services/avatar-service.js';

// ===== Відображення аватарок =====
// Літера імені завжди лежить під картинкою як запасний варіант: поки фото вантажиться або якщо воно не завантажилось,
// гравець бачить звичну літеру. Контейнер має бути position: relative (див. css/components/avatar.css).

// Адреси, які браузер не зміг завантажити, блокуємо лише тимчасово: збій мережі не має ховати аватарку до F5.
// Блок знімається через BROKEN_URL_TTL_MS або одразу, коли мережа повернулась (подія online).
const BROKEN_URL_TTL_MS = 60 * 1000;
const brokenUrls = new Map(); // url -> час останньої помилки (мс)

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => brokenUrls.clear());
}

// Одна пара обробників на весь сайт: картинка, що не завантажилась, просто зникає і лишається літера.
// Ігноруємо помилки, якщо елемент уже від'єднано від DOM (!img.isConnected):
// це аборт завантаження через ререндер контейнера (наприклад, innerHTML), а не битий URL!
export function handleImgError(target) {
  const img = target;
  if (!img) return false;
  const isImg = (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) || img.tagName === 'IMG' || img.tag === 'img';
  if (isImg && img.classList?.contains('avatar-img')) {
    if (img.isConnected === false) return false;
    const src = img.getAttribute('src') || img.src;
    if (src) brokenUrls.set(src, Date.now());
    img.remove();
    return true;
  }
  return false;
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('error', (e) => {
    handleImgError(e.target);
  }, true);
}

export function clearBrokenAvatarUrl(url) {
  if (url) brokenUrls.delete(url);
}

export function isAvatarUrlBroken(url) {
  if (!url) return false;
  const failedAt = brokenUrls.get(url);
  if (failedAt === undefined) return false;
  if (Date.now() - failedAt >= BROKEN_URL_TTL_MS) {
    brokenUrls.delete(url); // TTL минув — пробуємо ще раз
    return false;
  }
  return true;
}

function usableUrl(url) {
  if (!url) return null;
  if (isAvatarUrlBroken(url)) return null;
  return url;
}

// <img> для вставки в рядок-шаблон (після літери всередині контейнера). Порожній рядок, якщо аватарки немає.
export function avatarImgHtml(userId) {
  const url = usableUrl(getCachedAvatar(userId));
  if (!url) return '';
  return `<img class="avatar-img" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`;
}

// Атрибути, за якими аватарка відкриває коротке вікно профілю гравця (js/ui/player-profile-modal.js, диспетчер кліків у pages/game.js).
// Порожній рядок, якщо id невідомий. focusable=true додає role="button" і tabindex — для аватарок поза кнопками (усередині <button> не потрібно).
export function profileTriggerAttrs(userId, name, { focusable = false } = {}) {
  if (!userId) return '';
  const base = `data-profile-user="${esc(userId)}" data-profile-name="${esc(name ?? '')}"`;
  return focusable ? `${base} role="button" tabindex="0" aria-label="Профіль гравця ${esc(name ?? '')}"` : base;
}

// Готовий круглий бейдж (літера + фото) заданого розміру — для списків, де окремого контейнера аватарки ще немає.
// clickable=true — бейдж відкриває вікно профілю гравця.
export function avatarBadgeHtml(userId, name, size = 28, { clickable = false } = {}) {
  const letter = firstChar(name);
  const fontSize = Math.max(10, Math.round(size * 0.46));
  const trigger = clickable ? ` ${profileTriggerAttrs(userId, name, { focusable: true })}` : '';
  return `<span class="avatar-badge" style="--avatar-size:${size}px;font-size:${fontSize}px;"${trigger}>${esc(letter)}${avatarImgHtml(userId)}</span>`;
}

// Заповнює готовий DOM-елемент (хедер, профіль): літера + за наявності фото
export function setAvatarEl(el, letter, url) {
  if (!el) return;
  const safe = usableUrl(url);
  const currentImg = el.querySelector('img.avatar-img');

  if (safe) {
    // Якщо картинка вже намальована з цим самим URL — нічого не перемальовуємо, щоб уникнути блимання
    if (currentImg && (currentImg.src === safe || currentImg.getAttribute('src') === safe)) {
      return;
    }
    // Якщо картинка є, але змінився URL — оновлюємо src напряму
    if (currentImg) {
      currentImg.src = safe;
      return;
    }
    // Перше малювання: літера підкладки + додавання img
    el.textContent = letter;
    const img = document.createElement('img');
    img.className = 'avatar-img';
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.draggable = false;
    img.src = safe;
    el.appendChild(img);
  } else {
    // Фото немає або видалено — залишаємо лише літеру
    if (!currentImg && el.textContent === letter) return;
    el.textContent = letter;
  }
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
  const char = firstChar(String(text ?? '').trim());
  return DESCENDER_REGEX.test(char);
}

export function applyAvatarLetterPadding(el, text, paddingPx = 3) {
  if (!el) return;
  el.style.paddingBottom = hasLetterDescender(text) ? `${paddingPx}px` : '0';
}

export function getAvatarPaddingStyle(text, paddingPx = 2) {
  return hasLetterDescender(text) ? `padding-bottom: ${paddingPx}px;` : 'padding-bottom: 0;';
}
