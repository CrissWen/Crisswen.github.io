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
