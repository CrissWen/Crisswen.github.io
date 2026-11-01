import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForm, canonicalCardSnapshot } from '../../js/pack-editor/payload.js';
import { state } from '../../js/pack-editor/state.js';
import { draftManager, DRAFT_PREFIX } from '../../js/pack-editor/draft-manager.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    get length() { return store.size; },
    key(i) { return Array.from(store.keys())[i] ?? null; },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };
}

test('payload: normalizeForm detects changes in cataclysm.extra (I-4)', () => {
  const baseForm = {
    title: 'Пак',
    description: '',
    texts: {},
    stages: {},
    ranges: {},
    cataclysms: [
      { id: 'c1', name: 'Потоп', description: 'Вода', timer_minutes: 5, stay_time_months: 12, population: 20, extra: { severity: 'high' } }
    ]
  };
  const modifiedExtraForm = {
    ...baseForm,
    cataclysms: [
      { id: 'c1', name: 'Потоп', description: 'Вода', timer_minutes: 5, stay_time_months: 12, population: 20, extra: { severity: 'extreme' } }
    ]
  };

  assert.notEqual(
    normalizeForm(baseForm),
    normalizeForm(modifiedExtraForm),
    'normalizeForm must include cataclysm.extra so edits to extra mark form dirty'
  );
});

test('payload: canonicalCardSnapshot is independent of meta key insertion order (Minor 4 & Minor 5)', () => {
  const cardA = {
    pool_type: 'character',
    category: 'gender',
    value: 'Чоловік',
    meta: { opposite: 'Жінка', custom_age: 'Без віку', has_no_age: true }
  };
  const cardB = {
    pool_type: 'character',
    category: 'gender',
    value: 'Чоловік',
    meta: { has_no_age: true, opposite: 'Жінка', custom_age: 'Без віку' }
  };

  assert.equal(
    canonicalCardSnapshot(cardA),
    canonicalCardSnapshot(cardB),
    'canonicalCardSnapshot must produce identical JSON regardless of meta key order'
  );
});

test('draftManager: clearing both "new" and savedId removes zombie _new draft after creating a new pack (I-9)', () => {
  globalThis.localStorage = createMemoryStorage();
  const userId = 'user-123';
  const savedId = 'pack-uuid-999';

  // Користувач створює новий пак (packId = null -> пишеться у truebunker_draft_user-123_new)
  draftManager.saveDraft({
    immediate: true,
    packId: null,
    userId,
    state: {
      title: 'Новий пак',
      description: '',
      config: {},
      dirtyCategories: ['profession'],
      categories: { profession: [{ id: 'c1', value: 'Лікар', meta: {} }] },
      deletedCardIds: []
    }
  });

  assert.ok(localStorage.getItem(`${DRAFT_PREFIX}${userId}_new`), 'Draft under _new key must exist before save');

  // Після успішного збереження нового пака очищаємо і 'new', і savedId
  draftManager.clearDraft('new', userId);
  draftManager.clearDraft(savedId, userId);

  assert.equal(localStorage.getItem(`${DRAFT_PREFIX}${userId}_new`), null, 'Zombie _new draft must be removed');
  assert.equal(draftManager.checkDraftStatus(null, userId, null), 'NONE');
});

test('EditorState: tracks sessionId and stable newPackId for idempotent new pack creation (E-C1, E-C2)', () => {
  assert.equal(typeof state.sessionId, 'number');
  assert.ok('newPackId' in state);
});
