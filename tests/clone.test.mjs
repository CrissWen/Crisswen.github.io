import test from 'node:test';
import assert from 'node:assert/strict';
import { clone } from '../js/utils/clone.js';

test('clone: returns undefined for undefined input', () => {
  assert.equal(clone(undefined), undefined);
});

test('clone: creates an independent deep copy of objects and arrays', () => {
  const original = {
    title: 'Пак',
    items: [{ id: 1, name: 'Картка' }],
    nested: { a: 10 }
  };
  const copied = clone(original);

  assert.deepEqual(copied, original);
  assert.notEqual(copied, original);
  assert.notEqual(copied.items, original.items);
  assert.notEqual(copied.items[0], original.items[0]);
  assert.notEqual(copied.nested, original.nested);

  copied.items[0].name = 'Змінена';
  assert.equal(original.items[0].name, 'Картка');
});

test('clone: falls back gracefully when structuredClone is unsupported or throws', () => {
  const origStructured = globalThis.structuredClone;
  try {
    globalThis.structuredClone = () => { throw new Error('Mock structuredClone fail'); };
    const obj = { x: 42, text: 'hello' };
    const copy = clone(obj);
    assert.deepEqual(copy, obj);
    assert.notEqual(copy, obj);
  } finally {
    globalThis.structuredClone = origStructured;
  }
});

