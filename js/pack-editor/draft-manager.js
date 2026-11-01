import { clone } from '../utils/common/clone.js';
// ===== Менеджер локальних чернеток редактора паків (localStorage) =====
// Ключ: truebunker_draft_<userId>_<packId> (ізоляція між користувачами на одному комп'ютері; новий пак → packId = 'new').
// Модуль не знає про DOM редактора й про Supabase: стан йому передає редактор (saveDraft) або функція-постачальник (bindLifecycle).

export const DRAFT_PREFIX = 'truebunker_draft_';
const DEBOUNCE_MS = 1500;
const DAY_MS = 86400000;

export const TAB_SESSION_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2);

const keyOf = (packId, userId) => `${DRAFT_PREFIX}${userId}_${packId || 'new'}`;

const isQuotaError = err =>
  err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);


let debounceTimer = null;
let pendingPayload = null;

// Збирає об'єкт чернетки. state: { title, description, config, dirtyCategories, categories, deletedCardIds }
function buildDraft({ packId, userId, baseServerVersion, baseServerUpdatedAt, state }) {
  const dirty = Array.isArray(state?.dirtyCategories) ? [...state.dirtyCategories] : [];
  const categories = {};
  // Лише брудні категорії — менший JSON і менший ризик QuotaExceededError
  for (const category of dirty) {
    if (state?.categories && category in state.categories) categories[category] = clone(state.categories[category]);
  }
  return {
    packId: packId || 'new',
    userId,
    savedAt: Date.now(),
    baseServerVersion: baseServerVersion ?? null,
    baseServerUpdatedAt: baseServerUpdatedAt ?? null,
    tabSessionId: TAB_SESSION_ID,
    title: state?.title ?? '',
    description: state?.description ?? '',
    config: clone(state?.config ?? {}),
    dirtyCategories: dirty,
    categories,
    deletedCardIds: Array.from(state?.deletedCardIds || [])
  };
}

function writeDraft(draft) {
  const key = keyOf(draft.packId, draft.userId);
  const json = JSON.stringify(draft);
  try {
    localStorage.setItem(key, json);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn('Не вдалося записати чернетку:', err);
      return false;
    }
    // Сховище переповнене: прибираємо протухлі чернетки (а за потреби — чужі найстаріші) і пробуємо ще раз
    autoPurgeOldDrafts(14);
    try {
      localStorage.setItem(key, json);
      return true;
    } catch {
      purgeOldestOthers(key);
      try {
        localStorage.setItem(key, json);
        return true;
      } catch (err2) {
        console.warn('Чернетка не поміщається в localStorage:', err2);
        return false;
      }
    }
  }
}

function listDraftKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
  } catch { /* localStorage недоступний */ }
  return keys;
}

function purgeOldestOthers(exceptKey) {
  const items = [];
  for (const k of listDraftKeys()) {
    if (k === exceptKey) continue;
    try {
      const d = JSON.parse(localStorage.getItem(k));
      items.push({ k, savedAt: Number(d?.savedAt) || 0 });
    } catch {
      items.push({ k, savedAt: 0 });
    }
  }
  items.sort((a, b) => a.savedAt - b.savedAt);
  for (const { k } of items.slice(0, Math.max(1, Math.ceil(items.length / 2)))) {
    try { localStorage.removeItem(k); } catch { /* ігноруємо */ }
  }
}

// saveDraft(...): immediate=false → дебаунс 1500 мс; immediate=true → запис одразу (повертає true/false)
export function saveDraft({ immediate = false, ...ctx } = {}) {
  const payload = buildDraft(ctx);
  if (immediate) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    pendingPayload = null;
    return writeDraft(payload);
  }
  pendingPayload = payload;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const p = pendingPayload;
    pendingPayload = null;
    if (p) {
      const ok = writeDraft(p);
      onDraftWritten?.(ok, p);
    }
  }, DEBOUNCE_MS);
  return true;
}

let onDraftWritten = null;
// Колбек для індикатора статусу: викликається після відкладеного запису
export function setDraftWrittenHandler(fn) {
  onDraftWritten = fn;
}

// Скасовує відкладений (ще не записаний) автосейв
export function cancelPendingDraft() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingPayload = null;
}

export function loadDraft(packId, userId) {
  try {
    const raw = localStorage.getItem(keyOf(packId, userId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || typeof d.categories !== 'object' || d.categories === null) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(packId, userId) {
  if (!userId) return;
  cancelPendingDraft();
  try {
    localStorage.removeItem(keyOf(packId, userId));
  } catch { /* ігноруємо */ }
}

// 'NONE' | 'VALID_DRAFT' | 'SERVER_NEWER_CONFLICT'
export function checkDraftStatus(packId, userId, currentServerVersion) {
  const draft = loadDraft(packId, userId);
  if (!draft) return 'NONE';
  const base = Number(draft.baseServerVersion);
  const current = Number(currentServerVersion);
  if (Number.isFinite(base) && Number.isFinite(current) && current > base) return 'SERVER_NEWER_CONFLICT';
  return 'VALID_DRAFT';
}

export function autoPurgeOldDrafts(maxDays = 14) {
  const limit = maxDays * DAY_MS;
  for (const k of listDraftKeys()) {
    let remove = false;
    try {
      const d = JSON.parse(localStorage.getItem(k));
      remove = !d || Date.now() - Number(d.savedAt || 0) > limit;
    } catch {
      remove = true;
    }
    if (remove) {
      try { localStorage.removeItem(k); } catch { /* ігноруємо */ }
    }
  }
}

// ----- Слухачі життєвого циклу сторінки -----
// getContext(): повертає ctx для saveDraft (без immediate) або null, якщо зберігати нічого (редактор не готовий / немає змін)
// onForeignChange(draft): чернетку цього пака оновила інша вкладка цього браузера
let lifecycleCleanup = null;

export function bindLifecycle({ getContext, onForeignChange } = {}) {
  unbindLifecycle();

  const flush = () => {
    const ctx = getContext?.();
    if (ctx) saveDraft({ ...ctx, immediate: true });
  };
  const onPageHide = () => flush();
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
  const onStorage = e => {
    if (!e.key || !e.key.startsWith(DRAFT_PREFIX) || !e.newValue) return;
    const ctx = getContext?.();
    if (!ctx || e.key !== keyOf(ctx.packId, ctx.userId)) return;
    try {
      const d = JSON.parse(e.newValue);
      if (d && d.tabSessionId && d.tabSessionId !== TAB_SESSION_ID) onForeignChange?.(d);
    } catch { /* ігноруємо пошкоджені дані */ }
  };

  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('storage', onStorage);

  lifecycleCleanup = () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('storage', onStorage);
  };
  return unbindLifecycle;
}

export function unbindLifecycle() {
  lifecycleCleanup?.();
  lifecycleCleanup = null;
}

// Єдиний об'єкт для зручності імпорту (draftManager.clearDraft(...) у packs-store.js)
export const draftManager = {
  saveDraft, loadDraft, clearDraft, checkDraftStatus, autoPurgeOldDrafts,
  bindLifecycle, unbindLifecycle, cancelPendingDraft, setDraftWrittenHandler
};
