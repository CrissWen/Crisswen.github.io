import assert from 'node:assert';

// I-7: валідація нікнейму при реєстрації та чесні повідомлення про помилки авторизації.
// Раніше будь-який збій signUp (мережа, слабкий пароль, ліміт запитів) маскувався під «Це ім'я вже зайняте».

const { validateUsername, buildFakeEmail, mapAuthError, AuthUiError } = await import('../js/utils/auth-validation.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}

console.log('Running auth-validation tests...');

// ===== validateUsername (реєстрація: строго) =====
for (const good of ['Гравець', 'abc_1', 'a-b', 'ІгорЄ', 'Їжак', 'Ґанок', 'x', '123456789012']) {
  check(`реєстрація: приймає «${good}»`, () => assert.strictEqual(validateUsername(good, { strict: true }), null));
}
for (const [bad, why] of [
  ['', 'порожнє'], ['1234567890123', '13 символів'], ['a b', 'пробіл'], ['a@b', 'знак @'], ['a.b', 'крапка'],
  ['../x', 'обхід шляху'], ['<b>', 'HTML'], ['😀', 'емодзі'], ['a\tb', 'табуляція'], ['a+b', 'плюс'], ['имя%00', 'відсоток']
]) {
  check(`реєстрація: відкидає ${why}`, () => {
    const err = validateUsername(bad, { strict: true });
    assert.strictEqual(typeof err, 'string', `«${bad}» мало бути відхилене`);
    assert.ok(err.length > 0);
  });
}

// ===== validateUsername (вхід: не ламаємо старі акаунти) =====
check('вхід: старе ім’я з крапкою та пробілом, але без @ — не відхиляється регуляркою', () => {
  assert.strictEqual(validateUsername('Old.Name', { strict: false }), null);
});
check('вхід: ім’я зі знаком @ відхиляється (зламало б email)', () => {
  assert.strictEqual(typeof validateUsername('a@b', { strict: false }), 'string');
});
check('вхід: ім’я з пробілом відхиляється (недійсна адреса)', () => {
  assert.strictEqual(typeof validateUsername('a b', { strict: false }), 'string');
});

// ===== buildFakeEmail =====
check('buildFakeEmail зберігає існуюче відображення ім’я -> email', () => {
  assert.strictEqual(buildFakeEmail('Гравець'), 'Гравець@bunker.local');
  assert.strictEqual(buildFakeEmail('abc'), 'abc@bunker.local');
});

// ===== mapAuthError: реєстрація =====
const REG = e => mapAuthError(e, 'register');
check('реєстрація: user_already_exists -> ім’я зайняте', () => {
  assert.match(REG({ code: 'user_already_exists', status: 422, message: 'User already registered' }), /зайняте/);
});
check('реєстрація: помилка тригера БД (унікальне ім’я) -> ім’я зайняте', () => {
  assert.match(REG({ status: 500, message: 'Database error saving new user' }), /зайняте/);
});
check('реєстрація: слабкий пароль НЕ маскується під «ім’я зайняте»', () => {
  const m = REG({ code: 'weak_password', status: 422, message: 'Password should be at least 6 characters' });
  assert.doesNotMatch(m, /зайняте/);
  assert.match(m, /парол/i);
});
check('реєстрація: мережевий збій НЕ маскується під «ім’я зайняте»', () => {
  const m = REG({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' });
  assert.doesNotMatch(m, /зайняте/);
  assert.match(m, /мереж|з'єднан|інтернет/i);
});
check('реєстрація: TypeError Failed to fetch -> повідомлення про мережу', () => {
  assert.match(REG(new TypeError('Failed to fetch')), /мереж|з'єднан|інтернет/i);
});
check('реєстрація: ліміт запитів (429) -> просимо зачекати', () => {
  const m = REG({ status: 429, code: 'over_request_rate_limit', message: 'rate limit' });
  assert.doesNotMatch(m, /зайняте/);
  assert.match(m, /забагато|зачекай|пізніше/i);
});
check('реєстрація: недійсний email (недопустимі символи) -> підказка про ім’я', () => {
  const m = REG({ code: 'email_address_invalid', status: 400, message: 'Email address is invalid' });
  assert.doesNotMatch(m, /зайняте/);
  assert.match(m, /ім'я|символ/i);
});
check('реєстрація: невідома помилка -> загальне повідомлення, не «зайняте»', () => {
  const m = REG({ status: 503, message: 'upstream connect error' });
  assert.doesNotMatch(m, /зайняте/);
  assert.ok(m.length > 5);
});
check('реєстрація: порожня/сміттєва помилка не кидає виняток', () => {
  assert.strictEqual(typeof REG(null), 'string');
  assert.strictEqual(typeof REG(undefined), 'string');
  assert.strictEqual(typeof REG('boom'), 'string');
});

// ===== mapAuthError: вхід =====
const LOG = e => mapAuthError(e, 'login');
check('вхід: invalid_credentials -> «Невірне ім’я або пароль»', () => {
  assert.match(LOG({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }), /Невірне/);
});
check('вхід: мережевий збій не видається за невірний пароль', () => {
  const m = LOG({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' });
  assert.doesNotMatch(m, /Невірне/);
  assert.match(m, /мереж|з'єднан|інтернет/i);
});
check('вхід: 429 не видається за невірний пароль', () => {
  assert.doesNotMatch(LOG({ status: 429, message: 'rate limit' }), /Невірне/);
});
check('вхід: 5xx не видається за невірний пароль', () => {
  assert.doesNotMatch(LOG({ status: 500, message: 'oops' }), /Невірне/);
});

// ===== AuthUiError =====
check('AuthUiError — це Error з готовим повідомленням для користувача', () => {
  const e = new AuthUiError('текст');
  assert.ok(e instanceof Error);
  assert.strictEqual(e.message, 'текст');
});

if (failed) {
  console.error(`FAIL: auth-validation (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all auth-validation tests passed!');
