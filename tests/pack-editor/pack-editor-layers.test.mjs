import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINDINGS_DIR = path.resolve(__dirname, '../../js/pack-editor/bindings');

const bindingFiles = fs.readdirSync(BINDINGS_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort();

for (const fileName of bindingFiles) {
  test(`bindings/${fileName} does not import from ../ui/helpers.js`, () => {
    const src = fs.readFileSync(path.join(BINDINGS_DIR, fileName), 'utf8');
    const importsHelpers = /from\s+['"]\.\.\/ui\/helpers\.js['"]/.test(src);
    assert.equal(
      importsHelpers,
      false,
      `js/pack-editor/bindings/${fileName} must import $ from ../ui/shared.js instead of ../ui/helpers.js`
    );
  });
}
