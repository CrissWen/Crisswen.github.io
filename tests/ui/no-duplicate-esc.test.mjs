import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// MINOR 1 (аудит етапу 3): екранування HTML має жити лише в js/utils/security.js.
// Тест-охоронець: жоден інший модуль не оголошує власний esc()/escapeHtml().

const root = fileURLToPath(new URL('../../js/', import.meta.url));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue; // сторонній код не чіпаємо
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const DEFINITION = /^\s*(?:export\s+)?(?:function\s+(?:esc|escapeHtml|escHtml)\s*\(|(?:const|let|var)\s+(?:esc|escapeHtml|escHtml)\s*=)/m;
const SECURITY = join(root, 'utils', 'auth', 'security.js');

const offenders = walk(root)
  .filter((file) => file !== SECURITY)
  .filter((file) => DEFINITION.test(readFileSync(file, 'utf8')))
  .map((file) => relative(root, file).split(sep).join('/'));

assert.deepStrictEqual(offenders, [], `Локальні копії esc()/escapeHtml() мають бути замінені імпортом із utils/security.js: ${offenders.join(', ')}`);

// utils/escape-html.js — лише реекспорт security.js (історичний шлях для редактора паків); перевіряємо, що це справді так
const shim = readFileSync(join(root, 'utils', 'common', 'escape-html.js'), 'utf8');
assert.ok(/export\s*\{[^}]*\besc\b[^}]*\}\s*from\s*['"]\.\.\/auth\/security\.js['"]/.test(shim), 'escape-html.js має лише реекспортувати esc із security.js');

// Файли, які використовують esc(...), мусять його імпортувати (інакше ReferenceError у браузері)
const missingImport = walk(root)
  .filter((file) => file !== SECURITY)
  .filter((file) => {
    const src = readFileSync(file, 'utf8');
    const uses = /(^|[^\w.$])esc\(/.test(src);
    const imports = /import\s*\{[^}]*\besc\b[^}]*\}\s*from\s*['"][^'"]*(?:security|escape-html)\.js['"]/.test(src);
    return uses && !imports;
  })
  .map((file) => relative(root, file).split(sep).join('/'));

assert.deepStrictEqual(missingImport, [], `Використовують esc() без імпорту: ${missingImport.join(', ')}`);

// Канонічна поведінка esc() збережена
const { esc } = await import('../../js/utils/auth/security.js');
assert.strictEqual(esc(`<a href="x" onclick='y'>&</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
assert.strictEqual(esc(null), '');
assert.strictEqual(esc(undefined), '');
assert.strictEqual(esc(0), '0');

console.log('no-duplicate-esc: ok');
