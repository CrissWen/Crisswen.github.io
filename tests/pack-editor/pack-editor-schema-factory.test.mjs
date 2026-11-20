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

  let currentNameEl = { value: 'Збережений текст' };
  const wrap = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(val) {
      this._html = val;
      // Simulate real DOM: replacing innerHTML creates a fresh empty #pe-dyn-name node
      currentNameEl = { value: '' };
    }
  };
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
    assert.match(wrap.innerHTML, /placeholder="Введіть назву"/);
    assert.equal(currentNameEl.value, 'Збережений текст');

    for (const [cat, label, placeholder] of [
      ['history',     'Опис',     'Опишіть, як і де був побудований бункер'],
      ['location',    'Місце',    'Вкажіть місце розташування бункера'],
      ['items',       'Предмет',  'Вкажіть предмети в бункері'],
      ['extra_info',  'Факт',     'Введіть факт або відомість'],
      ['food_supply', 'Примітка', 'Вкажіть стан або обсяг запасів']
    ]) {
      const prevVal = currentNameEl.value;
      updateDynamicNameField(cat);
      assert.match(wrap.innerHTML, /<textarea[^>]*id="pe-dyn-name"/, `${cat} must render textarea`);
      assert.match(wrap.innerHTML, new RegExp(`>${label}\\s*<`), `${cat} label`);
      assert.match(wrap.innerHTML, new RegExp(`placeholder="${placeholder}"`), `${cat} placeholder`);
      assert.equal(currentNameEl.value, prevVal, `${cat} must preserve value across re-render`);
    }
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

test('submitDyn uses schema.primary.label in required-field validation error', async () => {
  const { state } = await import('../../js/pack-editor/state.js');
  const { submitDyn } = await import('../../js/pack-editor/controllers/dynamic.js');

  const nameEl = {
    value: '   ',
    classList: { add() {}, remove() {} },
    focus() {}
  };
  const errEl = { textContent: '', hidden: true };

  const prevDoc = globalThis.document;
  const prevCat = state.activeCategory;
  globalThis.document = {
    getElementById(id) {
      if (id === 'pe-dyn-name') return nameEl;
      if (id === 'pe-dyn-error') return errEl;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => []
  };

  try {
    state.activeCategory = 'location';
    submitDyn();
    assert.equal(errEl.hidden, false);
    assert.equal(errEl.textContent, "Поле «Місце» обов'язкове");

    state.activeCategory = 'food_supply';
    submitDyn();
    assert.equal(errEl.textContent, "Поле «Примітка» обов'язкове");
  } finally {
    globalThis.document = prevDoc;
    state.activeCategory = prevCat;
  }
});
