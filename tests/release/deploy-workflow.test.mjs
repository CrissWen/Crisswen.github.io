import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease } from '../../scripts/build-release.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('deploy-pages.yml runs node --test, builds dist via scripts/build-release.mjs, and deploys dist/', () => {
  const wfPath = join(REPO_ROOT, '.github', 'workflows', 'deploy-pages.yml');
  assert.equal(existsSync(wfPath), true, '.github/workflows/deploy-pages.yml must exist');
  const yml = readFileSync(wfPath, 'utf8');
  assert.match(yml, /node --test "tests\/\*\*\/\*\.test\.mjs"/);
  assert.match(yml, /node scripts\/build-release\.mjs --out dist/);
  assert.match(yml, /actions\/upload-pages-artifact@v3/);
  assert.match(yml, /path:\s*['"]?dist['"]?/);
  assert.match(yml, /actions\/deploy-pages@v4/);
});

test('buildRelease succeeds against the real TrueBunker repository and hashes all 4 HTML entrypoints', (t) => {
  const outDir = mkdtempSync(join(tmpdir(), 'tb-real-build-'));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));

  const result = buildRelease({ rootDir: REPO_ROOT, outDir });
  assert.match(result.buildId, /^[0-9a-f]{8}$/);
  assert.ok(result.version.length > 0);

  for (const page of ['index.html', 'survival-test.html', 'audio-lab.html', 'cataclysm-icon-curator.html']) {
    const html = readFileSync(join(outDir, page), 'utf8');
    assert.match(html, new RegExp(`<meta name="app-build-id" content="${result.buildId}">`), `${page} missing app-build-id`);
    assert.match(html, /href="css\/styles\.css\?v=[0-9a-f]{8}"/, `${page} missing hashed styles.css`);
    assert.match(html, new RegExp(`'css/themes/theme-' \\+ t \\+ '\\.css\\?v=${result.themesHash}'`), `${page} missing hashed inline theme URL`);
  }
});
