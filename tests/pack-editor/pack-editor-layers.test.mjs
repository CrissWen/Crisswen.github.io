import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_EDITOR_DIR = path.resolve(__dirname, '../../js/pack-editor');
const BINDINGS_DIR = path.join(PACK_EDITOR_DIR, 'bindings');

const bindingFiles = fs.readdirSync(BINDINGS_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort();

for (const fileName of bindingFiles) {
  test(`bindings/${fileName} does not import from ../ui/helpers.js`, () => {
    const src = fs.readFileSync(path.join(BINDINGS_DIR, fileName), 'utf8');
    const importsHelpers = /from\s+['"]\.\.\/ui\/helpers\.js['"]/.test(src);
    assert.equal(
      importsHelpers,
      false,
      `js/pack-editor/bindings/${fileName} must import $ from ../ui/shared.js instead of ../ui/helpers.js`
    );
  });
}

test('bindings/sort-menu.js does not export updateSortBtnUi and editor.js does not import it from sort-menu.js', () => {
  const sortMenuSrc = fs.readFileSync(path.join(BINDINGS_DIR, 'sort-menu.js'), 'utf8');
  const editorSrc = fs.readFileSync(path.join(PACK_EDITOR_DIR, 'editor.js'), 'utf8');
  const controllersBarrelSrc = fs.readFileSync(path.join(PACK_EDITOR_DIR, 'controllers/controllers.js'), 'utf8');
  const uiBarrelSrc = fs.readFileSync(path.join(PACK_EDITOR_DIR, 'ui/ui.js'), 'utf8');

  const exportsUpdateSort =
    /export\s+(?:async\s+)?function\s+updateSortBtnUi\b/.test(sortMenuSrc) ||
    /export\s*\{[^}]*\bupdateSortBtnUi\b/.test(sortMenuSrc);
  assert.equal(
    exportsUpdateSort,
    false,
    'js/pack-editor/bindings/sort-menu.js must not export updateSortBtnUi'
  );

  const importsFromSortMenu =
    /import\s*\{[^}]*\bupdateSortBtnUi\b[^}]*\}\s*from\s*['"]\.\/bindings\/sort-menu\.js['"]/.test(editorSrc);
  assert.equal(
    importsFromSortMenu,
    false,
    'js/pack-editor/editor.js must not import updateSortBtnUi from ./bindings/sort-menu.js'
  );

  assert.match(
    controllersBarrelSrc,
    /export\s+\*\s+from\s+['"]\.\/delete-selection\.js['"]/,
    'controllers/controllers.js must re-export ./delete-selection.js'
  );
  assert.match(
    uiBarrelSrc,
    /export\s+\*\s+from\s+['"]\.\/helpers\.js['"]/,
    'ui/ui.js must re-export ./helpers.js'
  );
});

test('executeBulkDeletion removes selected gender cards, cleans opposite links, marks deleted IDs, and updates form text', async () => {
  const [{ state }, deleteSelection] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/controllers/delete-selection.js')
  ]);

  assert.equal(
    typeof deleteSelection.executeBulkDeletion,
    'function',
    'controllers/delete-selection.js must export executeBulkDeletion'
  );

  const prevCardData = state.cardData;
  const prevTexts = state.form.texts;
  const prevActiveCategory = state.activeCategory;
  const prevNewCataIndex = state.newCataIndex;
  const prevNewDynIndex = state.newDynIndex;
  const origMarkCardDeleted = state.markCardDeleted;

  const deletedIds = [];
  try {
    state.activeCategory = 'gender';
    state.cardData = {
      gender: [
        { id: 'g1', value: 'Чоловіча', meta: {} },
        { id: 'g2', value: 'Жіноча', meta: { opposite: 'Чоловіча' } }
      ]
    };
    state.form.texts = { gender: '' };
    state.newCataIndex = 1;
    state.newDynIndex = 1;
    state.markCardDeleted = (id) => {
      deletedIds.push(id);
    };

    const deletedCount = deleteSelection.executeBulkDeletion({
      toDelete: new Set([0]),
      category: 'gender'
    });

    assert.equal(deletedCount, 1);
    assert.deepEqual(deletedIds, ['g1']);
    assert.equal(state.cardData.gender.length, 1);
    assert.equal(state.cardData.gender[0].value, 'Жіноча');
    assert.equal('opposite' in state.cardData.gender[0].meta, false);
    assert.equal(state.form.texts.gender, 'Жіноча');
    assert.equal(state.newCataIndex, -1);
    assert.equal(state.newDynIndex, -1);
  } finally {
    state.cardData = prevCardData;
    state.form.texts = prevTexts;
    state.activeCategory = prevActiveCategory;
    state.newCataIndex = prevNewCataIndex;
    state.newDynIndex = prevNewDynIndex;
    state.markCardDeleted = origMarkCardDeleted;
  }
});

test('executeBulkDeletion removes selected cataclysms, marks deleted IDs, and syncs cataclysm text', async () => {
  const [{ state }, { executeBulkDeletion }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/controllers/delete-selection.js')
  ]);

  assert.equal(typeof executeBulkDeletion, 'function');

  const prevCataclysms = state.form.cataclysms;
  const prevTexts = state.form.texts;
  const prevActiveCategory = state.activeCategory;
  const prevNewCataIndex = state.newCataIndex;
  const prevNewDynIndex = state.newDynIndex;
  const origMarkCardDeleted = state.markCardDeleted;

  const deletedIds = [];
  try {
    state.activeCategory = 'cataclysm';
    state.form.cataclysms = [
      { id: 'c1', name: 'Потоп', description: 'Вода', timer_minutes: 5, stay_time_months: 12, population: 20, extra: {} },
      { id: 'c2', name: 'Зима', description: 'Мороз', timer_minutes: 5, stay_time_months: 6, population: 15, extra: {} }
    ];
    state.form.texts = { cataclysm: 'Потоп\nЗима' };
    state.newCataIndex = 0;
    state.newDynIndex = 2;
    state.markCardDeleted = (id) => {
      deletedIds.push(id);
    };

    const deletedCount = executeBulkDeletion({
      toDelete: new Set([0]),
      category: 'cataclysm'
    });

    assert.equal(deletedCount, 1);
    assert.deepEqual(deletedIds, ['c1']);
    assert.equal(state.form.cataclysms.length, 1);
    assert.equal(state.form.cataclysms[0].id, 'c2');
    assert.equal(state.form.texts.cataclysm, 'Зима');
    assert.equal(state.newCataIndex, -1);
    assert.equal(state.newDynIndex, -1);
  } finally {
    state.form.cataclysms = prevCataclysms;
    state.form.texts = prevTexts;
    state.activeCategory = prevActiveCategory;
    state.newCataIndex = prevNewCataIndex;
    state.newDynIndex = prevNewDynIndex;
    state.markCardDeleted = origMarkCardDeleted;
  }
});

test('ui/helpers.js exports updateSortBtnUi(dir) pure of state.cardsSortDir and re-exported by ui/ui.js', async () => {
  const [{ state }, helpers, ui] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/ui/helpers.js'),
    import('../../js/pack-editor/ui/ui.js')
  ]);

  assert.equal(typeof helpers.updateSortBtnUi, 'function', 'ui/helpers.js must export updateSortBtnUi');
  assert.equal(ui.updateSortBtnUi, helpers.updateSortBtnUi, 'ui/ui.js must re-export updateSortBtnUi');

  function makeSortItem(dir) {
    const classes = new Set();
    const check = { textContent: '' };
    return {
      dataset: { sortDir: dir },
      classList: {
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains(name) { return classes.has(name); }
      },
      querySelector(sel) { return sel === '.pe-sort-menu__check' ? check : null; },
      check
    };
  }

  const btnClasses = new Set();
  const btnAttrs = {};
  const sortBtn = {
    title: '',
    classList: {
      toggle(name, force) {
        if (force) btnClasses.add(name);
        else btnClasses.delete(name);
      },
      contains(name) { return btnClasses.has(name); }
    },
    setAttribute(k, v) { btnAttrs[k] = v; }
  };

  const items = [makeSortItem('none'), makeSortItem('asc'), makeSortItem('desc')];
  const sortMenu = {
    querySelectorAll(sel) { return sel === '.pe-sort-menu__item' ? items : []; }
  };

  const prevDocument = globalThis.document;
  const prevSortDir = state.cardsSortDir;
  try {
    globalThis.document = {
      getElementById(id) {
        if (id === 'pe-sort-btn') return sortBtn;
        if (id === 'pe-sort-menu') return sortMenu;
        return null;
      }
    };

    // Навмисно ставимо в state інший напрям, щоб перевірити чистоту параметра dir
    state.cardsSortDir = 'desc';
    helpers.updateSortBtnUi('asc');

    assert.equal(btnClasses.has('is-active'), true);
    assert.equal(sortBtn.title, 'Сортувати в порядку Від "А" до "Я"');
    assert.equal(btnAttrs['aria-label'], 'Сортувати в порядку Від "А" до "Я"');
    assert.equal(items[1].classList.contains('is-active'), true);
    assert.equal(items[1].check.textContent, '✓');
    assert.equal(items[2].classList.contains('is-active'), false);
    assert.equal(items[2].check.textContent, '');

    helpers.updateSortBtnUi();
    assert.equal(btnClasses.has('is-active'), false);
    assert.equal(sortBtn.title, 'Сортування списку');
    assert.equal(items[0].classList.contains('is-active'), true);
    assert.equal(items[0].check.textContent, '✓');
  } finally {
    globalThis.document = prevDocument;
    state.cardsSortDir = prevSortDir;
  }
});

const UI_DIR = path.join(PACK_EDITOR_DIR, 'ui');
const uiFiles = fs.readdirSync(UI_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort();

for (const fileName of uiFiles) {
  test(`ui/${fileName} does not import state.js`, () => {
    const src = fs.readFileSync(path.join(UI_DIR, fileName), 'utf8');
    const importsState = /from\s+['"][^'"]*state\.js['"]|import\s*\(\s*['"][^'"]*state\.js['"]\s*\)/.test(src);
    assert.equal(
      importsState,
      false,
      `js/pack-editor/ui/${fileName} must be pure DOM/rendering and must not import state.js`
    );
  });
}

function makeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...names) { names.forEach(n => classes.add(n)); },
    remove(...names) { names.forEach(n => classes.delete(n)); },
    toggle(name, force) {
      if (force === undefined) {
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name); return true;
      }
      if (force) classes.add(name);
      else classes.delete(name);
      return Boolean(force);
    },
    contains(name) { return classes.has(name); }
  };
}

test('ui/dynamic.js renderDynamicFormFields(schema, activeCategory) uses activeCategory param and ignores state.activeCategory', async () => {
  const [{ state }, { CATEGORY_SCHEMAS }, { renderDynamicFormFields }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/categories.js'),
    import('../../js/pack-editor/ui/dynamic.js')
  ]);

  const container = { innerHTML: '', querySelectorAll: () => [] };
  const prevDocument = globalThis.document;
  const prevActiveCategory = state.activeCategory;
  try {
    globalThis.document = {
      readyState: 'complete',
      getElementById(id) { return id === 'pe-dyn-fields' ? container : null; },
      querySelectorAll: () => []
    };

    state.activeCategory = 'gender';
    renderDynamicFormFields(CATEGORY_SCHEMAS.profession, 'profession');
    assert.match(container.innerHTML, /data-dyn-stage-list="profession"/);
    assert.doesNotMatch(container.innerHTML, /pe-dyn-gender-stages-wrap/);

    state.activeCategory = 'profession';
    renderDynamicFormFields(CATEGORY_SCHEMAS.gender, 'gender');
    assert.match(container.innerHTML, /pe-dyn-gender-stages-wrap/);
    assert.doesNotMatch(container.innerHTML, /data-dyn-stage-list="profession"/);
  } finally {
    globalThis.document = prevDocument;
    state.activeCategory = prevActiveCategory;
  }
});

test('ui/helpers.js showCategory uses category and ageCategoriesText params and ignores state', async () => {
  const [{ state }, { showCategory }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/ui/helpers.js')
  ]);

  const dynFields = { innerHTML: '', querySelectorAll: () => [] };
  const genderStageContainer = {
    innerHTML: '',
    querySelectorAll: (sel) => (sel === '.pe-stage-row'
      ? [{
          classList: makeClassList(),
          querySelector: (s) => (s === '.pe-stage-name' ? { value: '' } : null)
        }]
      : [])
  };
  const llmToggleWrap = { classList: makeClassList() };
  const formCol = { hidden: false };
  const elements = {
    'pe-cat-breadcrumb': { textContent: '' },
    'pe-cat-title': { textContent: '' },
    'pe-dyn-category-label': { textContent: '' },
    'pe-cards': { value: '', placeholder: '', hidden: false, scrollTop: 10 },
    'pe-llm-mode': { disabled: false, checked: false, closest: () => llmToggleWrap },
    'pe-llm-slot': { classList: makeClassList() },
    'pe-cata-list-wrap': { hidden: false },
    'pe-cata-list': { hidden: false },
    'pe-cata': { hidden: false, closest: () => formCol },
    'pe-dynamic-form': { hidden: true },
    'pe-dyn-name-wrap': { innerHTML: '' },
    'pe-dyn-name': null,
    'pe-dyn-fields': dynFields,
    'pe-bulk-delete-btn': { hidden: false },
    'pe-sort-wrap': { hidden: false }
  };

  const prevDocument = globalThis.document;
  const prevActiveCategory = state.activeCategory;
  const prevStages = state.form.stages;
  try {
    globalThis.document = {
      readyState: 'complete',
      getElementById(id) { return elements[id] ?? null; },
      querySelector(sel) { return sel === '[data-dyn-stage-list="gender"]' ? genderStageContainer : null; },
      querySelectorAll: () => []
    };

    state.activeCategory = 'profession';
    state.form.stages = { age_categories: 'Старість (від 60)' };

    showCategory({
      category: 'gender',
      text: 'Чоловіча',
      viewMode: 'visual',
      ageCategoriesText: 'Юність (до 25)'
    });

    assert.match(dynFields.innerHTML, /pe-dyn-gender-stages-wrap/);
    assert.match(genderStageContainer.innerHTML, /Юність/);
    assert.doesNotMatch(genderStageContainer.innerHTML, /Старість/);
  } finally {
    globalThis.document = prevDocument;
    state.activeCategory = prevActiveCategory;
    state.form.stages = prevStages;
  }
});

test('ui/helpers.js setDeleteModeUi uses activeCategory param and ignores state.activeCategory', async () => {
  const [{ state }, { setDeleteModeUi }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/ui/helpers.js')
  ]);

  function makeForm() {
    const el = {
      classList: makeClassList(),
      children: [],
      appendChild(child) {
        child.parentElement = el;
        el.children.push(child);
      }
    };
    return el;
  }

  const cataForm = makeForm();
  const dynForm = makeForm();
  const deleteOverlay = { hidden: true, parentElement: null };
  const submitBtn = { disabled: false, querySelector: () => null, textContent: '' };
  const bulkBtn = { classList: makeClassList(), title: '', setAttribute() {} };
  const elements = {
    'pe-delete-toolbar': { hidden: true },
    'pe-bulk-delete-btn': bulkBtn,
    'pe-delete-overlay': deleteOverlay,
    'pe-cata-list-wrap': { classList: makeClassList() },
    'pe-cata': cataForm,
    'pe-dynamic-form': dynForm,
    'pe-fab-back': { hidden: false },
    'pe-sort-btn': { disabled: false, setAttribute() {} },
    'pe-sort-menu': { hidden: false },
    'pe-delete-count': { textContent: '' },
    'pe-delete-submit-btn': submitBtn,
    'pe-delete-select-all-btn': { textContent: '' }
  };

  const prevDocument = globalThis.document;
  const prevActiveCategory = state.activeCategory;
  try {
    globalThis.document = {
      getElementById(id) { return elements[id] ?? null; },
      querySelector: () => null
    };

    state.activeCategory = 'cataclysm';
    setDeleteModeUi({
      isDeleteMode: true,
      selectedCount: 1,
      totalCount: 2,
      activeCategory: 'profession'
    });

    assert.equal(deleteOverlay.parentElement, dynForm);
    assert.equal(dynForm.classList.contains('is-delete-disabled'), true);
    assert.equal(cataForm.classList.contains('is-delete-disabled'), false);

    state.activeCategory = 'profession';
    setDeleteModeUi({
      isDeleteMode: true,
      selectedCount: 1,
      totalCount: 2,
      activeCategory: 'cataclysm'
    });

    assert.equal(deleteOverlay.parentElement, cataForm);
    assert.equal(cataForm.classList.contains('is-delete-disabled'), true);
  } finally {
    globalThis.document = prevDocument;
    state.activeCategory = prevActiveCategory;
  }
});

test('ui/cataclysm.js renderCataList uses cardsSortDir, isDeleteMode, selectedDeleteIndices params and ignores state', async () => {
  const [{ state }, { renderCataList }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/ui/cataclysm.js')
  ]);

  const listEl = { innerHTML: '', querySelector: () => null };
  const prevDocument = globalThis.document;
  const prevSortDir = state.cardsSortDir;
  const prevDeleteMode = state.isDeleteMode;
  const prevSelected = state.selectedDeleteIndices;
  try {
    globalThis.document = {
      activeElement: null,
      getElementById(id) { return id === 'pe-cata-list' ? listEl : null; }
    };

    state.cardsSortDir = 'asc';
    state.isDeleteMode = false;
    state.selectedDeleteIndices = new Set([0]);

    renderCataList({
      cataclysms: [{ name: 'Альфа' }, { name: 'Ялта' }],
      editIndex: 0,
      newIndex: -1,
      tokens: [],
      category: 'cataclysm',
      cardsSortDir: 'desc',
      isDeleteMode: true,
      selectedDeleteIndices: new Set([1])
    });

    const yaltaPos = listEl.innerHTML.indexOf('Ялта');
    const alphaPos = listEl.innerHTML.indexOf('Альфа');
    assert.ok(yaltaPos !== -1 && alphaPos !== -1 && yaltaPos < alphaPos, 'must sort desc using param');
    assert.match(listEl.innerHTML, /class="added-item-row is-delete-mode is-marked-delete" data-cata-index="1" aria-pressed="true"/);
    assert.match(listEl.innerHTML, /class="added-item-row is-delete-mode" data-cata-index="0" aria-pressed="false"/);
  } finally {
    globalThis.document = prevDocument;
    state.cardsSortDir = prevSortDir;
    state.isDeleteMode = prevDeleteMode;
    state.selectedDeleteIndices = prevSelected;
  }
});

test('ui/search.js paintSearch uses activeCategory, isDeleteMode, selectedDeleteIndices from view and ignores state', async () => {
  const [{ state }, { paintSearch }] = await Promise.all([
    import('../../js/pack-editor/state.js'),
    import('../../js/pack-editor/ui/search.js')
  ]);

  const panelEl = { hidden: true, innerHTML: '' };
  const countEl = { textContent: '' };
  const clearEl = { hidden: true };
  const prevDocument = globalThis.document;
  const prevActiveCategory = state.activeCategory;
  const prevDeleteMode = state.isDeleteMode;
  const prevSelected = state.selectedDeleteIndices;
  try {
    globalThis.document = {
      getElementById(id) {
        if (id === 'pe-search-results') return panelEl;
        if (id === 'pe-search-count') return countEl;
        if (id === 'pe-search-clear') return clearEl;
        return null;
      }
    };

    state.activeCategory = 'hobby';
    state.isDeleteMode = false;
    state.selectedDeleteIndices = new Set();

    paintSearch({
      query: 'test',
      tokens: ['test'],
      searchAll: true,
      mode: 'results',
      total: 2,
      results: [
        { type: 'text', category: 'profession', label: 'Професія', line: 0, cardIndex: 0, text: 'testA' },
        { type: 'text', category: 'hobby', label: 'Хобі', line: 0, cardIndex: 0, text: 'testB' }
      ],
      activeCategory: 'profession',
      isDeleteMode: true,
      selectedDeleteIndices: new Set([0])
    });

    assert.match(panelEl.innerHTML, /class="added-item-row pe-result is-delete-mode is-marked-delete" data-res-cat="profession"[^>]*aria-pressed="true"/);
    assert.match(panelEl.innerHTML, /class="added-item-row pe-result" data-res-cat="hobby"[^>]*aria-pressed="false"/);
  } finally {
    globalThis.document = prevDocument;
    state.activeCategory = prevActiveCategory;
    state.isDeleteMode = prevDeleteMode;
    state.selectedDeleteIndices = prevSelected;
  }
});
