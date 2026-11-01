import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCards } from '../../js/pack-editor/parser.js';

test('reconcileCards: preserves card UUID on in-place edit instead of deleting and recreating (I-10)', () => {
  const existing = [
    { id: 'uuid-1', value: 'Лікар', meta: { ability: 'Лікує людей' } },
    { id: 'uuid-2', value: 'Інженер', meta: { ability: 'Ремонтує бункер' } },
    { id: 'uuid-3', value: 'Кухар', meta: { ability: 'Готує їжу' } }
  ];
  const deletedIds = new Set();

  // Користувач виправив друкарську помилку або уточнив назву другої картки на тій самій позиції
  const newText = [
    'Лікар - Лікує людей',
    'Головний інженер - Ремонтує бункер',
    'Кухар - Готує їжу'
  ].join('\n');

  const reconciled = reconcileCards(newText, existing, 'profession', {}, deletedIds);

  assert.equal(reconciled.length, 3);
  assert.equal(reconciled[0].id, 'uuid-1');
  assert.equal(reconciled[1].id, 'uuid-2', 'Edited card at index 1 must keep its original UUID');
  assert.equal(reconciled[1].value, 'Головний інженер');
  assert.equal(reconciled[2].id, 'uuid-3');
  assert.equal(deletedIds.has('uuid-2'), false, 'Edited card UUID must not be marked as deleted');
});

