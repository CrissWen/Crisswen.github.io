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
