import assert from 'node:assert';
import { register } from 'node:module';

// I-7 (підключення): форма авторизації показує справжню причину помилки і валідує нікнейм при реєстрації.

const STUBS = {
  '../services/supabase.js': `
    export const supabase = { auth: {
      getSession: async () => ({ data: { session: null } }),
      signUp: (...a) => globalThis.__signUp(...a),
      signInWithPassword: (...a) => globalThis.__signIn(...a),
      signOut: async () => {}
    } };`
};
const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.endsWith('/pages/auth.js') && STUBS[specifier]) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

class FakeNode {
  constructor() { this.style = {}; this.dataset = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  querySelectorAll() { return []; }
  async fire(t, ev = {}) { for (const fn of this.listeners[t] || []) await fn(ev); }
}
let nodes;
globalThis.document = { getElementById: id => { if (!nodes.has(id)) nodes.set(id, new FakeNode()); return nodes.get(id); } };
globalThis.window = { location: { hash: '#/login' } };

const { initAuth } = await import('../../js/pages/auth.js');
const $ = id => document.getElementById(id);

async function submit({ mode, username, password = 'secret1' }) {
  nodes = new Map();
  window.location.hash = '#/login';
  await initAuth();
  if (mode === 'register') {
    await $('auth-mode-switch').fire('click', { target: { closest: () => ({ dataset: { mode: 'register' } }) } });
  }
  $('username').value = username;
  $('password').value = password;
  await $('login-btn').fire('click');
  return { error: $('auth-error').textContent, hash: window.location.hash };
}

let failed = 0;
async function check(name, fn) {
  try { globalThis.__calls = []; await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.error(`  FAIL ${name}\n       ${err.message}`); }
}
const ok = async () => ({ data: {}, error: null });

console.log('Running auth-form tests...');

await check('реєстрація з пробілом у імені не доходить до signUp', async () => {
  globalThis.__signUp = async (...a) => { globalThis.__calls.push(['signUp', ...a]); return ok(); };
  const r = await submit({ mode: 'register', username: 'a b' });
  assert.strictEqual(globalThis.__calls.length, 0, 'signUp не мав викликатись');
  assert.match(r.error, /пробіл|символ/i);
});

await check('реєстрація з недозволеним символом не доходить до signUp', async () => {
  globalThis.__signUp = async (...a) => { globalThis.__calls.push(['signUp', ...a]); return ok(); };
  const r = await submit({ mode: 'register', username: 'a.b' });
  assert.strictEqual(globalThis.__calls.length, 0);
  assert.match(r.error, /літери|цифри/i);
});

await check('реєстрація: мережевий збій (повернена помилка) не видається за «ім’я зайняте»', async () => {
  globalThis.__signUp = async () => ({ data: null, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
  const r = await submit({ mode: 'register', username: 'Гравець' });
  assert.doesNotMatch(r.error, /зайняте/);
  assert.match(r.error, /мереж|інтернет/i);
});

await check('реєстрація: виняток fetch не показує сирий текст «Failed to fetch»', async () => {
  globalThis.__signUp = async () => { throw new TypeError('Failed to fetch'); };
  const r = await submit({ mode: 'register', username: 'Гравець' });
  assert.doesNotMatch(r.error, /Failed to fetch/);
  assert.match(r.error, /мереж|інтернет/i);
});

await check('реєстрація: слабкий пароль показує причину, а не «зайняте»', async () => {
  globalThis.__signUp = async () => ({ data: null, error: { code: 'weak_password', status: 422, message: 'Password should be at least 6 characters' } });
  const r = await submit({ mode: 'register', username: 'Гравець', password: 'abcdef' });
  assert.doesNotMatch(r.error, /зайняте/);
  assert.match(r.error, /парол/i);
});

await check('реєстрація: справді зайняте ім’я показує «зайняте»', async () => {
  globalThis.__signUp = async () => ({ data: null, error: { code: 'user_already_exists', status: 422, message: 'User already registered' } });
  const r = await submit({ mode: 'register', username: 'Гравець' });
  assert.match(r.error, /зайняте/);
});

await check('реєстрація: успіх веде в лобі', async () => {
  globalThis.__signUp = async (...a) => { globalThis.__calls.push(['signUp', ...a]); return ok(); };
  const r = await submit({ mode: 'register', username: 'Гравець' });
  assert.strictEqual(r.hash, '#/lobby');
  assert.strictEqual(globalThis.__calls[0][1].email, 'Гравець@bunker.local');
});

await check('вхід: старе ім’я з крапкою не блокується строгою регуляркою', async () => {
  globalThis.__signIn = async (...a) => { globalThis.__calls.push(['signIn', ...a]); return ok(); };
  const r = await submit({ mode: 'login', username: 'Old.Name' });
  assert.strictEqual(globalThis.__calls.length, 1, 'вхід зі старим ім’ям має дійти до signIn');
  assert.strictEqual(r.hash, '#/lobby');
});

await check('вхід: невірні дані показують «Невірне ім’я або пароль»', async () => {
  globalThis.__signIn = async () => ({ data: null, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } });
  const r = await submit({ mode: 'login', username: 'Гравець' });
  assert.match(r.error, /Невірне/);
});

await check('вхід: мережевий збій не видається за невірний пароль', async () => {
  globalThis.__signIn = async () => { throw new TypeError('Failed to fetch'); };
  const r = await submit({ mode: 'login', username: 'Гравець' });
  assert.doesNotMatch(r.error, /Невірне/);
  assert.match(r.error, /мереж|інтернет/i);
});

if (failed) {
  console.error(`FAIL: auth-form (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all auth-form tests passed!');
process.exit(0);
