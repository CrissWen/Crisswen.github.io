export class EditorState {
  constructor() {
    this.packId = null;
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
  }
}

export const state = new EditorState();

