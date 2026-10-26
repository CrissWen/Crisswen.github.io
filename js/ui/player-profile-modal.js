import { supabase } from '../services/supabase.js';
import { fetchAvatars, getCachedAvatar, hasCachedAvatar, isAvatarStale } from '../services/avatar-service.js';
import { setAvatarEl, applyAvatarLetterPadding } from '../utils/avatar.js';
import { esc } from '../utils/security.js';

// ===== Картка профілю гравця (невелике спливне вікно біля аватарки) =====
// Відкривається кліком по аватарці будь-якого гравця під час гри (елементи з data-profile-user, див. utils/avatar.js).
// Це не модалка на весь екран: екран не затемнюється, картка з'являється поруч із натиснутою аватаркою.
// Зліва аватарка з іменем під нею, справа плитки статистики (як у «Профілі»). Закривається хрестиком, кліком повз картку,
// повторним кліком по тій самій аватарці або клавішею Escape. Кольори — лише змінні теми (css/components/player-profile.css).

const ROOT_ID = 'player-profile-root';
const CLOSE_ANIM_MS = 150;
const GAP = 8;   // відступ між аватаркою і карткою
const EDGE = 8;  // мінімальний відступ від країв екрана
const STATS_TTL_MS = 60 * 1000; // статистика одного гравця не перезапитується частіше ніж раз на хвилину

// userId -> { data: { created_at, games_played, games_won } | null, ts }
const statsCache = new Map();

let current = null; // { root, userId, opener, cleanup }
let requestToken = 0; // відсікає відповіді запитів, які прийшли вже після закриття/зміни гравця

function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function loadStats(userId) {
  const cached = statsCache.get(userId);
  if (cached && Date.now() - cached.ts < STATS_TTL_MS) return cached.data;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('created_at, games_played, games_won')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    statsCache.set(userId, { data: data || null, ts: Date.now() });
    return data || null;
  } catch (err) {
    console.warn('Не вдалося завантажити статистику гравця:', err);
    return null; // помилку не кешуємо: наступне відкриття спробує ще раз
  }
}

function fillStats(root, data) {
  const set = (key, text) => {
    const el = root.querySelector(`[data-pp-stat="${key}"]`);
    if (el) el.textContent = text;
  };
  if (!data) {
    ['games_played', 'games_won', 'win_rate', 'created_at'].forEach(k => set(k, '—'));
    return;
  }
  const played = Number(data.games_played) || 0;
  const won = Number(data.games_won) || 0;
  set('games_played', String(played));
  set('games_won', String(won));
  set('win_rate', `${played > 0 ? Math.round((won / played) * 100) : 0}%`);
  set('created_at', data.created_at ? formatDate(data.created_at) : '—');
}

function cardHtml(name) {
  return `
    <button type="button" class="pp-close" data-pp-close aria-label="Закрити">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <div class="pp-identity">
      <span class="pp-avatar" data-pp-avatar>?</span>
      <p class="pp-name" id="pp-name">${esc(name)}</p>
    </div>
    <div class="pp-stats">
      <div class="stat-tile" title="Зіграно ігор"><span class="stat-tile__label">Зіграно</span><span class="stat-tile__value" data-pp-stat="games_played">—</span></div>
      <div class="stat-tile" title="Кількість перемог"><span class="stat-tile__label">Перемог</span><span class="stat-tile__value" data-pp-stat="games_won">—</span></div>
      <div class="stat-tile" title="Відсоток перемог"><span class="stat-tile__label">% перемог</span><span class="stat-tile__value" data-pp-stat="win_rate">—</span></div>
      <div class="stat-tile" title="Дата реєстрації"><span class="stat-tile__label">Реєстрація</span><span class="stat-tile__value" data-pp-stat="created_at">—</span></div>
    </div>
  `;
}

// Картка стає під аватаркою (або над нею, якщо знизу немає місця) і завжди лишається в межах екрана
function positionCard(root, anchor) {
  const a = anchor.getBoundingClientRect();
  const w = root.offsetWidth;
  const h = root.offsetHeight;

  let left = a.left;
  let top = a.bottom + GAP;
  if (top + h > window.innerHeight - EDGE && a.top - GAP - h >= EDGE) {
    top = a.top - GAP - h;
  }

  left = Math.min(Math.max(left, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE));
  top = Math.min(Math.max(top, EDGE), Math.max(EDGE, window.innerHeight - h - EDGE));

  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

// Дошка перемальовується через innerHTML при кожному оновленні кімнати, тож елемент, по якому клікнули, міг замінитись новим.
// Тоді шукаємо аватарку того самого гравця, найближчу до попереднього місця картки.
function resolveAnchor(state) {
  if (state.opener && state.opener.isConnected) return state.opener;
  const candidates = [...document.querySelectorAll('[data-profile-user]')]
    .filter(el => el.dataset.profileUser === state.userId);
  if (!candidates.length) return null;
  const { left, top } = state.root.getBoundingClientRect();
  let best = null;
  let bestDist = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const dist = Math.abs(r.left - left) + Math.abs(r.bottom - top);
    if (dist < bestDist) { bestDist = dist; best = el; }
  }
  state.opener = best;
  return best;
}

export function isPlayerProfileOpen() {
  return !!current;
}

// Закриття. immediate=true — без анімації (вихід зі сторінки гри або відкриття іншої картки).
export function closePlayerProfile({ immediate = false, restoreFocus = true } = {}) {
  if (!current) return;
  const { root, opener, cleanup } = current;
  current = null;
  requestToken++;
  cleanup();

  if (immediate) {
    root.remove();
  } else {
    root.classList.remove('is-open');
    setTimeout(() => root.remove(), CLOSE_ANIM_MS);
  }

  // Фокус повертаємо туди, звідки відкрили (якщо елемент не зник через перемальовування дошки)
  if (restoreFocus && opener && opener.isConnected && typeof opener.focus === 'function') {
    try { opener.focus({ preventScroll: true }); } catch (e) { /* не критично */ }
  }
}

// openPlayerProfile({ userId, name, opener }) — opener: аватарка, по якій клікнули (біля неї стає картка)
export function openPlayerProfile({ userId, name, opener = null }) {
  if (!userId || !opener) return;

  // Повторний клік по тій самій аватарці закриває картку
  if (current && current.opener === opener) {
    closePlayerProfile();
    return;
  }
  // Клік по іншій аватарці: стару картку прибираємо миттєво
  if (current) closePlayerProfile({ immediate: true, restoreFocus: false });
  document.getElementById(ROOT_ID)?.remove();

  const cleanName = String(name ?? '').trim() || 'Гравець';
  const letter = cleanName.charAt(0);

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'pp-card';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'pp-name');
  root.tabIndex = -1;
  root.innerHTML = cardHtml(cleanName);
  document.body.appendChild(root);

  const avatarEl = root.querySelector('[data-pp-avatar]');
  const paintAvatar = (url) => {
    setAvatarEl(avatarEl, letter, url);
    applyAvatarLetterPadding(avatarEl, letter, 6);
  };
  paintAvatar(getCachedAvatar(userId));
  if (!hasCachedAvatar(userId) || isAvatarStale(userId)) {
    fetchAvatars([userId]).then(() => {
      if (current && current.root === root) paintAvatar(getCachedAvatar(userId));
    });
  }

  const state = { root, userId, opener, cleanup: () => {} };

  const reposition = () => {
    const anchor = resolveAnchor(state);
    if (anchor) positionCard(root, anchor);
  };

  const onKeydown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closePlayerProfile();
  };

  // Клік повз картку закриває її. Клік по будь-якій аватарці обробляє диспетчер у game.js (відкриє іншу картку або закриє цю),
  // тож тут його пропускаємо — інакше щойно відкрита картка одразу б закрилась.
  const onOutsideClick = (e) => {
    if (root.contains(e.target)) return;
    if (e.target.closest?.('[data-profile-user]')) return;
    closePlayerProfile({ restoreFocus: false });
  };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-pp-close]')) closePlayerProfile();
  });
  document.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true); // true — ловить і прокрутку таблиці всередині .table-scroll

  // Слухач «клік повз» вішаємо окремим макротаском: клік, яким відкрили картку, ще не долетів до document
  const outsideTimer = setTimeout(() => document.addEventListener('click', onOutsideClick), 0);

  state.cleanup = () => {
    clearTimeout(outsideTimer);
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  };
  current = state;

  positionCard(root, opener);
  // rAF: щоб браузер застосував початковий стан до додавання .is-open — тоді спрацює CSS-анімація появи
  requestAnimationFrame(() => root.classList.add('is-open'));
  // Фокус — на картку, а не на хрестик: якщо картку відкрили Пробілом, keyup у тієї ж клавіші натиснув би хрестик і одразу закрив її
  root.focus({ preventScroll: true });

  const token = ++requestToken;
  loadStats(userId).then((data) => {
    if (token !== requestToken || !current || current.root !== root) return;
    fillStats(root, data);
    positionCard(root, resolveAnchor(current) || opener); // розмір міг трохи змінитись
  });
}
