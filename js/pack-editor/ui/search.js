import { esc } from '../../utils/escape-html.js';
import { oneLine } from '../parser.js';
import { normalizeSearch } from '../search.js';
import { $ } from './helpers.js';

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
  const normalized = normalizeSearch(src);
  if (!src || normalized.length !== src.length) return '';
  const hits = tokens.map(t => normalized.indexOf(t)).filter(i => i >= 0);
  if (!hits.length) return '';
  const from = Math.max(0, Math.min(...hits) - 30);
  const part = src.slice(from, from + 90);
  return `<small class="pe-result__snippet">${from > 0 ? '…' : ''}${highlightHtml(part, tokens)}${from + 90 < src.length ? '…' : ''}</small>`;
}

function resultRowHtml(r, tokens, searchAll) {
  if (r.type === 'cata') {
    return `
      <button type="button" class="added-item-row pe-result" data-res-cat="${esc(r.category)}" data-res-cata="${r.index}">
        <span class="added-item-row__name">${highlightHtml(oneLine(r.item.name), tokens)}${snippetHtml(r.item.description, tokens)}</span>
        <span class="pe-result__meta">${esc(r.label)}</span>
      </button>`;
  }
  const where = `${searchAll ? `${esc(r.label)} · ` : ''}рядок ${r.line + 1}`;
  return `
    <button type="button" class="added-item-row pe-result" data-res-cat="${esc(r.category)}" data-res-line="${r.line}">
      <span class="added-item-row__name">${highlightHtml(r.text, tokens)}</span>
      <span class="pe-result__meta">${where}</span>
    </button>`;
}

// Перемальовує панель результатів, лічильник і кнопку "×".
// view: { query, tokens, searchAll, mode } і залежно від mode:
//   'idle'        — запиту немає: панель прихована;
//   'cata-filter' — фільтрується сам список катаклізмів (cataCount — скільки збігів), окрема панель не потрібна;
//   'results'     — список знайдених рядків (results, total з collectSearchResults).
export function paintSearch(view) {
  const panel = $('pe-search-results');
  if (!panel) return;
  const count = $('pe-search-count');
  $('pe-search-clear').hidden = !view.query;

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

  const { results, total, tokens, query, searchAll } = view;
  panel.hidden = false;
  if (!total) {
    count.textContent = 'Нічого не знайдено';
    panel.innerHTML = `<p class="pe-cata-list__empty">Нічого не знайдено за запитом "${esc(query.trim())}"${searchAll ? '' : '. Спробуйте увімкнути "В усіх категоріях"'}</p>`;
    return;
  }
  count.textContent = total > results.length ? `Знайдено: ${total} (показано ${results.length})` : `Знайдено: ${total}`;
  panel.innerHTML = results.map(r => resultRowHtml(r, tokens, searchAll)).join('');
}

// Початкові значення елементів пошуку (на старті сторінки)
export function initSearchControls({ query, all }) {
  $('pe-search').value = query;
  $('pe-search-all').checked = all;
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

