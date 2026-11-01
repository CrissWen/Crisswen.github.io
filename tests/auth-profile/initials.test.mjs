import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// MINOR 4 (аудит етапу 3): charAt(0) обрізає сурогатні пари (емодзі). Ініціал беремо цілим символом.
const { firstChar } = await import('../../js/utils/initial.js');

// Звичайні імена
assert.strictEqual(firstChar('Тимур'), 'Т');
assert.strictEqual(firstChar('bob'), 'b');
assert.strictEqual(firstChar('Їжак'), 'Ї');

// Емодзі (сурогатна пара) не розрізається навпіл
assert.strictEqual(firstChar('😀Вася'), '😀');
assert.strictEqual(firstChar('𝔘name'), '𝔘');
assert.strictEqual(firstChar('😀').length, 2, 'це одна сурогатна пара');

// Склеєні емодзі (ZWJ-послідовність) і прапори лишаються цілим кластером
assert.strictEqual(firstChar('👨‍👩‍👧 сім’я'), '👨‍👩‍👧');
assert.strictEqual(firstChar('🇺🇦Тест'), '🇺🇦');

// Порожні та нестрокові значення
assert.strictEqual(firstChar(''), '');
assert.strictEqual(firstChar(null), '');
assert.strictEqual(firstChar(undefined), '');
assert.strictEqual(firstChar(0), '0');

// Структурна перевірка: у js/ (крім vendor) ніхто не бере ініціал через charAt(0)
const root = fileURLToPath(new URL('../../js/', import.meta.url));
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const offenders = walk(root)
  .filter((file) => /\.charAt\(0\)/.test(readFileSync(file, 'utf8')))
  .map((file) => relative(root, file).split(sep).join('/'));
assert.deepStrictEqual(offenders, [], `Замініть charAt(0) на firstChar() з utils/initial.js: ${offenders.join(', ')}`);

console.log('initials: ok');
