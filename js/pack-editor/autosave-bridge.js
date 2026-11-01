import { clone } from '../utils/common/clone.js';
// ===== Міст редактора паків: автосейв чернеток + Undo/Redo + гарячі клавіші =====
// Редактор не інструментуємо в кожному обробнику: після будь-якої зміни стану editor.js викликає onEditorChanged()
// (з updateButtons). Тут зі знімків по розділах (категорії карток, катаклізми, стадії) складаються дії для HistoryManager,
// а чернетка в localStorage пишеться з дебаунсом (draft-manager.js). Діапазони (ranges) і назва/опис — у чернетці,
// але не в історії: вони редагуються у звичайних полях, де працює нативний Undo браузера.

import { state } from './state.js';
import { draftManager, setDraftWrittenHandler, cancelPendingDraft, autoPurgeOldDrafts } from './draft-manager.js';
import { historyManager } from './history.js';
import { initHotkeys, destroyHotkeys } from './hotkeys.js';
import { ALL_PACK_CATEGORIES } from './categories.js';
import { cardToLine, reconcileCards, parseLines } from './parser.js';
import { stagesTextFromConfig, rangesFromConfig, RANGE_DEFAULTS, normalizeForm } from './payload.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { supabase } from '../services/supabase.js';
import * as ui from './ui/ui.js';
import { isDirty, syncCataText, setSaveStatus, requestSave, buildConfig, setMobileCardView } from './controllers/controllers.js';

const CAPTURE_MS = 800;
const MOBILE_QUERY = '(max-width: 899px)';

let deps = { syncFieldsFromForm: () => {}, exitDeleteMode: () => {} };
let active = false;
let captureTimer = null;
let lastSigs = {};
let lastData = {};
let lastDeleted = [];
let lastMeta = { title: '', description: '' };
let unbindLifecycle = null;


const cardCategories = () => ALL_PACK_CATEGORIES.map(c => c.category).filter(c => c !== 'cataclysm');
const labelOf = key => {
  const entry = ALL_PACK_CATEGORIES.find(c => c.category === key);
  return entry?.label || (key === 'stages' ? 'Стадії' : key === 'cataclysm' ? 'Катаклізми' : key);
};
const lineCount = text => String(text || '').split('\n').filter(l => l.trim()).length;

// ----- Знімки по розділах -----
function sectionKeys() {
  return [...cardCategories(), 'cataclysm', 'stages'];
}

function sigOf(key) {
  if (key === 'cataclysm') {
    return state.viewMode === 'llm'
      ? (state.form.texts.cataclysm || '')
      : JSON.stringify(state.form.cataclysms || []);
  }
  if (key === 'stages') return JSON.stringify(state.form.stages || {});
  return state.form.texts[key] || ''; // у візуальному режимі текст теж оновлюється разом із карткою
}

function readSection(key) {
  if (key === 'cataclysm') return clone(state.form.cataclysms || []);
  if (key === 'stages') return clone(state.form.stages || {});
  return { text: state.form.texts[key] || '', cards: state.cardData[key] ? clone(state.cardData[key]) : null };
}

function resetBaseline() {
  clearTimeout(captureTimer);
  captureTimer = null;
  lastSigs = {};
  lastData = {};
  for (const key of sectionKeys()) {
    lastSigs[key] = sigOf(key);
    lastData[key] = readSection(key);
  }
  lastDeleted = [...state.deletedCardIds];
  lastMeta = { title: state.form.title, description: state.form.description };
}

function actionTypeFor(key, before, after) {
  if (key === 'stages') {
    const count = s => Object.values(s || {}).reduce((n, t) => n + lineCount(t), 0);
    const diff = count(after) - count(before);
    return diff > 0 ? 'STAGE_ADD' : diff < 0 ? 'STAGE_DELETE' : 'STAGES_REORDER';
  }
  if (key === 'cataclysm') {
    const diff = (after?.length || 0) - (before?.length || 0);
    return diff > 0 ? 'CARD_ADD' : diff === -1 ? 'CARD_DELETE' : diff < -1 ? 'CARDS_BULK_DELETE' : 'CARD_EDIT';
  }
  if (state.viewMode === 'llm') return 'LLM_TEXT_CHANGE';
  const diff = lineCount(after?.text) - lineCount(before?.text);
  return diff > 0 ? 'CARD_ADD' : diff === -1 ? 'CARD_DELETE' : diff < -1 ? 'CARDS_BULK_DELETE' : 'CARD_EDIT';
}

const TYPE_LABELS = {
  CARD_EDIT: 'Зміна', CARD_ADD: 'Додавання', CARD_DELETE: 'Видалення', CARDS_BULK_DELETE: 'Групове видалення',
  STAGES_REORDER: 'Зміна стадій', STAGE_ADD: 'Нова стадія', STAGE_DELETE: 'Видалення стадії', LLM_TEXT_CHANGE: 'Правка тексту'
};

function capture() {
  clearTimeout(captureTimer);
  captureTimer = null;
  if (!active) return;
  const changed = sectionKeys().filter(k => sigOf(k) !== lastSigs[k]);
  const deletedNow = [...state.deletedCardIds];
  const meta = { title: state.form.title, description: state.form.description };
  if (!changed.length) {
    lastDeleted = deletedNow;
    lastMeta = meta;
    return;
  }
  const key = changed.includes(state.activeCategory) ? state.activeCategory : changed[0];
  const before = {};
  const after = {};
  for (const k of changed) {
    before[k] = lastData[k];
    after[k] = readSection(k);
    lastData[k] = after[k];
    lastSigs[k] = sigOf(k);
  }
  before.__deleted = lastDeleted;
  after.__deleted = deletedNow;
  if (meta.title !== lastMeta.title || meta.description !== lastMeta.description) {
    before.__meta = lastMeta;
    after.__meta = meta;
  }
  lastDeleted = deletedNow;
  lastMeta = meta;
  const type = actionTypeFor(key, before[key], after[key]);
  historyManager.pushAction({
    type,
    category: key,
    description: `${TYPE_LABELS[type]}: ${labelOf(key)}`,
    before,
    after
  });
}

function flushCapture() {
  if (captureTimer) capture();
}

// ----- Застосування знімка (Undo / Redo) -----
function applySnapshot(snap, action) {
  if (state.isDeleteMode) deps.exitDeleteMode();
  const prevCategory = state.activeCategory;
  for (const [key, data] of Object.entries(snap)) {
    if (key === '__deleted') {
      // Undo видалення картки обов'язково прибирає її id з deletedCardIds (і навпаки для Redo)
      state.deletedCardIds.clear();
      for (const id of data) state.deletedCardIds.add(id);
    } else if (key === '__meta') {
      state.form.title = data.title;
      state.form.description = data.description;
    } else if (key === 'cataclysm') {
      state.form.cataclysms = data; // повні об'єкти (таймери, популяція, extra) з глибокої копії
      syncCataText(state.form);
    } else if (key === 'stages') {
      state.form.stages = data;
    } else {
      state.form.texts[key] = data.text;
      if (data.cards) state.cardData[key] = data.cards;
      else delete state.cardData[key];
    }
  }
  const target = action.category && action.category !== 'stages' ? action.category : prevCategory;
  state.activeCategory = target;
  deps.syncFieldsFromForm(); // перемальовує поля, список карток, лічильники категорій (categoryCounts) і кнопки
  if (target !== prevCategory && window.matchMedia(MOBILE_QUERY).matches) setMobileCardView('list');
  resetBaseline();
  scheduleAutosave();
}

historyManager.setApplier((snap, action, direction) => applySnapshot(snap, action, direction));

function updateHistoryButtons() {
  const canUndo = historyManager.canUndo();
  const canRedo = historyManager.canRedo();
  document.querySelectorAll('[data-history="undo"], #pe-undo').forEach(b => { b.disabled = !canUndo; });
  document.querySelectorAll('[data-history="redo"], #pe-redo').forEach(b => { b.disabled = !canRedo; });
}

export function doUndo() {
  flushCapture();
  const action = historyManager.undo();
  if (action) showGlobalToast(`Відмінено: ${action.description}`);
}

export function doRedo() {
  flushCapture();
  const action = historyManager.redo();
  if (action) showGlobalToast(`Повторено: ${action.description}`);
}

// ----- Чернетка -----
function dirtyCategories() {
  const init = state.initialForm?.texts || {};
  const dirty = cardCategories().filter(cat => parseLines(state.form.texts[cat]).join('\n') !== parseLines(init[cat]).join('\n'));
  const cataDirty = normalizeForm({ title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: state.form.cataclysms || [] }) !==
    normalizeForm({ title: '', description: '', texts: {}, stages: {}, ranges: {}, cataclysms: state.initialForm?.cataclysms || [] });
  if (cataDirty) dirty.push('cataclysm');
  return dirty;
}

function hasUnsavedWork() {
  return isDirty() || state.deletedCardIds.size > 0;
}

export function getDraftContext() {
  if (!active || !state.userId || state.skipDraftFlush || state.isSaving) return null;
  const dirty = dirtyCategories();
  const categories = {};
  for (const cat of dirty) {
    if (cat === 'cataclysm') {
      if (state.viewMode === 'llm' && state.activeCategory === 'cataclysm') {
        syncCataclysmsFromLlmText({ markDeleted: false });
      }
      categories[cat] = clone(state.form.cataclysms || []);
    } else if ((cat === state.activeCategory && state.viewMode === 'llm') || !state.cardData[cat]) {
      categories[cat] = reconcileCards(state.form.texts[cat] || '', state.cardData[cat] || [], cat, state.extraMeta, new Set());
    } else {
      categories[cat] = state.cardData[cat];
    }
  }
  return {
    packId: state.packId,
    userId: state.userId,
    baseServerVersion: state.packVersion,
    baseServerUpdatedAt: state.packUpdatedAt,
    state: {
      title: state.form.title,
      description: state.form.description,
      config: buildConfig(),
      dirtyCategories: dirty,
      categories,
      deletedCardIds: [...state.deletedCardIds]
    }
  };
}

function saveDraftLocal() {
  if (!hasUnsavedWork()) return true; // писати нічого: усе вже збережено
  const ctx = getDraftContext();
  if (!ctx) return false;
  const ok = draftManager.saveDraft({ ...ctx, immediate: true });
  if (ok) setSaveStatus('draft');
  return ok;
}

function scheduleAutosave() {
  if (!active || !state.userId || state.isSaving) return;
  if (!hasUnsavedWork()) {
    draftManager.clearDraft(state.packId, state.userId); // повернулись до чистого стану — стара чернетка не потрібна
    if (state.saveStatus !== 'syncing') setSaveStatus('saved');
    return;
  }
  const ctx = getDraftContext();
  if (ctx) draftManager.saveDraft(ctx); // дебаунс 1500 мс усередині
}

// Викликається з editor.js після будь-якої зміни стану
export function onEditorChanged() {
  if (!active) return;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(capture, CAPTURE_MS);
  scheduleAutosave();
}

// ----- Відновлення чернетки -----
function restoreDraft(draft, status) {
  const conflict = status === 'SERVER_NEWER_CONFLICT';
  for (const [cat, cards] of Object.entries(draft.categories || {})) {
    if (cat === 'cataclysm') {
      state.form.cataclysms = clone(cards) || [];
      syncCataText(state.form);
    } else {
      state.cardData[cat] = clone(cards) || [];
      state.form.texts[cat] = state.cardData[cat].map(c => cardToLine(cat, c.value, c.meta)).join('\n');
    }
  }
  state.deletedCardIds.clear();
  for (const id of draft.deletedCardIds || []) state.deletedCardIds.add(id);
  // У конфлікті відновлюємо лише змінені категорії поверх серверних даних; назву, опис і конфіг лишаємо серверними
  if (!conflict) {
    state.form.title = draft.title ?? state.form.title;
    state.form.description = draft.description ?? state.form.description;
    if (draft.config) {
      state.form.stages = { ...state.baseStages, ...Object.fromEntries(Object.entries(stagesTextFromConfig(draft.config)).filter(([, v]) => v)) };
      state.form.ranges = rangesFromConfig(draft.config, state.baseRanges || RANGE_DEFAULTS);
    }
  }
  historyManager.clear();
  deps.syncFieldsFromForm();
  resetBaseline();
  hideDraftModals();
  setSaveStatus('draft');
  scheduleAutosave();
  showGlobalToast(conflict ? 'Відновлено ваші змінені категорії поверх серверної версії' : 'Чернетку відновлено');
}

function hideBanner() {
  const el = document.getElementById('pe-draft-banner');
  if (el) { el.hidden = true; el.replaceChildren(); }
}

function hideDraftModals() {
  hideBanner();
  const modal = document.getElementById('pe-draft-modal');
  if (modal?.open) {
    try { modal.close(); } catch {}
  }
}

function showDraftModal(draft, status) {
  const modal = document.getElementById('pe-draft-modal');
  if (!modal) return;
  const conflict = status === 'SERVER_NEWER_CONFLICT';
  const time = new Date(draft.savedAt || Date.now()).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const date = new Date(draft.savedAt || Date.now()).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

  modal.classList.toggle('is-conflict', conflict);
  const timeEl = document.getElementById('pe-draft-modal-time');
  if (timeEl) timeEl.textContent = `${time} (${date})`;

  const titleEl = document.getElementById('pe-draft-modal-title');
  if (titleEl) titleEl.textContent = conflict ? 'Конфлікт версій чернетки' : 'Знайдено незбережені зміни';

  const descEl = document.getElementById('pe-draft-modal-desc');
  if (descEl) {
    descEl.textContent = conflict
      ? `Є локальна чернетка, але пак уже оновлено на іншому пристрої (серверна версія ${state.packVersion}, чернетка — ${draft.baseServerVersion ?? '?'}). Бажаєте відновити лише ваші змінені категорії поверх серверної версії?`
      : 'У вас залишилися незбережені редагування від попередньої сесії. Бажаєте відновити їх і продовжити роботу, чи відхилити та завантажити версію із сервера?';
  }

  const labelEl = document.getElementById('pe-draft-modal-restore-label');
  if (labelEl) labelEl.textContent = conflict ? 'Відновити мої категорії' : 'Відновити зміни';

  const detailsEl = document.getElementById('pe-draft-modal-details');
  if (detailsEl) {
    const dirty = Array.isArray(draft.dirtyCategories) && draft.dirtyCategories.length > 0
      ? draft.dirtyCategories
      : Object.keys(draft.categories || {});

    const deletedByCat = {};
    if (Array.isArray(draft.deletedCardIds)) {
      for (const id of draft.deletedCardIds) {
        const snapStr = state.initialCardMap?.get(id);
        if (snapStr) {
          try {
            const snap = JSON.parse(snapStr);
            const cat = snap.category;
            deletedByCat[cat] = (deletedByCat[cat] || 0) + 1;
          } catch {}
        }
      }
    }

    const badges = [];
    let totalAddedOrChanged = 0;
    let totalDeleted = 0;

    for (const cat of dirty) {
      const catObj = ALL_PACK_CATEGORIES.find(c => c.category === cat);
      const name = catObj ? catObj.label : cat;
      const draftList = Array.isArray(draft.categories?.[cat]) ? draft.categories[cat] : [];
      const currentList = cat === 'cataclysm'
        ? (state.form.cataclysms || [])
        : (state.cardData[cat] || []);
      const baselineCount = currentList.length || lineCount(state.form.texts[cat]);
      const diff = draftList.length - baselineCount;

      if (diff > 0) {
        totalAddedOrChanged += diff;
        badges.push(`<span class="pe-draft-modal__badge"><span class="pe-draft-modal__badge-dot"></span>${name} <strong>+${diff}</strong></span>`);
      } else if (diff < 0) {
        const absDiff = Math.abs(diff);
        totalDeleted += absDiff;
        badges.push(`<span class="pe-draft-modal__badge pe-draft-modal__badge--deleted"><span class="pe-draft-modal__badge-dot"></span>${name} <strong>-${absDiff}</strong></span>`);
      } else {
        totalAddedOrChanged++;
        badges.push(`<span class="pe-draft-modal__badge"><span class="pe-draft-modal__badge-dot"></span>${name}</span>`);
      }
    }

    for (const [cat, count] of Object.entries(deletedByCat)) {
      if (!dirty.includes(cat) && count > 0) {
        totalDeleted += count;
        const catObj = ALL_PACK_CATEGORIES.find(c => c.category === cat);
        const name = catObj ? catObj.label : cat;
        badges.push(`<span class="pe-draft-modal__badge pe-draft-modal__badge--deleted"><span class="pe-draft-modal__badge-dot"></span>${name} <strong>-${count}</strong></span>`);
      }
    }

    const directDeletedCount = (draft.deletedCardIds || []).length;
    if (totalDeleted === 0 && directDeletedCount > 0) {
      totalDeleted = directDeletedCount;
      badges.push(`<span class="pe-draft-modal__badge pe-draft-modal__badge--deleted"><span class="pe-draft-modal__badge-dot"></span>Видалено: <strong>-${directDeletedCount}</strong></span>`);
    }

    if (badges.length > 0) {
      let summaryText = '';
      if (totalAddedOrChanged > 0 && totalDeleted > 0) {
        summaryText = `+${totalAddedOrChanged} / -${totalDeleted}`;
      } else if (totalDeleted > 0) {
        summaryText = `Видалено ${totalDeleted}`;
      } else {
        summaryText = `${badges.length} розд.`;
      }

      detailsEl.innerHTML = `
        <div class="pe-draft-modal__details-heading">
          <span>Зміни в чернетці</span>
          <span>${summaryText}</span>
        </div>
        <div class="pe-draft-modal__badges">${badges.join('')}</div>
      `;
      detailsEl.hidden = false;
    } else {
      detailsEl.hidden = true;
      detailsEl.innerHTML = '';
    }
  }

  const onRestore = () => {
    try { modal.close(); } catch {}
    restoreDraft(draft, status);
  };
  const onDiscard = () => {
    draftManager.clearDraft(state.packId, state.userId);
    hideDraftModals();
    showGlobalToast('Чернетку відхилено');
  };
  const onDismiss = () => {
    try { modal.close(); } catch {}
  };

  const btnRestore = modal.querySelector('[data-draft-modal-action="restore"]');
  const btnDiscard = modal.querySelector('[data-draft-modal-action="discard"]');
  const btnDismiss = modal.querySelector('[data-draft-modal-action="dismiss"]');

  if (btnRestore) {
    const fresh = btnRestore.cloneNode(true);
    btnRestore.replaceWith(fresh);
    fresh.addEventListener('click', onRestore);
  }
  if (btnDiscard) {
    const fresh = btnDiscard.cloneNode(true);
    btnDiscard.replaceWith(fresh);
    fresh.addEventListener('click', onDiscard);
  }
  if (btnDismiss) {
    const fresh = btnDismiss.cloneNode(true);
    btnDismiss.replaceWith(fresh);
    fresh.addEventListener('click', onDismiss);
  }

  // Fallback for light-dismiss on backdrop click (з modern-web-guidance: light-dismiss-a-dialog)
  if (!modal.__hasBackdropFallback) {
    modal.__hasBackdropFallback = true;
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      const rect = modal.getBoundingClientRect();
      const isContent = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );
      if (!isContent) onDismiss();
    });
  }

  try {
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }
  } catch (err) {
    console.warn('Could not showModal for draft dialog:', err);
  }
}

function showBanner(draft, status) {
  const el = document.getElementById('pe-draft-banner');
  if (!el) return;
  const conflict = status === 'SERVER_NEWER_CONFLICT';
  const time = new Date(draft.savedAt || Date.now()).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  el.replaceChildren();
  el.classList.toggle('is-conflict', conflict);

  const text = document.createElement('span');
  text.className = 'pe-draft-banner__text';
  text.textContent = conflict
    ? `Є чернетка від ${time}, але пак уже оновлено на іншому пристрої (версія ${state.packVersion}, чернетка — ${draft.baseServerVersion ?? '?'}). Відновити лише ваші змінені категорії?`
    : `Знайдено незбережені зміни від ${time}. Відновити?`;

  const actions = document.createElement('span');
  actions.className = 'pe-draft-banner__actions';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pk-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  actions.append(
    mk(conflict ? 'Відновити мої категорії' : 'Відновити', 'pk-btn--primary', () => restoreDraft(draft, status)),
    mk('Відхилити', 'pk-btn--ghost', () => {
      draftManager.clearDraft(state.packId, state.userId);
      hideBanner();
    })
  );
  el.append(text, actions);
  el.hidden = false;
}

function offerDraftRestore() {
  if (!state.userId) return;
  const status = draftManager.checkDraftStatus(state.packId, state.userId, state.packVersion);
  if (status === 'NONE') return;
  const draft = draftManager.loadDraft(state.packId, state.userId);
  if (draft) {
    showBanner(draft, status);
    showDraftModal(draft, status);
  }
}

// ----- Життєвий цикл -----
export async function initAutosave(options = {}) {
  deps = { ...deps, ...options };
  const sessionGen = state.sessionId;
  let resolvedUserId = null;
  try {
    // getSession читає сесію з локального сховища (працює й офлайн), getUser — лише запасний варіант.
    // Без userId чернетки не пишуться, тож залежність від мережі тут відключала би автосейв при відкритті редактора без інтернету.
    const { data: sess } = await supabase.auth.getSession();
    resolvedUserId = sess?.session?.user?.id || null;
    if (!resolvedUserId) {
      const { data } = await supabase.auth.getUser();
      resolvedUserId = data?.user?.id || null;
    }
  } catch {
    resolvedUserId = null;
  }
  // Захист від гонки: якщо користувач вийшов із редактора або відкрив нову сесію, поки чекали сесію auth (I-2)
  if (sessionGen !== state.sessionId || !ui.isEditorMounted()) return;
  state.userId = resolvedUserId;
  state.skipDraftFlush = false;
  active = true;
  historyManager.onChange = updateHistoryButtons;
  historyManager.clear();
  resetBaseline();
  updateHistoryButtons();
  setSaveStatus('saved');
  autoPurgeOldDrafts(14);

  setDraftWrittenHandler(ok => { if (ok && state.saveStatus !== 'syncing') setSaveStatus('draft'); });
  unbindLifecycle = draftManager.bindLifecycle({
    getContext: () => (hasUnsavedWork() ? getDraftContext() : null),
    onForeignChange: () => showGlobalToast('Чернетку цього пака змінено в іншій вкладці')
  });

  document.querySelectorAll('[data-history="undo"], #pe-undo').forEach(b => b.addEventListener('click', doUndo));
  document.querySelectorAll('[data-history="redo"], #pe-redo').forEach(b => b.addEventListener('click', doRedo));

  initHotkeys({
    isActive: () => active && ui.isEditorMounted() && !state.isConfirming,
    saveDraftLocal,
    onDraftSaved: ok => showGlobalToast(ok ? 'Чернетку збережено локально' : 'Не вдалося зберегти чернетку'),
    saveToDatabase: () => requestSave(),
    undo: doUndo,
    redo: doRedo,
    canUndo: () => historyManager.canUndo() || Boolean(captureTimer),
    canRedo: () => historyManager.canRedo()
  });

  offerDraftRestore();
}

export function destroyAutosave() {
  if (active && !state.skipDraftFlush && state.userId && hasUnsavedWork()) {
    const ctx = getDraftContext();
    if (ctx) draftManager.saveDraft({ ...ctx, immediate: true }); // вихід зі сторінки без втрати змін
  }
  active = false;
  clearTimeout(captureTimer);
  captureTimer = null;
  cancelPendingDraft();
  destroyHotkeys();
  unbindLifecycle?.();
  unbindLifecycle = null;
  setDraftWrittenHandler(null);
  historyManager.onChange = null;
}
