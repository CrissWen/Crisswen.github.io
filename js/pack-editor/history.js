// ===== Історія дій редактора (Undo / Redo), кільцевий буфер на 30 дій =====
// Дія: { type, category, description, before, after }, де before/after — знімки стану (structuredClone).
// Сам менеджер не знає, як застосувати знімок до редактора: це робить applier, який реєструє editor.js (setApplier).

export const MAX_HISTORY = 30;

export const ACTION_TYPES = [
  'CARD_EDIT', 'CARD_ADD', 'CARD_DELETE', 'CARDS_BULK_DELETE',
  'STAGES_REORDER', 'STAGE_ADD', 'STAGE_DELETE', 'LLM_TEXT_CHANGE'
];

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export class HistoryManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;
    this._apply = null;
    this._busy = false;
  }

  // fn(snapshot, action, direction) — застосовує знімок до стану й інтерфейсу; direction: 'undo' | 'redo'
  setApplier(fn) {
    this._apply = fn;
  }

  _emit() {
    this.onChange?.({ canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  pushAction(action) {
    if (!action || this._busy) return;
    this.undoStack.push({
      type: action.type,
      category: action.category,
      description: action.description || '',
      before: clone(action.before),
      after: clone(action.after)
    });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = []; // новий розрив ланцюга дій
    this._emit();
  }

  undo() {
    if (!this.canUndo()) return null;
    const action = this.undoStack[this.undoStack.length - 1];
    this._run(action.before, action, 'undo');
    this.undoStack.pop();
    this.redoStack.push(action);
    this._emit();
    return action;
  }

  redo() {
    if (!this.canRedo()) return null;
    const action = this.redoStack[this.redoStack.length - 1];
    this._run(action.after, action, 'redo');
    this.redoStack.pop();
    this.undoStack.push(action);
    this._emit();
    return action;
  }

  // Застосовуємо глибоку копію знімка, щоб стан редактора не ділив об'єкти зі стеком історії
  _run(snapshot, action, direction) {
    this._busy = true;
    try {
      this._apply?.(clone(snapshot), action, direction);
    } finally {
      this._busy = false;
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._emit();
  }
}

export const historyManager = new HistoryManager();
