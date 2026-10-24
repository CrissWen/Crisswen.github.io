// ===== Клієнтський UI-стан ігрової дошки (пам'ять вкладки) =====
// Оскільки game.js при кожному Realtime-оновленні перемальовує #game-board через innerHTML,
// стан згорнутих блоків, режим відображення гравців (Картки / Таблиця) та розгорнуті картки
// гравців зберігаються тут — аналогічно до event-log.js та personal-notes.js.

const collapsedBlocks = new Set();
let playersViewMode = 'auto'; // 'auto' | 'cards' | 'table'
const expandedPlayerKeys = new Set();

export function isBlockCollapsed(blockId) {
  return collapsedBlocks.has(blockId);
}

// Перемикає стан блоку в DOM без повного перемальовування всієї дошки
export function toggleBlockCollapsed(blockId) {
  if (!blockId) return;
  const willCollapse = !collapsedBlocks.has(blockId);
  if (willCollapse) collapsedBlocks.add(blockId);
  else collapsedBlocks.delete(blockId);

  const section = document.getElementById(blockId);
  if (!section) return;
  section.classList.toggle('is-collapsed', willCollapse);
  const toggleBtn = section.querySelector(`[data-block-toggle="${blockId}"]`);
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', String(!willCollapse));
    toggleBtn.querySelector('.block-toggle-arrow')?.classList.toggle('is-collapsed', willCollapse);
  }
}

export function getPlayersViewMode() {
  return playersViewMode;
}

export function setPlayersViewMode(mode) {
  if (mode !== 'auto' && mode !== 'cards' && mode !== 'table') return;
  playersViewMode = mode;

  const container = document.querySelector('#block-players-table .players-board-container');
  if (container) {
    container.dataset.viewMode = mode;
  }

  document.querySelectorAll('#block-players-table [data-players-view]').forEach(btn => {
    const isSelected = btn.dataset.playersView === mode;
    btn.classList.toggle('is-active', isSelected);
    btn.setAttribute('aria-pressed', String(isSelected));
  });
}

export function isPlayerCardExpanded(key) {
  return expandedPlayerKeys.has(String(key));
}

function syncExpandAllButton() {
  const expandAllBtn = document.querySelector('#block-players-table [data-players-expand-all]');
  if (!expandAllBtn) return;
  const cards = document.querySelectorAll('#block-players-table .player-acc-card');
  const allExpanded = cards.length > 0 && [...cards].every(c => c.classList.contains('is-expanded'));
  expandAllBtn.textContent = allExpanded ? 'Згорнути всі' : 'Розгорнути всі';
  expandAllBtn.setAttribute('aria-expanded', String(allExpanded));
}

export function togglePlayerCard(key, cardEl) {
  const strKey = String(key ?? '');
  if (!strKey) return;

  const willExpand = !expandedPlayerKeys.has(strKey);
  if (willExpand) expandedPlayerKeys.add(strKey);
  else expandedPlayerKeys.delete(strKey);

  const card = cardEl || [...document.querySelectorAll('#block-players-table .player-acc-card')]
    .find(el => el.dataset.playerKey === strKey);

  if (card) {
    card.classList.toggle('is-expanded', willExpand);
    const headBtn = card.querySelector('[data-player-card-toggle]');
    if (headBtn) headBtn.setAttribute('aria-expanded', String(willExpand));
  }
  syncExpandAllButton();
}

export function toggleAllPlayerCards() {
  const cards = [...document.querySelectorAll('#block-players-table .player-acc-card')];
  if (!cards.length) return;

  const allExpanded = cards.every(c => c.classList.contains('is-expanded'));
  const targetState = !allExpanded;

  cards.forEach(card => {
    const key = card.dataset.playerKey;
    if (!key) return;
    if (targetState) expandedPlayerKeys.add(key);
    else expandedPlayerKeys.delete(key);

    card.classList.toggle('is-expanded', targetState);
    const headBtn = card.querySelector('[data-player-card-toggle]');
    if (headBtn) headBtn.setAttribute('aria-expanded', String(targetState));
  });

  syncExpandAllButton();
}

export function resetBoardUiState() {
  collapsedBlocks.clear();
  playersViewMode = 'auto';
  expandedPlayerKeys.clear();
}

