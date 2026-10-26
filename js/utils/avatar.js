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
  const letter = String(name ?? '').charAt(0);
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
