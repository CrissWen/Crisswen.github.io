import assert from 'node:assert';

// avatar-service.js імпортує supabase.js, який бере клієнт з window.supabase (CDN). У Node підставляємо мінімальну заглушку.
globalThis.window = {
  supabase: { createClient: () => ({}) },
  addEventListener: () => {},
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { isSafeAvatarUrl } = await import('../js/services/avatar-service.js');

const HOST = 'https://yamapgouatvnvloatnxg.supabase.co';
const PUBLIC = '/storage/v1/object/public/avatars/';
const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Running avatar-security tests...');

check('приймає файл із власного Supabase-інстансу', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}${PUBLIC}${USER}/1700000000000.webp`), true);
});

check('відкидає сторонній хост зі схожим шляхом (P-C1)', () => {
  assert.strictEqual(isSafeAvatarUrl(`https://attacker.com${PUBLIC}${USER}/avatar.png`), false);
});

check('відкидає хост, що лише починається як наш (підробка піддомену)', () => {
  assert.strictEqual(isSafeAvatarUrl(`https://yamapgouatvnvloatnxg.supabase.co.evil.com${PUBLIC}${USER}/a.webp`), false);
});

check('відкидає хост із credentials у URL', () => {
  assert.strictEqual(isSafeAvatarUrl(`https://yamapgouatvnvloatnxg.supabase.co@attacker.com${PUBLIC}${USER}/a.webp`), false);
});

check('відкидає шлях зі стороннім хостом у query (обхід через includes)', () => {
  assert.strictEqual(isSafeAvatarUrl(`https://attacker.com/x?u=${HOST}${PUBLIC}${USER}/a.webp`), false);
});

check('відкидає http замість https', () => {
  assert.strictEqual(isSafeAvatarUrl(`http://yamapgouatvnvloatnxg.supabase.co${PUBLIC}${USER}/a.webp`), false);
});

check('відкидає ../ у шляху', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}${PUBLIC}${USER}/../${OTHER}/a.webp`), false);
});

check('відкидає закодований %2e%2e у шляху', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}${PUBLIC}${USER}/%2e%2e/${OTHER}/a.webp`), false);
});

check('відкидає інший бакет', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}/storage/v1/object/public/other-bucket/${USER}/a.webp`), false);
});

check('з userId: приймає файл у власній папці', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}${PUBLIC}${USER}/a.webp`, USER), true);
});

check('з userId: відкидає файл у чужій папці', () => {
  assert.strictEqual(isSafeAvatarUrl(`${HOST}${PUBLIC}${OTHER}/a.webp`, USER), false);
});

check('відкидає не-рядки та сміття', () => {
  for (const bad of [null, undefined, 42, {}, '', 'not a url', 'javascript:alert(1)']) {
    assert.strictEqual(isSafeAvatarUrl(bad), false, String(bad));
  }
});

if (process.exitCode) {
  console.error('FAIL: avatar-security');
} else {
  console.log('PASS: all avatar-security tests passed!');
}
