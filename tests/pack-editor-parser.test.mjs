import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardLine, cardToLine, parsePropsString } from '../js/pack-editor/parser.js';

test('parser: round-trip preserves quotes and backslashes in meta.description and meta.opposite (Minor 8)', () => {
  const originalMeta = {
    description: 'Він сказав "Привіт" і показав шлях C:\\bunker',
    timer_minutes: 10,
    stay_time_months: 12,
    population: 50
  };
  const line = cardToLine('cataclysm', 'Ядерна зима', originalMeta);
  const parsed = parseCardLine('cataclysm', line);

  assert.equal(parsed.value, 'Ядерна зима');
  assert.equal(parsed.meta.description, originalMeta.description);
  assert.equal(parsed.meta.timer_minutes, 10);
});

test('parser: parsePropsString unescapes single quotes and backslashes and ignores NaN numeric values (Minor 8)', () => {
  const meta = parsePropsString('{opp: \'Мар\\\'яна\', timer: abc, min: 18}');
  assert.equal(meta.opposite, "Мар'яна");
  assert.equal(meta.timer_minutes, undefined);
  assert.equal(meta.range?.min, 18);
});

test('parser: parseCardLine does not strip trailing brackets as stages in categories without stages (Minor 9)', () => {
  const parsedItem = parseCardLine('items', 'Радіоприймач [модель 1980]');
  assert.equal(parsedItem.value, 'Радіоприймач [модель 1980]');
  assert.equal(parsedItem.meta.stages, undefined);

  const parsedProfession = parseCardLine('profession', 'Лікар - Лікує [Інтерн (1р.); Хірург (5р.)]');
  assert.equal(parsedProfession.value, 'Лікар');
  assert.equal(parsedProfession.meta.ability, 'Лікує');
  assert.ok(Array.isArray(parsedProfession.meta.stages));
  assert.equal(parsedProfession.meta.stages.length, 2);
});

