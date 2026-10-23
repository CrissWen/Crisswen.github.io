import { state } from '../state.js';
import { DEFAULT_PACK_ID, savePack, getPack } from '../../services/packs-store.js';
import { draftManager } from '../draft-manager.js';
import { historyManager } from '../history.js';
import { ALL_PACK_CATEGORIES } from '../categories.js';
import { parseCards, reconcileCards } from '../parser.js';
import {
  validateTitle, validateRanges, buildPackConfig, cataclysmToRow,
  normalizeForm, STAGE_KEYS, OBJECT_STAGE_KEYS,
  validateStageText, validateStageEntries
} from '../payload.js';
import {
  TITLE_MAX, DESC_MAX, CARD_VALUE_MAX, CARD_META_TEXT_MAX,
  STAGE_NAME_MAX, MAX_PACK_CARDS, CATACLYSM_LIMITS
} from '../constants.js';
import { validatePackText, cleanControlChars } from '../../utils/security.js';
import { showGlobalToast } from '../../game-modules/overlays/global-toast.js';
import { showPackNotice, isPackNoticeMuted, setPackNoticeMuted } from '../../game-modules/overlays/pack-notice.js';
import { findShortCategories } from '../../utils/pack-fallback.js';
import { getGameConfigSync } from '../../config/config-manager.js';
import * as ui from '../ui/ui.js';
import { cataDraftPending, syncCataclysmsFromLlmText } from './cataclysm.js';
import { dynDraftPending } from './dynamic.js';
import { isDirty, confirmAction, goToList } from './navigation.js';

let orchestrator = {
  blankForm: () => ({}),
  cloneForm: (f) => f,
  syncFieldsFromForm: () => {},
  getDraftContext: () => null // контекст для draftManager.saveDraft (задає editor.js)
};

export function setSaveOrchestrator(handlers) {
  orchestrator = { ...orchestrator, ...handlers };
}

export const isFormEmpty = () => normalizeForm(state.form) === normalizeForm(orchestrator.blankForm());

export const buildConfig = () => buildPackConfig({
  defaultConfig: state.defaultConfig,
  packConfig: state.packConfig,
  stages: state.form.stages,
  ranges: state.form.ranges
});

// Повертає керування вікном або null, якщо показувати нічого (усе в нормі, базовий пак, вікно вимкнено)
function showShortageNotice(cards) {
  if (state.packId === DEFAULT_PACK_ID || isPackNoticeMuted(state.packId)) return null;
  const bc = getGameConfigSync() || {};
  const short = findShortCategories(cards, bc);
  return short.length ? showPackNotice(short) : null;
}

// ===== Трирівневий щит збереження =====
// 1) No-op: ніяких змін — запиту немає; 2) тротл 3 с з чергою; 3) м'який фолбек на локальну чернетку при 429/офлайні.
const THROTTLE_MS = 3000;
const RETRY_MS = 15000;
let lastSaveAt = 0;
let queuedTimer = null;
let retryTimer = null;

const saveButton = () => document.querySelector('[data-action="save"]');

// Індикатор статусу поруч із назвою пака: 'saved' | 'draft' | 'syncing'
export function setSaveStatus(status, extra = '') {
  state.saveStatus = status;
  const el = document.getElementById('pe-save-status');
  if (!el) return;
  const labels = { saved: `Збережено${extra}`, draft: 'Чернетка збережена', syncing: 'Синхронізація...' };
  el.textContent = labels[status] || '';
  el.dataset.status = status;
}

const isNetworkProblem = err =>
  err?.code === 'RATE_LIMIT' || !navigator.onLine || err instanceof TypeError ||
  /failed to fetch|networkerror|network request failed|429|too many requests/i.test(String(err?.message || ''));

function flashButton(btn, text, ms = 1500) {
  const label = btn.dataset.peLabel || (btn.dataset.peLabel = btn.textContent);
  ui.setButtonState(btn, { disabled: false, text });
  setTimeout(() => { if (!state.isSaving) ui.setButtonState(btn, { disabled: false, text: label }); }, ms);
}

// Єдина точка входу (кнопка «Зберегти», Ctrl+Shift+S, Ctrl+Enter)
export function requestSave(btn = saveButton()) {
  if (!btn) return;
  // Рівень 1: чисті дані — мережа не потрібна
  if (state.packId && !isDirty() && state.deletedCardIds.size === 0) {
    flashButton(btn, 'Всі зміни вже збережено');
    return;
  }
  // Рівень 2: тротл з чергою (один очікуючий запит)
  const elapsed = Date.now() - lastSaveAt;
  if (state.isSaving || elapsed < THROTTLE_MS) {
    if (queuedTimer) return;
    ui.setButtonState(btn, { disabled: false, text: 'Збереження заплановано...' });
    queuedTimer = setTimeout(() => {
      queuedTimer = null;
      requestSave(btn);
    }, state.isSaving ? THROTTLE_MS : THROTTLE_MS - elapsed);
    return;
  }
  clearTimeout(retryTimer);
  retryTimer = null;
  handleSave(btn);
}

// Рівень 3: мережа/429 — не лякаємо, дані вже в localStorage, робимо тихий ретрай
function softFallback(btn) {
  const ctx = orchestrator.getDraftContext?.();
  if (ctx) draftManager.saveDraft({ ...ctx, immediate: true });
  setSaveStatus('syncing');
  showGlobalToast('Зміни в безпеці. Синхронізуємо з сервером через 15 секунд...');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; requestSave(btn); }, RETRY_MS);
}

export function cancelSaveTimers() {
  clearTimeout(queuedTimer);
  clearTimeout(retryTimer);
  queuedTimer = retryTimer = null;
}

// Модальне вікно конфлікту версій → 'merge' | 'force' | 'cancel'. «Переглянути відмінності» показує список категорій в тому ж вікні.
function showConflictDialog(serverVersion, diffLines) {
  return new Promise(resolve => {
    // Вигляд — лише через класи й змінні теми (css/components/packs.css, блок .pk-conflict), без жорстких кольорів
    const overlay = document.createElement('div');
    overlay.className = 'pk-conflict';
    const box = document.createElement('div');
    box.className = 'pk-conflict__box';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = '<h3 class="pk-conflict__title">Пак змінено на іншому пристрої</h3>' +
      `<p class="pk-conflict__text">На сервері версія ${serverVersion ?? '?'}, а ваші зміни зроблені на версії ${state.packVersion ?? '?'}. Ваші зміни збережено локально.</p>` +
      '<pre class="pk-conflict__diff" data-diff hidden></pre>' +
      '<div class="pk-conflict__actions"></div>';
    box.querySelector('[data-diff]').textContent = diffLines.join('\n') || 'Відмінностей у картках не знайдено';
    const actions = box.querySelector('.pk-conflict__actions');
    const finish = v => { overlay.remove(); resolve(v); };
    const mk = (text, value, kind) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.className = `pk-btn pk-conflict__btn${kind ? ` pk-btn--${kind}` : ''}`;
      b.addEventListener('click', () => {
        if (value === 'diff') { box.querySelector('[data-diff]').hidden = false; b.remove(); return; }
        finish(value);
      });
      return b;
    };
    actions.append(
      mk('Оновити лише мої змінені категорії', 'merge', 'primary'),
      mk('Переглянути відмінності', 'diff'),
      mk('Перезаписати серверний пак примусово', 'force', 'danger'),
      mk('Скасувати', 'cancel')
    );
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') finish('cancel'); });
    overlay.append(box);
    document.body.append(overlay);
    box.querySelector('button')?.focus();
  });
}

// Вирішення конфлікту. Спершу затримуємо чернетку, щоб нічого не втратити.
// 'merge': категорії, які я не чіпав, беремо з сервера; мої змінені — лишаються; базова версія стає серверною.
async function resolveVersionConflict(btn) {
  const ctx = orchestrator.getDraftContext?.();
  if (ctx) draftManager.saveDraft({ ...ctx, immediate: true });
  const server = await getPack(state.packId);
  if (!server || server.forbidden) throw new Error('Не вдалося отримати серверну версію пака');

  const initialByCat = {};
  for (const [id, snap] of state.initialCardMap.entries()) {
    const s = JSON.parse(snap);
    (initialByCat[s.category] ||= []).push({ id, value: s.value, meta: s.meta || {} });
  }
  const sig = arr => JSON.stringify((arr || []).map(c => [c.id, c.value, c.meta || {}]).sort());
  const labelOf = c => c.label ?? c.title ?? c.category;
  const diffLines = [];
  const dirty = new Set();
  for (const entry of ALL_PACK_CATEGORIES) {
    const cat = entry.category;
    if (cat === 'cataclysm') continue;
    const mine = state.cardData[cat] || [];
    if (sig(mine) !== sig(initialByCat[cat])) dirty.add(cat);
    if (sig(mine) !== sig(server.cardObjects?.[cat])) {
      diffLines.push(`${labelOf(entry)}: у вас ${mine.length}, на сервері ${server.cardObjects?.[cat]?.length || 0} (${dirty.has(cat) ? 'ви змінювали' : 'змінено на сервері'})`);
    }
  }
  const cataChanged = JSON.stringify(state.form.cataclysms) !== JSON.stringify(state.initialForm?.cataclysms);
  if (cataChanged) dirty.add('cataclysm');

  let choice = await showConflictDialog(server.version, diffLines);
  if (choice === 'cancel') return false;
  if (choice === 'force') {
    state.packVersion = null; // expectedVersion = null → сервер не перевіряє версію
    return true;
  }
  // merge
  for (const entry of ALL_PACK_CATEGORIES) {
    const cat = entry.category;
    if (cat === 'cataclysm' || dirty.has(cat)) continue;
    state.cardData[cat] = (server.cardObjects?.[cat] || []).map(c => ({ id: c.id, value: c.value, meta: c.meta || {} }));
    state.form.texts[cat] = (server.cards?.[cat] || []).join('\n');
  }
  if (!dirty.has('cataclysm')) state.form.cataclysms = (server.cataclysms || []).map(c => ({ ...c, extra: { ...(c.extra || {}) } }));
  // Базовий знімок для дельти — серверний стан
  state.initialCardMap = new Map();
  for (const entry of ALL_PACK_CATEGORIES) {
    for (const c of server.cardObjects?.[entry.category] || []) {
      state.initialCardMap.set(c.id, JSON.stringify({ pool_type: entry.poolType, category: entry.category, value: c.value, meta: c.meta || {} }));
    }
  }
  for (const cata of server.cataclysms || []) {
    if (cata.id) {
      const row = cataclysmToRow(cata);
      state.initialCardMap.set(cata.id, JSON.stringify({ pool_type: row.pool_type, category: row.category, value: row.value, meta: row.meta || {} }));
    }
  }
  state.packVersion = server.version ?? null;
  state.packUpdatedAt = server.updatedAt || null;
  state.deletedCardIds.clear();
  orchestrator.syncFieldsFromForm();
  return true;
}

export async function handleSave(btn) {
  if (state.isSaving) return;
  lastSaveAt = Date.now();

  const title = state.form.title.trim();
  const error = validateTitle(title, { isDefaultPack: state.packId === DEFAULT_PACK_ID });
  if (error) {
    ui.showTitleError(error);
    ui.focusTitle();
    return;
  }

  const rangeError = validateRanges(state.form.ranges);
  if (rangeError) {
    showGlobalToast(rangeError);
    return;
  }

  // Заповнену, але не додану форму катаклізму не зберігаємо мовчки разом з паком
  if (cataDraftPending()) {
    showGlobalToast('У формі катаклізму є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }

  if (dynDraftPending()) {
    showGlobalToast('У формі характеристики є незбережені дані — натисніть "Додати" / "Зберегти зміни" або "Скасувати"');
    return;
  }

  // Синхронізуємо стадії перед збереженням
  STAGE_KEYS.forEach(k => {
    if (state.stagesViewMode === 'llm') {
      const ta = document.querySelector(`[data-stage-ta="${k}"]`);
      if (ta) state.form.stages[k] = ta.value;
    } else {
      state.form.stages[k] = ui.gatherStageText(k);
    }
  });

  // Перевірка коректності проміжних стадій у глобальних налаштуваннях
  for (const k of OBJECT_STAGE_KEYS) {
    const stageErr = validateStageText(k, state.form.stages[k] || '');
    if (stageErr) {
      showGlobalToast(stageErr);
      return;
    }
  }

  // Якщо ми в LLM-режимі, синхронізуємо текст активної категорії перед збереженням
  if (state.viewMode === 'llm') {
    if (state.activeCategory === 'cataclysm') {
      syncCataclysmsFromLlmText();
    } else if (state.activeCategory) {
      state.cardData[state.activeCategory] = reconcileCards(
        state.form.texts[state.activeCategory] || '',
        state.cardData[state.activeCategory] || [],
        state.activeCategory,
        state.extraMeta,
        state.deletionSink
      );
    }
  }

  // Збираємо повний актуальний список карток для валідації та розрахунку дельти
  const allCards = [];
  for (const { category, poolType } of ALL_PACK_CATEGORIES) {
    if (category === 'cataclysm') continue;
    if (!state.cardData[category]) {
      state.cardData[category] = parseCards(state.form.texts[category] || '', category, state.extraMeta).map(c => ({
        id: c.id || crypto.randomUUID(),
        value: cleanControlChars(c.value).trim(),
        meta: c.meta || {}
      }));
    }
    for (const c of state.cardData[category]) {
      const cleanVal = cleanControlChars(c?.value).trim();
      if (!cleanVal) continue;
      allCards.push({
        id: c.id,
        pool_type: poolType,
        category,
        value: cleanVal,
        meta: c.meta || {}
      });
    }
  }

  for (const cata of state.form.cataclysms || []) {
    if (String(cata?.name ?? '').trim()) {
      allCards.push(cataclysmToRow(cata));
    }
  }

  // Централізована валідація тексту паку перед збереженням у БД (захист від порожніх значень, переповнення та XSS)
  const packValidation = validatePackText({
    title,
    description: cleanControlChars(state.form.description).trim(),
    cards: allCards,
    cataclysms: state.form.cataclysms || []
  }, {
    TITLE_MAX, DESC_MAX, CARD_VALUE_MAX, CARD_META_TEXT_MAX,
    STAGE_NAME_MAX, MAX_PACK_CARDS, CATACLYSM_LIMITS
  });

  if (!packValidation.valid) {
    if (packValidation.field === 'title') {
      ui.showTitleError(packValidation.error);
      ui.focusTitle();
    } else {
      showGlobalToast(packValidation.error);
      if (packValidation.category && packValidation.category !== state.activeCategory) {
        ui.showCategory({
          category: packValidation.category,
          text: state.form.texts[packValidation.category] || '',
          viewMode: state.viewMode
        });
      }
    }
    return;
  }

  for (const c of allCards) {
    if (OBJECT_STAGE_KEYS.includes(c.category) && Array.isArray(c.meta?.stages)) {
      const cardStageErr = validateStageEntries(c.category, c.meta.stages);
      if (cardStageErr) {
        showGlobalToast(`У картці "${c.value}": ${cardStageErr}`);
        return;
      }
    }
  }

  if (allCards.length > MAX_PACK_CARDS) {
    showGlobalToast(`Забагато характеристик: ${allCards.length}. Максимум — ${MAX_PACK_CARDS}`);
    return;
  }

  // Розрахунок дельти: які картки додати/оновити, а які видалити
  let upsertCards = allCards;
  let deleteCardIds = [];

  if (state.packId && state.initialCardMap && state.initialCardMap.size > 0) {
    const currentCardIds = new Set(allCards.map(c => c.id));
    const toDeleteSet = new Set(state.deletedCardIds);

    for (const oldId of state.initialCardMap.keys()) {
      if (!currentCardIds.has(oldId)) {
        toDeleteSet.add(oldId);
      }
    }
    deleteCardIds = Array.from(toDeleteSet);

    // У p_cards відправляємо лише нові або модифіковані рядки
    upsertCards = allCards.filter(c => {
      if (!state.initialCardMap.has(c.id)) return true;
      const initialSnap = state.initialCardMap.get(c.id);
      const currentSnap = JSON.stringify({ pool_type: c.pool_type, category: c.category, value: c.value, meta: c.meta || {} });
      return initialSnap !== currentSnap;
    });
  }

  const isEdit = Boolean(state.packId);
  const originalLabel = btn.textContent;
  state.isSaving = true;
  ui.setButtonState(btn, { disabled: true, text: 'Збереження...' });

  // Підказка про нестачу карток: для базового пака не потрібна (він сам є джерелом добору), а також якщо її вимкнено
  const notice = showShortageNotice(allCards);

  try {
    setSaveStatus('syncing');
    const result = await savePack({
      id: state.packId,
      title,
      description: state.form.description.trim(),
      config: buildConfig(),
      cards: upsertCards,
      deletedCardIds: deleteCardIds,
      expectedVersion: isEdit ? state.packVersion : null
    });
    const savedId = result?.pack_id || state.packId;
    // Успіх: нова версія з сервера, чернетка більше не потрібна, історію скидаємо
    state.packVersion = result?.version ?? state.packVersion;
    state.packUpdatedAt = result?.updated_at ?? state.packUpdatedAt;
    state.skipDraftFlush = true; // редактор зараз закриється: чернетку при виході не писати
    if (state.userId) draftManager.clearDraft(state.packId || savedId, state.userId);
    state.initialForm = orchestrator.cloneForm(state.form);
    historyManager.clear();
    cancelSaveTimers();
    setSaveStatus('saved', result?.version ? ` в базі (версія ${result.version})` : '');
    showGlobalToast(isEdit ? 'Пак оновлено' : 'Пак створено');

    // Оновлюємо знімок стану на випадок повторного збереження без виходу з редактора
    state.deletedCardIds.clear();
    state.initialCardMap.clear();
    for (const c of allCards) {
      state.initialCardMap.set(c.id, JSON.stringify({ pool_type: c.pool_type, category: c.category, value: c.value, meta: c.meta || {} }));
    }

    // Вікно йшло паралельно зі збереженням; на список переходимо, лише коли користувач його закрив
    if (notice) {
      const { muted } = await notice.closed;
      // «Більше не показувати» прив’язуємо до цього пака (id нового відомий лише після збереження); з цим статусом редактор показує іконки «мало карток»
      if (muted) setPackNoticeMuted(savedId, true);
    }
    goToList();
  } catch (err) {
    console.error('Не вдалося зберегти пак:', err);
    notice?.close();
    ui.setButtonState(btn, { disabled: false, text: originalLabel });
    if (err?.code === 'VERSION_CONFLICT') {
      // Збереження призупинено; дані користувача безпечні в чернетці
      setSaveStatus('draft');
      state.isSaving = false;
      try {
        if (await resolveVersionConflict(btn)) setTimeout(() => handleSave(btn), 0);
      } catch (e2) {
        console.error('Не вдалося вирішити конфлікт:', e2);
        showGlobalToast(e2.message || 'Не вдалося вирішити конфлікт версій');
      }
    } else if (isNetworkProblem(err)) {
      softFallback(btn);
    } else {
      setSaveStatus('draft');
      showGlobalToast(err.message || 'Не вдалося зберегти пак');
    }
  } finally {
    state.isSaving = false;
  }
}

export async function handleClear(btn) {
  if (!(await confirmAction('очистити все', btn))) return;
  state.form = orchestrator.blankForm();
  state.extraMeta = {};
  state.cardData = {};
  if (state.initialCardMap) {
    for (const id of state.initialCardMap.keys()) {
      state.deletedCardIds.add(id);
    }
  }
  orchestrator.syncFieldsFromForm();
  showGlobalToast('Форму очищено');
}

export async function handleReset(btn) {
  if (!(await confirmAction('скасувати зміни', btn))) return;
  state.form = orchestrator.cloneForm(state.initialForm);
  state.deletedCardIds.clear();
  state.cardData = {};
  if (state.initialCardMap) {
    for (const [id, snapStr] of state.initialCardMap.entries()) {
      const snap = JSON.parse(snapStr);
      if (snap.category !== 'cataclysm') {
        (state.cardData[snap.category] ||= []).push({ id, value: snap.value, meta: snap.meta || {} });
      }
    }
  }
  orchestrator.syncFieldsFromForm();
  showGlobalToast('Зміни скасовано');
}

export async function handleExit(btn) {
  if (isDirty() && !(await confirmAction(btn.textContent.trim().toLowerCase(), btn))) return;
  // Свідоме «Відмінити та вийти»: чернетка не потрібна
  state.skipDraftFlush = true;
  if (state.userId) draftManager.clearDraft(state.packId, state.userId);
  goToList();
}

const SAVE_ACTIONS = {
  save: btn => requestSave(btn),
  clear: btn => handleClear(btn),
  reset: btn => handleReset(btn),
  exit: btn => handleExit(btn)
};

export function handleActionsClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  SAVE_ACTIONS[btn.dataset.action]?.(btn);
}


