import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectSearchResults,
  matchesTokens,
  cataMatches,
  hasCustomCardProps
} from '../../js/pack-editor/search.js';

test('visual mode strips LLM tags and does not match technical keys or stage numbers', () => {
  const categories = [{ category: 'gender', label: 'Стать' }];
  const texts = {
    gender: 'Чоловік {rep: true, opp: "Жінка", age_min: 18} [Юнак: 20]'
  };

  const cleanRes = collectSearchResults({
    categories,
    texts,
    cataclysms: [],
    tokens: ['чоловік'],
    viewMode: 'visual'
  });
  assert.equal(cleanRes.total, 1);
  assert.equal(cleanRes.results[0].text, 'Чоловік');
  assert.equal(cleanRes.results[0].detail, '');

  for (const techToken of ['rep', 'true', 'age_min', 'юнак', '20', 'жінка']) {
    const res = collectSearchResults({
      categories,
      texts,
      cataclysms: [],
      tokens: [techToken],
      viewMode: 'visual'
    });
    assert.equal(res.total, 0, `visual mode must not match LLM token "${techToken}"`);
  }
});

test('visual mode extracts profession ability / phobia explanation into detail and respects namesOnly', () => {
  const categories = [
    { category: 'profession', label: 'Професія' },
    { category: 'phobia', label: 'Фобія' }
  ];
  const texts = {
    profession: 'Лікар - Лікує хвороби [Інтерн: 12]',
    phobia: 'Арахнофобія - Страх павуків'
  };

  const profByDetail = collectSearchResults({
    categories,
    texts,
    cataclysms: [],
    tokens: ['хвороби'],
    viewMode: 'visual',
    namesOnly: false
  });
  assert.equal(profByDetail.total, 1);
  assert.equal(profByDetail.results[0].text, 'Лікар');
  assert.equal(profByDetail.results[0].detail, 'Лікує хвороби');

  const phobiaByDetail = collectSearchResults({
    categories,
    texts,
    cataclysms: [],
    tokens: ['павуків'],
    viewMode: 'visual',
    namesOnly: false
  });
  assert.equal(phobiaByDetail.total, 1);
  assert.equal(phobiaByDetail.results[0].text, 'Арахнофобія');
  assert.equal(phobiaByDetail.results[0].detail, 'Страх павуків');

  const excludedByNamesOnly = collectSearchResults({
    categories,
    texts,
    cataclysms: [],
    tokens: ['хвороби'],
    viewMode: 'visual',
    namesOnly: true
  });
  assert.equal(excludedByNamesOnly.total, 0);
});

test('llm mode searches raw lines when namesOnly is false', () => {
  const categories = [{ category: 'profession', label: 'Професія' }];
  const texts = {
    profession: 'Лікар - Лікує хвороби [Інтерн: 12]'
  };

  const res = collectSearchResults({
    categories,
    texts,
    cataclysms: [],
    tokens: ['інтерн'],
    viewMode: 'llm'
  });
  assert.equal(res.total, 1);
  assert.equal(res.results[0].text, 'Лікар - Лікує хвороби [Інтерн: 12]');
});

test('wholeWord matches whole Unicode words and rejects partial substrings', () => {
  assert.equal(matchesTokens('Новий рік', ['рік'], { wholeWord: true }), true);
  assert.equal(matchesTokens('Лікар', ['рік'], { wholeWord: true }), false);
  assert.equal(matchesTokens('Лікар', ['кар'], { wholeWord: true }), false);
  assert.equal(matchesTokens("Комп'ютер", ["комп'ютер"], { wholeWord: true }), true);
  assert.equal(
    cataMatches({ name: 'Старий лікар', description: 'Опис' }, ['кар'], { wholeWord: true }),
    false
  );
});

test('customOnly filters cards with custom properties even with empty tokens', () => {
  assert.equal(hasCustomCardProps('profession', { meta: { ability: 'Лікує' } }), true);
  assert.equal(hasCustomCardProps('profession', { meta: {} }), false);
  assert.equal(hasCustomCardProps('phobia', { explanation: 'Страх' }), true);
  assert.equal(hasCustomCardProps('phobia', { explanation: '' }), false);
  assert.equal(hasCustomCardProps('cataclysm', { item: { extra: { severity: 'high' } } }), true);
  assert.equal(hasCustomCardProps('cataclysm', { item: { extra: {} } }), false);

  const categories = [
    { category: 'profession', label: 'Професія' },
    { category: 'cataclysm', label: 'Катаклізм' }
  ];
  const texts = {
    profession: 'Пекар\nЛікар - Лікує хвороби\nВодій [Стажер: 6]'
  };
  const cataclysms = [
    { name: 'Звичайний потоп', description: 'Вода', extra: {} },
    { name: 'Особливий метеорит', description: 'Камінь', extra: { mode: 'hard' } }
  ];

  const res = collectSearchResults({
    categories,
    texts,
    cataclysms,
    tokens: [],
    viewMode: 'visual',
    customOnly: true
  });
  assert.equal(res.total, 3);
  assert.deepEqual(
    res.results.map(r => (r.type === 'cata' ? r.item.name : r.text)),
    ['Лікар', 'Водій', 'Особливий метеорит']
  );
});

test('packEditorTemplate renders search settings button, group menu, and 4 filter checkboxes', async () => {
  const { packEditorTemplate } = await import('../../js/pack-editor/ui/template.js');
  const html = packEditorTemplate({ isEdit: false, isDefaultEdit: false });

  assert.match(html, /id="pe-search-settings-btn"/);
  assert.match(html, /aria-controls="pe-search-settings-menu"/);
  assert.match(html, /id="pe-search-settings-menu"[^>]*role="group"/);
  assert.doesNotMatch(html, /id="pe-search-settings-btn"[^>]*aria-haspopup=/);
  assert.doesNotMatch(html, /id="pe-search-settings-menu"[^>]*role="menu"/);

  for (const id of ['pe-search-all', 'pe-search-names-only', 'pe-search-whole-word', 'pe-search-custom-only']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('paintSearch renders detail snippet for text results and updates settings badge', async () => {
  const { paintSearch } = await import('../../js/pack-editor/ui/search.js');

  const panelEl = { hidden: true, innerHTML: '' };
  const countEl = { textContent: '' };
  const clearEl = { hidden: true };
  const badgeEl = { hidden: true, textContent: '' };
  const btnEl = {
    classList: {
      active: false,
      toggle(cls, force) { if (cls === 'is-active') this.active = Boolean(force); }
    }
  };

  const prevDoc = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      if (id === 'pe-search-results') return panelEl;
      if (id === 'pe-search-count') return countEl;
      if (id === 'pe-search-clear') return clearEl;
      if (id === 'pe-search-settings-badge') return badgeEl;
      if (id === 'pe-search-settings-btn') return btnEl;
      return null;
    }
  };

  try {
    paintSearch({
      mode: 'results',
      query: '',
      tokens: [],
      searchAll: true,
      namesOnly: false,
      wholeWord: true,
      customOnly: true,
      activeCategory: 'profession',
      isDeleteMode: false,
      selectedDeleteIndices: new Set(),
      total: 1,
      results: [
        {
          type: 'text',
          category: 'profession',
          label: 'Професія',
          line: 0,
          cardIndex: 0,
          text: 'Лікар',
          detail: 'Лікує хвороби'
        }
      ]
    });

    assert.equal(panelEl.hidden, false);
    assert.equal(clearEl.hidden, false, 'clear button must be visible when customOnly is active even if query is empty');
    assert.equal(badgeEl.hidden, false);
    assert.equal(badgeEl.textContent, '3');
    assert.equal(btnEl.classList.active, true);
    assert.match(panelEl.innerHTML, /pe-result__snippet/);
    assert.match(panelEl.innerHTML, /Лікує хвороби/);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('controllers/search.js activates on customOnly, hides overlay on normal result click, and binds all listeners with signal', async () => {
  const { state } = await import('../../js/pack-editor/state.js');
  const {
    renderSearch,
    onSearchResultClick,
    initSearch,
    setSearchOrchestrator,
    cataFilterActive
  } = await import('../../js/pack-editor/controllers/search.js');

  const makeEl = (id) => {
    const listeners = [];
    return {
      id,
      value: '',
      checked: false,
      hidden: true,
      textContent: '',
      innerHTML: '',
      attributes: new Map(),
      classList: { toggle() {} },
      setAttribute(k, v) { this.attributes.set(k, String(v)); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
      focus() {},
      closest() { return null; },
      listeners
    };
  };

  const els = {
    'pe-search': makeEl('pe-search'),
    'pe-search-clear': makeEl('pe-search-clear'),
    'pe-search-all': makeEl('pe-search-all'),
    'pe-search-names-only': makeEl('pe-search-names-only'),
    'pe-search-whole-word': makeEl('pe-search-whole-word'),
    'pe-search-custom-only': makeEl('pe-search-custom-only'),
    'pe-search-settings-btn': makeEl('pe-search-settings-btn'),
    'pe-search-settings-menu': makeEl('pe-search-settings-menu'),
    'pe-search-settings-badge': makeEl('pe-search-settings-badge'),
    'pe-search-results': makeEl('pe-search-results'),
    'pe-search-count': makeEl('pe-search-count'),
    'pe-cata-list': makeEl('pe-cata-list')
  };
  const docListeners = [];
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;

  globalThis.document = {
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    addEventListener: (type, fn, opts) => docListeners.push({ type, fn, opts }),
    activeElement: null
  };
  globalThis.window = {
    addEventListener() {},
    matchMedia: () => ({ matches: false })
  };

  const prevState = {
    activeCategory: state.activeCategory,
    viewMode: state.viewMode,
    searchQuery: state.searchQuery,
    searchAll: state.searchAll,
    searchNamesOnly: state.searchNamesOnly,
    searchWholeWord: state.searchWholeWord,
    searchCustomOnly: state.searchCustomOnly,
    isDeleteMode: state.isDeleteMode,
    texts: state.form.texts,
    cataclysms: state.form.cataclysms
  };

  try {
    state.activeCategory = 'cataclysm';
    state.viewMode = 'visual';
    state.searchQuery = 'Потоп';
    state.searchAll = false;
    assert.equal(cataFilterActive(), false, 'Option 1B must keep cataFilterActive() false');

    state.activeCategory = 'profession';
    state.searchQuery = '';
    state.searchCustomOnly = true;
    state.form.texts = { profession: 'Пекар\nЛікар - Лікує хвороби' };
    renderSearch();
    assert.equal(els['pe-search-results'].hidden, false, 'customOnly with empty query must show results overlay');
    assert.match(els['pe-search-results'].innerHTML, /Лікар/);
    assert.doesNotMatch(els['pe-search-results'].innerHTML, /Пекар/);

    let dynEdited = false;
    setSearchOrchestrator({
      getDynamicCards: () => [{ id: '1', value: 'Пекар', meta: {} }, { id: '2', value: 'Лікар', meta: { ability: 'Лікує хвороби' } }],
      dynDraftPending: () => false,
      startDynEdit: () => { dynEdited = true; }
    });

    state.isDeleteMode = false;
    const row = { dataset: { resCat: 'profession', resLine: '1', resCard: '1' } };
    onSearchResultClick({ target: { closest: (sel) => (sel === '.pe-result' ? row : null) } });
    assert.equal(dynEdited, true);
    assert.equal(els['pe-search-results'].hidden, true, 'clicking result in normal mode must hide overlay');

    els['pe-search-results'].hidden = false;
    state.isDeleteMode = true;
    onSearchResultClick({ target: { closest: (sel) => (sel === '.pe-result' ? row : null) }, shiftKey: false });
    assert.equal(els['pe-search-results'].hidden, false, 'clicking result in delete mode must keep overlay open');

    const controller = new AbortController();
    initSearch(controller.signal);
    assert.ok(
      els['pe-search-settings-btn'].listeners.some(l => l.type === 'click' && l.opts?.signal === controller.signal),
      'settings button must bind with { signal }'
    );
    assert.ok(
      els['pe-search-custom-only'].listeners.some(l => l.type === 'change' && l.opts?.signal === controller.signal),
      'customOnly checkbox must bind with { signal }'
    );
    assert.ok(
      docListeners.some(l => l.type === 'click' && l.opts?.signal === controller.signal),
      'document outside-click must bind with { signal }'
    );
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    state.activeCategory = prevState.activeCategory;
    state.viewMode = prevState.viewMode;
    state.searchQuery = prevState.searchQuery;
    state.searchAll = prevState.searchAll;
    state.searchNamesOnly = prevState.searchNamesOnly;
    state.searchWholeWord = prevState.searchWholeWord;
    state.searchCustomOnly = prevState.searchCustomOnly;
    state.isDeleteMode = prevState.isDeleteMode;
    state.form.texts = prevState.texts;
    state.form.cataclysms = prevState.cataclysms;
  }
});
