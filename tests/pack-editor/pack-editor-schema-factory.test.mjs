import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('updateDynamicNameField updates label and placeholder across consecutive textarea categories and preserves value', async () => {
  const { updateDynamicNameField } = await import('../../js/pack-editor/ui/helpers.js');

  const wrap = { innerHTML: '' };
  let currentNameEl = { tagName: 'INPUT', value: 'Збережений текст' };
  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === 'pe-dyn-name-wrap') return wrap;
      if (id === 'pe-dyn-name') return currentNameEl;
      return null;
    }
  };

  try {
    updateDynamicNameField('profession');
    assert.match(wrap.innerHTML, /<input[^>]*id="pe-dyn-name"/);
    assert.match(wrap.innerHTML, />Назва\s*</);

    currentNameEl = { tagName: 'TEXTAREA', value: 'Тест' };
    updateDynamicNameField('history');
    assert.match(wrap.innerHTML, /<textarea[^>]*id="pe-dyn-name"/);
    assert.match(wrap.innerHTML, />Опис\s*</);
    assert.equal(currentNameEl.value, 'Тест');

    updateDynamicNameField('location');
    assert.match(wrap.innerHTML, />Місце\s*</);

    updateDynamicNameField('food_supply');
    assert.match(wrap.innerHTML, />Примітка\s*</);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('ui/dynamic.js uses Strategy Maps without if/else field-type ladders and constants.js drops MULTILINE_NAME_CATEGORIES', async () => {
  const dynamicSrc = fs.readFileSync(path.resolve('js/pack-editor/ui/dynamic.js'), 'utf8');
  const constantsSrc = fs.readFileSync(path.resolve('js/pack-editor/ui/constants.js'), 'utf8');

  assert.doesNotMatch(dynamicSrc, /if\s*\(\s*f\.type\s*===/);
  assert.doesNotMatch(constantsSrc, /MULTILINE_NAME_CATEGORIES/);

  const { renderDynamicFormFields } = await import('../../js/pack-editor/ui/dynamic.js');
  const container = {
    innerHTML: '',
    querySelectorAll: () => []
  };
  const prevDoc = globalThis.document;
  globalThis.document = {
    readyState: 'complete',
    getElementById: (id) => (id === 'pe-dyn-fields' ? container : null),
    querySelectorAll: () => []
  };

  try {
    renderDynamicFormFields(CATEGORY_SCHEMAS.profession, 'profession');
    assert.match(container.innerHTML, /<textarea[^>]*id="pe-dyn-ability"/);
    assert.match(container.innerHTML, /data-dyn-stage-list="profession"/);
  } finally {
    globalThis.document = prevDoc;
  }
});
