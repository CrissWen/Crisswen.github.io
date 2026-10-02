import { esc } from '../utils/escape-html.js';
import { listPacks, deletePack } from '../services/packs-store.js';
import { showPackConfirm } from '../game-modules/overlays/pack-confirm.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';

// ===== Сторінка "Паки" (#/packs): сітка карток паків =====
// Дефолтний пак є в списку завжди, але без кнопок "Редагувати" / "Видалити" — лише перегляд.
// Особисті паки: "Редагувати" внизу картки, "Видалити пак" у меню з трьох крапок у куті.

const DELETE_CONFIRM_TEXT = 'Чи точно хочете видалити цей пак? Цю дію неможливо скасувати.';

let isDeleting = false; // щоб повторний клік під час підтвердження/видалення не запустив другу операцію

function packTitle(pack) {
  // У БД дефолтний пак має службову назву "default" (за нею його шукає гра) — користувачу показуємо людську
  return pack.isDefault ? 'Дефолтний пак' : pack.title;
}

function cardHtml(pack) {
  const description = pack.description?.trim()
    ? esc(pack.description)
    : '<span class="pack-card__desc-empty">Без опису</span>';

  // Кнопки керування рендеряться лише для автора (pack.isOwn); для дефолтного та будь-якого чужого пака їх у верстці немає
  const corner = pack.isOwn
    ? `
      <div class="pack-card__menu">
        <button type="button" class="pack-card__kebab" data-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Дії з паком">⋮</button>
        <div class="pack-card__dropdown" role="menu" hidden>
          <button type="button" class="pack-card__dropdown-item" role="menuitem" data-delete-pack="${esc(pack.id)}">Видалити пак</button>
        </div>
      </div>`
    : (pack.isDefault ? '<span class="pack-card__badge">Базовий</span>' : '');

  const footer = pack.isOwn
    ? `<a class="pk-btn pk-btn--primary pack-card__edit" href="#/pack-editor?id=${encodeURIComponent(pack.id)}">Редагувати</a>`
    : '<span class="pack-card__readonly">Лише перегляд</span>';

  return `
    <article class="pack-card${pack.isDefault ? ' pack-card--default' : ''}" data-pack-id="${esc(pack.id)}">
      <header class="pack-card__head">
        <h3 class="pack-card__title">${esc(packTitle(pack))}</h3>
        ${corner}
      </header>
      <p class="pack-card__author">Автор: <span>${esc(pack.authorName || 'Невідомо')}</span></p>
      <div class="pack-card__desc" tabindex="0">${description}</div>
      <footer class="pack-card__foot">${footer}</footer>
    </article>
  `;
}

function gridHtml(packs) {
  const hasPersonal = packs.some(p => p.isOwn);
  return `
    <div class="packs-grid">${packs.map(cardHtml).join('')}</div>
    ${hasPersonal ? '' : '<p class="packs-empty">У вас ще немає особистих паків. Натисніть "+ Створити пак", щоб додати перший.</p>'}
  `;
}

export function renderPacks() {
  return `
    <section class="packs-page layout-large-centered">
      <div class="packs-toolbar">
        <h2 class="packs-title">Паки</h2>
        <a class="pk-btn pk-btn--primary" href="#/pack-editor">+ Створити пак</a>
      </div>
      <div id="packs-root" class="packs-root">
        <p class="packs-empty">Завантаження паків...</p>
      </div>
    </section>
  `;
}

function closeMenus() {
  document.querySelectorAll('.pack-card__dropdown:not([hidden])').forEach(menu => {
    menu.hidden = true;
    menu.parentElement.querySelector('[data-menu-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

async function reload() {
  const root = document.getElementById('packs-root');
  if (!root) return;
  try {
    root.innerHTML = gridHtml(await listPacks());
  } catch (err) {
    console.error('Не вдалося завантажити паки:', err);
    root.innerHTML = '<p class="packs-empty">Не вдалося завантажити паки</p>';
  }
}

async function handleDelete(btn) {
  if (isDeleting) return;

  const card = btn.closest('.pack-card');
  const anchor = card?.querySelector('[data-menu-toggle]') || btn;
  const packId = btn.dataset.deletePack;
  closeMenus();

  isDeleting = true;
  try {
    const confirmed = await showPackConfirm(DELETE_CONFIRM_TEXT, anchor, { confirmLabel: 'Видалити' });
    if (!confirmed) return;

    await deletePack(packId);
    showGlobalToast('Пак видалено');
    await reload();
  } catch (err) {
    console.error('Не вдалося видалити пак:', err);
    showGlobalToast(err.message || 'Не вдалося видалити пак');
  } finally {
    isDeleting = false;
  }
}

function handleClick(e) {
  const toggle = e.target.closest('[data-menu-toggle]');
  if (toggle) {
    const menu = toggle.parentElement.querySelector('.pack-card__dropdown');
    const wasHidden = menu.hidden;
    closeMenus(); // відкрите меню завжди одне
    menu.hidden = !wasHidden;
    toggle.setAttribute('aria-expanded', String(wasHidden));
    return;
  }

  const delBtn = e.target.closest('[data-delete-pack]');
  if (delBtn) {
    handleDelete(delBtn);
    return;
  }

  if (!e.target.closest('.pack-card__menu')) closeMenus();
}

function handleKeydown(e) {
  if (e.key === 'Escape') closeMenus();
}

export async function initPacks() {
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  await reload();
}

export function cleanupPacks() {
  document.removeEventListener('click', handleClick);
  document.removeEventListener('keydown', handleKeydown);
  isDeleting = false;
}
