export class EditorState {
  constructor() {
    this.packId = null;
    this.packVersion = null; // версія пака на сервері (optimistic locking); null для нового пака
    this.packUpdatedAt = null;
    this.userId = null; // id користувача для ключа чернетки
    this.saveStatus = 'saved'; // 'saved' | 'draft' | 'syncing'
    this.skipDraftFlush = false; // true після успішного збереження / свідомого виходу: не писати чернетку при закритті редактора
    this.defaultConfig = {};
    this.packConfig = {};
    this.extraMeta = {};
    this.baseStages = {};
    this.baseRanges = {};
    this.form = { title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: [] };
    this.initialForm = null;
    this.activeCategory = null;
    this.viewMode = 'visual';
    this.stagesViewMode = 'visual';
    this.dynEditIndex = -1;
    this.newDynIndex = -1;
    this.isSaving = false;
    this.isConfirming = false;
    this.allowLeave = false;
    this.cataEditIndex = -1;
    this.newCataIndex = -1;
    this.searchQuery = '';
    this.searchAll = false;
    this.isDeleteMode = false;
    this.selectedDeleteIndices = new Set();
    this.lastClickedDeleteIndex = null;
    this.cardsSortDir = 'none';
    this.mobileCardView = 'categories';
    this.cardData = {};
    this.initialCardMap = new Map();
    this.deletedCardIds = new Set();
    // Приймач для reconcileCards (parser.js): викликає add(id), а ми фільтруємо через markCardDeleted
    this.deletionSink = { add: id => this.markCardDeleted(id) };
  }

  // Помічає картку видаленою для БД. Картку, яку додали у цій сесії (її немає в initialCardMap), в deletedCardIds не додаємо:
  // в базі її ніколи не було, а зайвий id би збивав перевірку «чисті дані» і писав би порожню чернетку (ТЗ 6.4).
  markCardDeleted(id) {
    if (id && this.initialCardMap.has(id)) this.deletedCardIds.add(id);
  }
}

export const state = new EditorState();

