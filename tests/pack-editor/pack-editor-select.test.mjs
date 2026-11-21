import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('pack-editor/ui/dynamic.js uses shared custom-select.js wrapper instead of manual .pe-hidden-select markup', () => {
  const dynamicUiSrc = fs.readFileSync(
    path.resolve('js/pack-editor/ui/dynamic.js'),
    'utf8'
  );
  assert.match(dynamicUiSrc, /from ['"]\.\.\/\.\.\/ui\/custom-select\.js['"]/);
  assert.match(dynamicUiSrc, /initCustomSelects\(/);
  assert.doesNotMatch(dynamicUiSrc, /class="pe-hidden-select"/);
});

test('pack-editor/controllers/dynamic.js reuses syncCustomSelect from ui/custom-select.js', () => {
  const dynamicCtrlSrc = fs.readFileSync(
    path.resolve('js/pack-editor/controllers/dynamic.js'),
    'utf8'
  );
  assert.match(dynamicCtrlSrc, /from ['"]\.\.\/\.\.\/ui\/custom-select\.js['"]/);
  assert.doesNotMatch(dynamicCtrlSrc, /export function syncCustomSelect\s*\(/);
});
