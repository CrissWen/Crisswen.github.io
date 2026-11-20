import { esc } from '../../utils/common/escape-html.js';
import { oneLine } from '../parser.js';
import { normalizeSearch } from '../search.js';
import { $ } from './shared.js';

// ----- Пошук: рендер -----
// Екранований HTML з підсвіченими збігами (<mark>). Якщо нормалізація змінила довжину рядка, позиції б зсунулись — тоді без підсвітки.
export function highlightHtml(text, tokens) {
  const src = String(text ?? '');
  if (!tokens || !tokens.length) return esc(src);
  const normalized = normalizeSearch(src);
  if (normalized.length !== src.length) return esc(src);

  const ranges = [];
  for (const token of tokens) {
    let from = 0;
    let at;
    while ((at = normalized.indexOf(token, from)) !== -1) {
      ranges.push([at, at + token.length]);
      from = at + token.length;
    }
  }
  if (!ranges.length) return esc(src);

  ranges.sort((a, b) => a[0] - b[0]);
  let html = '';
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue; // діапазон повністю всередині вже підсвіченого
    const start = Math.max(s, pos);
    html += esc(src.slice(pos, start)) + `<mark class="pe-mark">${esc(src.slice(start, e))}</mark>`;
    pos = e;
  }
  return html + esc(src.slice(pos));
}

// Уривок опису катаклізму навколо першого збігу (порожній рядок, якщо в описі збігів немає)
function snippetHtml(text, tokens) {
  const src = oneLine(text);
  if (!src) return '';
  if (!tokens || !tokens.length) {
    const part = src.slice(0, 90);
    return `<small class="pe-result__snippet">${esc(part)}${src.length > 90 ? '…' : ''}</small>`;
  }
  const normalized = normalizeSearch(src);
  if (normalized.length !== src.length) return '';
  const hits = tokens.map(t => normalized.indexOf(t)).filter(i => i >= 0);
  if (!hits.length) return '';
  const from = Math.max(0, Math.min(...hits) - 30);
  const part = src.slice(from, from + 90);
  return `<small class="pe-result__snippet">${from > 0 ? '…' : ''}${highlightHtml(part, tokens)}${from + 90 < src.length ? '…' : ''}</small>`;
}

function resultRowHtml(r, tokens, searchAll, { activeCategory = '', isDeleteMode = false, selectedDeleteIndices = null } = {}) {
  const isCurrentCat = r.category === activeCategory;
  const isMarkedDelete = isDeleteMode && isCurrentCat && Boolean(selectedDeleteIndices?.has(r.type === 'cata' ? r.index : r.cardIndex));

  let rowClasses = 'added-item-row pe-result';
  if (isDeleteMode && isCurrentCat) {
    rowClasses += ' is-delete-mode';
    if (isMarkedDelete) rowClasses += ' is-marked-delete';
  }

  const checkHtml = isDeleteMode && isCurrentCat
    ? `<span class="added-item-row__check" aria-hidden="true">${isMarkedDelete ? '✓' : ''}</span>`
    : '';

  const deleteHintHtml = isDeleteMode && isCurrentCat
    ? (isMarkedDelete
        ? `<span class="added-item-row__hint added-item-row__hint--delete">до видалення ✕</span>`
        : `<span class="added-item-row__hint added-item-row__hint--pick">обрати</span>`)
    : '';

  if (r.type === 'cata') {
    return `
      <button type="button" class="${rowClasses}" data-res-cat="${esc(r.category)}" data-res-cata="${r.index}" aria-pressed="${isMarkedDelete}">
        ${checkHtml}
        <span class="added-item-row__name">${highlightHtml(oneLine(r.item.name), tokens)}${snippetHtml(r.item.description, tokens)}</span>
        ${deleteHintHtml || `<span class="pe-result__meta">${esc(r.label)}</span>`}
      </button>`;
  }
  const where = `${searchAll ? `${esc(r.label)} · ` : ''}рядок ${r.line + 1}`;
  const detailHtml = r.detail ? snippetHtml(r.detail, tokens) : '';
  return `
    <button type="button" class="${rowClasses}" data-res-cat="${esc(r.category)}" data-res-line="${r.line}" data-res-card="${r.cardIndex}" aria-pressed="${isMarkedDelete}">
      ${checkHtml}
      <span class="added-item-row__name">${highlightHtml(r.text, tokens)}${detailHtml}</span>
      ${deleteHintHtml || `<span class="pe-result__meta">${where}</span>`}
    </button>`;
}

function updateSearchSettingsUi({ searchAll = false, namesOnly = false, wholeWord = false, customOnly = false } = {}) {
  const activeCount = [searchAll, namesOnly, wholeWord, customOnly].filter(Boolean).length;
  const badge = $('pe-search-settings-badge');
  const btn = $('pe-search-settings-btn');
  if (badge) {
    badge.textContent = activeCount > 0 ? String(activeCount) : '';
    badge.hidden = activeCount === 0;
  }
  btn?.classList.toggle('is-active', activeCount > 0);
}

// Перемальовує панель результатів, лічильник і кнопку "×".
// view: { query, tokens, searchAll, namesOnly, wholeWord, customOnly, mode, activeCategory, isDeleteMode, selectedDeleteIndices } і залежно від mode:
//   'idle'        — запиту немає і customOnly вимкнено: панель прихована;
//   'cata-filter' — не використовується в режимі оверлею (залишено для сумісності);
//   'results'     — список знайдених рядків (results, total з collectSearchResults).
export function paintSearch(view) {
  const panel = $('pe-search-results');
  if (!panel) return;
  const count = $('pe-search-count');
  $('pe-search-clear').hidden = !view.query && !view.customOnly;
  updateSearchSettingsUi(view);

  if (view.mode === 'idle') {
    panel.hidden = true;
    panel.innerHTML = '';
    count.textContent = '';
    return;
  }

  if (view.mode === 'cata-filter') {
    panel.hidden = true;
    panel.innerHTML = '';
    count.textContent = view.cataCount ? `Знайдено: ${view.cataCount}` : 'Нічого не знайдено';
    return;
  }

  const { results, total, tokens, query, searchAll, activeCategory, isDeleteMode, selectedDeleteIndices, dismissed = false } = view;
  const deleteState = {
    activeCategory,
    isDeleteMode: Boolean(isDeleteMode),
    selectedDeleteIndices
  };
  panel.hidden = Boolean(dismissed);
  if (!total) {
    count.textContent = 'Нічого не знайдено';
    const trimmed = String(query || '').trim();
    const msg = trimmed
      ? `Нічого не знайдено за запитом "${esc(trimmed)}"${searchAll ? '' : '. Спробуйте увімкнути "В усіх категоріях"'}`
      : `Карток з особливими властивостями не знайдено${searchAll ? '' : '. Спробуйте увімкнути "В усіх категоріях"'}`;
    panel.innerHTML = `<p class="pe-cata-list__empty">${msg}</p>`;
    return;
  }
  count.textContent = total > results.length ? `Знайдено: ${total} (показано ${results.length})` : `Знайдено: ${total}`;
  panel.innerHTML = results.map(r => resultRowHtml(r, tokens, searchAll, deleteState)).join('');
}

// Початкові значення елементів пошуку (на старті сторінки)
export function initSearchControls({ query, all, namesOnly = false, wholeWord = false, customOnly = false }) {
  $('pe-search').value = query;
  $('pe-search-all').checked = all;
  const namesEl = $('pe-search-names-only');
  if (namesEl) namesEl.checked = namesOnly;
  const wholeEl = $('pe-search-whole-word');
  if (wholeEl) wholeEl.checked = wholeWord;
  const customEl = $('pe-search-custom-only');
  if (customEl) customEl.checked = customOnly;
  updateSearchSettingsUi({ searchAll: all, namesOnly, wholeWord, customOnly });
}

export function setSearchInput(value) {
  const input = $('pe-search');
  if (input.value !== value) input.value = value;
}

export const focusSearchInput = () => $('pe-search').focus();

// Перший елемент, на який можна перейти з поля пошуку (результат або відфільтрований катаклізм)
export function firstSearchTargetEl(cataFilterActive) {
  const panel = $('pe-search-results');
  if (!panel.hidden) return panel.querySelector('.pe-result');
  if (cataFilterActive) return $('pe-cata-list').querySelector('[data-cata-index]');
  return null;
}

