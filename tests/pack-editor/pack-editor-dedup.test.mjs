import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalCardDedupKey,
  deduplicateStageLines,
  parseCards,
  reconcileCards
} from '../../js/pack-editor/parser.js';
import { buildPackConfig } from '../../js/pack-editor/payload.js';
import { findFullDuplicateIndex } from '../../js/pack-editor/controllers/dynamic.js';

test('canonicalCardDedupKey ігнорує регістр, зайві пробіли та порядок ключів у meta', () => {
  const k1 = canonicalCardDedupKey('gender', 'Чоловік', { can_reproduce: true, opposite: 'Жінка' });
  const k2 = canonicalCardDedupKey('gender', '  чоловік ', { opposite: 'Жінка', can_reproduce: true });
  assert.equal(k1, k2);

  const kDiffMeta = canonicalCardDedupKey('gender', 'Чоловік', { can_reproduce: false, opposite: 'Жінка' });
  assert.notEqual(k1, kDiffMeta);
});

test('parseCards та reconcileCards видаляють повні дублікати, але зберігають картки з однаковою назвою і різною meta', () => {
  const text = [
    'Лікар - Лікує людей',
    'лікар - лікує людей',
    'Лікар - Проводить операції',
    'Інженер - Лагодить генератор',
    'Інженер - Лагодить генератор'
  ].join('\n');

  const parsed = parseCards(text, 'profession');
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].value, 'Лікар');
  assert.equal(parsed[0].meta.ability, 'Лікує людей');
  assert.equal(parsed[1].meta.ability, 'Проводить операції');
  assert.equal(parsed[2].value, 'Інженер');

  const existing = [
    { id: 'uuid-doc', value: 'Лікар', meta: { ability: 'Лікує людей' } },
    { id: 'uuid-eng', value: 'Інженер', meta: { ability: 'Лагодить генератор' } }
  ];
  const deletedIds = new Set();
  const reconciled = reconcileCards(text, existing, 'profession', {}, deletedIds);
  assert.equal(reconciled.length, 3);
  assert.equal(reconciled[0].id, 'uuid-doc');
  assert.equal(reconciled[2].id, 'uuid-eng');
  assert.equal(deletedIds.size, 0);
});

test('deduplicateStageLines та buildPackConfig прибирають повні дублікати стадій', () => {
  const deduped = deduplicateStageLines('profession', 'Новачок: 11\nновачок: 11\nСтажер: 35\nСтажер: 35');
  assert.equal(deduped, 'Новачок: 11\nСтажер: 35');

  const cfg = buildPackConfig({
    stages: {
      age_categories: 'Молодий: 34\nмолодий: 34',
      profession: 'Новачок: 11\nНовачок: 11',
      hobby: '',
      health: 'Легка\nлегка',
      body_type: ''
    },
    ranges: { ageMin: '18', ageMax: '70', heightMin: '150', heightMax: '200' }
  });
  assert.equal(cfg.age_categories.length, 1);
  assert.equal(cfg.default_stages.profession.length, 1);
  assert.equal(cfg.default_stages.health.length, 1);
});


test('findFullDuplicateIndex виявляє повний дублікат у динамічній категорії та ігнорує власний індекс при редагуванні', () => {
  const cards = [
    { id: '1', value: 'Лікар', meta: { ability: 'Лікує людей' } },
    { id: '2', value: 'Інженер', meta: { ability: 'Лагодить бункер' } }
  ];

  // Повний дублікат (інший регістр) -> індекс 0
  assert.equal(findFullDuplicateIndex('profession', 'лікар', { ability: 'лікує людей' }, cards, -1), 0);

  // Та сама назва, але інша здібність -> НЕ дублікат (-1)
  assert.equal(findFullDuplicateIndex('profession', 'Лікар', { ability: 'Хірург' }, cards, -1), -1);

  // Редагування тієї ж самої картки (excludeIndex = 0) -> НЕ дублікат (-1)
  assert.equal(findFullDuplicateIndex('profession', 'Лікар', { ability: 'Лікує людей' }, cards, 0), -1);

  // Зміна картки #1 на повний дублікат картки #0 -> індекс 0
  assert.equal(findFullDuplicateIndex('profession', 'Лікар', { ability: 'Лікує людей' }, cards, 1), 0);
});
