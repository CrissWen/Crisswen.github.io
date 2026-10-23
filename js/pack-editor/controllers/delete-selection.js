import { state } from '../state.js';

// ===== Режим масового видалення: вибір карток =====
// Спільна логіка для кліків по списку карток і по результатах пошуку (раніше була продубльована в обох місцях).
// Індекс — це номер картки в списку (для текстових категорій — позиція серед непорожніх рядків, як у parseCards;
// для катаклізмів — позиція в state.form.cataclysms).

// Індекси рядків списку карток у тому порядку, у якому вони зараз видно (список може бути відфільтрований пошуком)
export function visibleListIndices(listEl) {
  if (!listEl) return [];
  return [...listEl.querySelectorAll('[data-cata-index]')].map(el => Number(el.dataset.cataIndex));
}

// Індекс картки в рядку результату пошуку: катаклізм — його позиція, інші категорії — номер картки (не сирого рядка!)
export function resultRowIndex(el) {
  return el.dataset.resCata !== undefined ? Number(el.dataset.resCata) : Number(el.dataset.resCard);
}

// Індекси результатів пошуку поточної категорії у тому порядку, у якому вони видно
export function visibleResultIndices(rowEl) {
  const container = rowEl?.parentElement;
  if (!container) return [];
  return [...container.querySelectorAll('.pe-result')]
    .filter(el => el.dataset.resCat === state.activeCategory)
    .map(resultRowIndex);
}

// Клік по рядку в режимі видалення.
//  • Звичайний клік перемикає рядок і запам'ятовує його як початок діапазону.
//  • Shift+клік позначає (або знімає) діапазон від попереднього кліку до поточного, але лише серед видимих рядків:
//    інакше при відфільтрованому списку діапазон зачепив би приховані картки, яких користувач не бачить.
// visibleIndices — індекси рядків у порядку на екрані.
export function applyDeleteClick(index, { shiftKey = false, visibleIndices = [] } = {}) {
  const selected = state.selectedDeleteIndices;
  const anchorPos = visibleIndices.indexOf(state.lastClickedDeleteIndex);
  const clickPos = visibleIndices.indexOf(index);

  if (shiftKey && anchorPos !== -1 && clickPos !== -1) {
    const [from, to] = anchorPos <= clickPos ? [anchorPos, clickPos] : [clickPos, anchorPos];
    const shouldSelect = !selected.has(index);
    for (const i of visibleIndices.slice(from, to + 1)) {
      if (shouldSelect) selected.add(i);
      else selected.delete(i);
    }
    return;
  }

  if (selected.has(index)) selected.delete(index);
  else selected.add(index);
  state.lastClickedDeleteIndex = index;
}

// «Вибрати всі» / «Зняти всі» діє лише на видимі рядки (а не на всі картки категорії, включно з відфільтрованими).
export function toggleSelectVisible(visibleIndices) {
  const selected = state.selectedDeleteIndices;
  const allSelected = visibleIndices.length > 0 && visibleIndices.every(i => selected.has(i));
  for (const i of visibleIndices) {
    if (allSelected) selected.delete(i);
    else selected.add(i);
  }
}

export function areAllSelected(visibleIndices) {
  return visibleIndices.length > 0 && visibleIndices.every(i => state.selectedDeleteIndices.has(i));
}
