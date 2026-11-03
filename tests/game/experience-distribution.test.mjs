import assert from 'node:assert';
import test from 'node:test';

import {
  getMonthScale,
  getEligibleStages,
  rollExperience,
  maxExperienceMonths
} from '../../js/utils/auth/experience.js';

const STANDARD_PROFESSION_STAGES = [
  { name: 'Новачок', up_to_months: 3 },
  { name: 'Стажер', up_to_months: 12 },
  { name: 'Любитель', up_to_months: 24 },
  { name: 'Досвідчений', up_to_months: 60 },
  { name: 'Просунутий', up_to_months: 120 },
  { name: 'Майстер', up_to_months: null }
];

const STANDARD_CONFIG = {
  default_stages: {
    profession: STANDARD_PROFESSION_STAGES
  }
};

test('getEligibleStages: 18-річний гравець може отримати 10-річного Майстра, але не 20-річну Легенду', () => {
  const scale = getMonthScale(STANDARD_PROFESSION_STAGES);
  const eligible18 = getEligibleStages(scale, 18);
  const names18 = eligible18.map(s => s.name);

  // 18 років - 6 років раннього віку = 12 років стажу (144 міс) >= 120 міс порогу Майстра -> МОЖЕ бути Майстром
  assert.ok(names18.includes('Майстер'), '18-річний персонаж повинен мати змогу стати Майстром (10 років стажу)');

  // Кастомна шкала з порогом у 20 років (240 місяців)
  const highTierScale = getMonthScale([
    { name: 'Учень', up_to_months: 24 },
    { name: 'Фахівець', up_to_months: 240 }, // 20 років
    { name: 'Легенда', up_to_months: null } // понад 20 років
  ]);

  const eligibleHigh18 = getEligibleStages(highTierScale, 18);
  const namesHigh18 = eligibleHigh18.map(s => s.name);

  // 18-річний персонаж фізично не прожив 20 років (240 місяців), тому не може бути Легендою
  assert.strictEqual(namesHigh18.includes('Легенда'), false, '18-річний персонаж не може отримати стадію, що вимагає понад 20 років стажу');
});

test('getEligibleStages: дитина (8 років) не може отримати стадію, яка вимагає 10 років стажу', () => {
  const scale = getMonthScale(STANDARD_PROFESSION_STAGES);
  const eligible8 = getEligibleStages(scale, 8);
  const names8 = eligible8.map(s => s.name);

  assert.strictEqual(names8.includes('Майстер'), false, '8-річна дитина не може бути Майстром (10 років стажу)');
  assert.strictEqual(names8.includes('Просунутий'), false, '8-річна дитина не може бути Просунутим (5 років стажу від 6 років життя)');
});

test('getEligibleStages: персонаж "Без віку" має доступ до всіх стадій', () => {
  const scale = getMonthScale(STANDARD_PROFESSION_STAGES);
  const eligibleNoAge = getEligibleStages(scale, 'Без віку');
  assert.strictEqual(eligibleNoAge.length, scale.length, 'Для персонажів без віку повинні бути доступні всі стадії');
});

test('rollExperience: дорослий персонаж (50 років) має збалансований розподіл, а не 70-85% Майстра', () => {
  const SAMPLES = 2000;
  const counts = {};

  for (let i = 0; i < SAMPLES; i++) {
    const res = rollExperience('profession', { value: 'Лікар' }, STANDARD_CONFIG, 50);
    counts[res.stage] = (counts[res.stage] || 0) + 1;
  }

  // Усі стадії повинні випадати
  for (const s of STANDARD_PROFESSION_STAGES) {
    assert.ok(counts[s.name] > 0, `Стадія ${s.name} повинна мати ненульову кількість випадань`);
  }

  // Майстер більше не повинен душити всі стадії з шансом > 50% (раніше було 70-85%)
  const masterRatio = (counts['Майстер'] || 0) / SAMPLES;
  assert.ok(masterRatio < 0.35, `Частка Майстра (${(masterRatio * 100).toFixed(1)}%) повинна бути менше 35%, а не 70-85%`);
  assert.ok(masterRatio > 0.08, `Частка Майстра (${(masterRatio * 100).toFixed(1)}%) повинна бути відчутною (> 8%)`);
});

test('rollExperience: довгожитель (100+ років) успішно отримує стадії без помилок', () => {
  const res = rollExperience('profession', { value: 'Чаклун' }, STANDARD_CONFIG, 150);
  assert.ok(res.stage, 'Стадія повинна бути успішно згенерована для віку 150');
  assert.notStrictEqual(res.stage, 'Невідома стадія');
});

