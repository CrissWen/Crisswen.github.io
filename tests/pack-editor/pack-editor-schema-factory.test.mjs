import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_SCHEMAS } from '../../js/pack-editor/categories.js';

test('CATEGORY_SCHEMAS defines Variant B primary descriptors and preserves fields for all 17 categories', () => {
  const expected = {
    gender:            { type: 'text',     label: 'Назва' },
    body_type:         { type: 'text',     label: 'Назва' },
    trait:             { type: 'text',     label: 'Назва' },
    profession:        { type: 'text',     label: 'Назва' },
    health:            { type: 'text',     label: 'Назва' },
    hobby:             { type: 'text',     label: 'Назва' },
    phobia:            { type: 'text',     label: 'Назва' },
    large_inventory:   { type: 'textarea', label: 'Предмет' },
    backpack:          { type: 'textarea', label: 'Предмет' },
    items:             { type: 'textarea', label: 'Предмет' },
    special_ability:   { type: 'textarea', label: 'Опис' },
    history:           { type: 'textarea', label: 'Опис' },
    rooms_description: { type: 'textarea', label: 'Опис' },
    problems:          { type: 'textarea', label: 'Опис' },
    extra_info:        { type: 'textarea', label: 'Факт' },
    location:          { type: 'textarea', label: 'Місце' },
    food_supply:       { type: 'textarea', label: 'Примітка' }
  };

  assert.deepEqual(Object.keys(CATEGORY_SCHEMAS).sort(), Object.keys(expected).sort());

  for (const [cat, spec] of Object.entries(expected)) {
    const schema = CATEGORY_SCHEMAS[cat];
    assert.ok(schema.primary, `${cat} must have primary descriptor`);
    assert.equal(schema.primary.type, spec.type, `${cat}.primary.type`);
    assert.equal(schema.primary.label, spec.label, `${cat}.primary.label`);
    assert.ok(
      typeof schema.primary.placeholder === 'string' && schema.primary.placeholder.trim().length > 0,
      `${cat}.primary.placeholder must be non-empty`
    );
    assert.ok(Array.isArray(schema.fields), `${cat}.fields must be an array`);
  }

  for (const stagedCat of ['gender', 'profession', 'health', 'hobby']) {
    assert.ok(
      CATEGORY_SCHEMAS[stagedCat].fields.some(f => f.key === 'stages'),
      `${stagedCat} must retain stages field`
    );
  }
});
