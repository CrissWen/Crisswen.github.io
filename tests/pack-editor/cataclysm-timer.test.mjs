import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cataFieldStrings,
  hasCataDraft,
  validateCataclysmInput
} from '../../js/pack-editor/payload.js';

test('cataFieldStrings повертає timerEnabled=false і порожній timer коли timer_minutes === 0', () => {
  const fields = cataFieldStrings({
    name: 'Потоп',
    description: 'Вода скрізь',
    timer_minutes: 0,
    stay_time_months: 6,
    population: 5000
  });
  assert.equal(fields.timerEnabled, false);
  assert.equal(fields.timer, '');
});

test('cataFieldStrings повертає timerEnabled=true і рядковий timer коли timer_minutes > 0', () => {
  const fields = cataFieldStrings({
    name: 'Радіація',
    description: '',
    timer_minutes: 45,
    stay_time_months: 12,
    population: 1000
  });
  assert.equal(fields.timerEnabled, true);
  assert.equal(fields.timer, '45');
});

test('hasCataDraft враховує стан чекбокса timerEnabled', () => {
  const baseEmpty = { name: '', desc: '', timerEnabled: false, timer: '', stay: '', pop: '' };
  assert.equal(hasCataDraft(baseEmpty, null, false), false);
  assert.equal(hasCataDraft({ ...baseEmpty, timerEnabled: true }, null, false), true);

  const itemNoTimer = { name: 'Блек-аут', description: '', timer_minutes: 0, stay_time_months: 3, population: 200 };
  const rawSame = { name: 'Блек-аут', desc: '', timerEnabled: false, timer: '', stay: '3', pop: '200' };
  assert.equal(hasCataDraft(rawSame, itemNoTimer, true), false);
  assert.equal(hasCataDraft({ ...rawSame, timerEnabled: true }, itemNoTimer, true), true);

  const itemWithTimer = { name: 'Заморозки', description: '', timer_minutes: 20, stay_time_months: 4, population: 300 };
  assert.equal(hasCataDraft({ name: 'Заморозки', desc: '', timerEnabled: true, timer: '20', stay: '4', pop: '300' }, itemWithTimer, true), false);
  assert.equal(hasCataDraft({ name: 'Заморозки', desc: '', timerEnabled: false, timer: '', stay: '4', pop: '300' }, itemWithTimer, true), true);
});

test('validateCataclysmInput: вимкнений таймер завжди дає 0', () => {
  const res = validateCataclysmInput({
    name: 'Тест',
    desc: '',
    timerEnabled: false,
    timer: '99',
    stay: '6',
    pop: '500'
  });
  assert.ok(res.item);
  assert.equal(res.item.timer_minutes, 0);
});

test('validateCataclysmInput: увімкнений таймер вимагає значення >= 1', () => {
  const emptyRes = validateCataclysmInput({
    name: 'Тест',
    desc: '',
    timerEnabled: true,
    timer: '',
    stay: '6',
    pop: '500'
  });
  assert.equal(emptyRes.field, 'timer');
  assert.ok(emptyRes.error);

  const zeroRes = validateCataclysmInput({
    name: 'Тест',
    desc: '',
    timerEnabled: true,
    timer: '0',
    stay: '6',
    pop: '500'
  });
  assert.equal(zeroRes.field, 'timer');
  assert.ok(zeroRes.error);

  const okRes = validateCataclysmInput({
    name: 'Тест',
    desc: '',
    timerEnabled: true,
    timer: '30',
    stay: '6',
    pop: '500'
  });
  assert.ok(okRes.item);
  assert.equal(okRes.item.timer_minutes, 30);
});

test('validateCataclysmInput: зворотна сумісність без timerEnabled', () => {
  const res = validateCataclysmInput({
    name: 'Сумісність',
    desc: '',
    timer: '',
    stay: '6',
    pop: '500'
  });
  assert.ok(res.item);
  assert.equal(res.item.timer_minutes, 0);
});
