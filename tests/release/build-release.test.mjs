import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRelease } from '../../scripts/build-release.mjs';

function makeFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'tb-release-test-'));
  mkdirSync(join(dir, 'css', 'components'), { recursive: true });
  mkdirSync(join(dir, 'css', 'themes'), { recursive: true });
  mkdirSync(join(dir, 'js', 'config'), { recursive: true });
  mkdirSync(join(dir, 'js', 'utils', 'common'), { recursive: true });
  mkdirSync(join(dir, 'icons'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });

  writeFileSync(join(dir, 'icons', 'favicon.png'), 'png-bytes');
  writeFileSync(join(dir, 'tests', 'should-not-copy.test.mjs'), '// test');
  writeFileSync(join(dir, 'js', 'config', 'game-config.local.js'), 'export default {};');
  writeFileSync(
    join(dir, 'js', 'config', 'changelog-config.js'),
    "export const CHANGELOG = [{ version: '1.2.3', date: '2026-11-20', items: [] }];\n"
  );
  writeFileSync(
    join(dir, 'js', 'config', 'config-manager.js'),
    "import { CHANGELOG } from './changelog-config.js';\nexport async function loadLocal() { try { return await import('./game-config.local.js'); } catch { return CHANGELOG; } }\n"
  );
  writeFileSync(
    join(dir, 'js', 'utils', 'common', 'theme-manager.js'),
    "function themeHref(themeName) {\n  return `css/themes/theme-${themeName}.css`;\n}\nexport { themeHref };\n"
  );
  writeFileSync(
    join(dir, 'js', 'app.js'),
    "import { loadLocal } from './config/config-manager.js';\nimport { themeHref } from './utils/common/theme-manager.js';\nexport function boot() { return [loadLocal, themeHref]; }\n"
  );
  writeFileSync(join(dir, 'css', 'components', 'base.css'), 'body { margin: 0; }\n');
  writeFileSync(join(dir, 'css', 'styles.css'), '@import url("components/base.css");\n');
  writeFileSync(join(dir, 'css', 'ldm.css'), 'html.ldm * { animation: none; }\n');
  writeFileSync(join(dir, 'css', 'themes', 'theme-classic.css'), ':root { --bg: #000; }\n');
  writeFileSync(join(dir, 'css', 'themes', 'theme-stalker.css'), ':root { --bg: #111; }\n');
  writeFileSync(
    join(dir, 'index.html'),
    [
      '<!DOCTYPE html><html><head>',
      '<link rel="stylesheet" href="css/styles.css">',
      '<link id="theme-stylesheet" rel="stylesheet" href="css/themes/theme-classic.css">',
      '<script>',
      "document.getElementById('theme-stylesheet').href = 'css/themes/theme-' + t + '.css';",
      '</script>',
      '<link rel="stylesheet" href="css/ldm.css">',
      '</head><body>',
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
      '<script type="module" src="js/app.js"></script>',
      '</body></html>'
    ].join('\n')
  );
  return dir;
}

test('buildRelease copies production files, excludes dev/test paths, and emits version.json + meta app-build-id', (t) => {
  const rootDir = makeFixtureRepo();
  const outDir = join(rootDir, 'dist');
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  const res = buildRelease({ rootDir, outDir, now: new Date('2026-11-20T12:00:00.000Z') });
  assert.equal(res.version, '1.2.3');
  assert.match(res.buildId, /^[0-9a-f]{8}$/);

  assert.equal(existsSync(join(outDir, 'tests')), false, 'tests/ must not be copied');
  assert.equal(existsSync(join(outDir, 'js', 'config', 'game-config.local.js')), false, 'game-config.local.js must not be copied');
  assert.equal(existsSync(join(outDir, 'icons', 'favicon.png')), true);

  const versionJson = JSON.parse(readFileSync(join(outDir, 'version.json'), 'utf8'));
  assert.deepEqual(versionJson, {
    version: '1.2.3',
    buildId: res.buildId,
    builtAt: '2026-11-20T12:00:00.000Z'
  });

  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  assert.match(html, new RegExp(`<meta name="app-build-id" content="${res.buildId}">`));
  assert.match(html, /href="css\/styles\.css\?v=[0-9a-f]{8}"/);
  assert.match(html, new RegExp(`href="css/themes/theme-classic\\.css\\?v=${res.themesHash}"`));
  assert.match(html, new RegExp(`'css/themes/theme-' \\+ t \\+ '\\.css\\?v=${res.themesHash}'`));
  assert.match(html, /src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"/, 'CDN script untouched');
  assert.match(html, /src="js\/app\.js\?v=[0-9a-f]{8}"/);

  const stylesCss = readFileSync(join(outDir, 'css', 'styles.css'), 'utf8');
  assert.match(stylesCss, /@import url\("components\/base\.css\?v=[0-9a-f]{8}"\);/);

  const themeManagerJs = readFileSync(join(outDir, 'js', 'utils', 'common', 'theme-manager.js'), 'utf8');
  assert.match(themeManagerJs, new RegExp('`css/themes/theme-\\$\\{themeName\\}\\.css\\?v=' + res.themesHash + '`'));

  const configManagerJs = readFileSync(join(outDir, 'js', 'config', 'config-manager.js'), 'utf8');
  assert.match(configManagerJs, /from '\.\/changelog-config\.js\?v=[0-9a-f]{8}'/);
  assert.match(configManagerJs, /import\('\.\/game-config\.local\.js'\)/, 'optional local config stays un-hashed');
});

test('buildRelease propagates Merkle hash changes from a leaf module up to index.html and buildId', (t) => {
  const rootDir = makeFixtureRepo();
  const outDir1 = join(rootDir, 'dist1');
  const outDir2 = join(rootDir, 'dist2');
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  const first = buildRelease({ rootDir, outDir: outDir1 });

  writeFileSync(
    join(rootDir, 'js', 'config', 'changelog-config.js'),
    "export const CHANGELOG = [{ version: '1.2.4', date: '2026-11-20', items: [] }];\n"
  );
  writeFileSync(join(rootDir, 'css', 'components', 'base.css'), 'body { margin: 4px; }\n');

  const second = buildRelease({ rootDir, outDir: outDir2 });
  assert.notEqual(first.buildId, second.buildId);
  assert.notEqual(first.assetHashes.get('js/config/changelog-config.js'), second.assetHashes.get('js/config/changelog-config.js'));
  assert.notEqual(first.assetHashes.get('js/config/config-manager.js'), second.assetHashes.get('js/config/config-manager.js'));
  assert.notEqual(first.assetHashes.get('js/app.js'), second.assetHashes.get('js/app.js'));
  assert.notEqual(first.assetHashes.get('css/components/base.css'), second.assetHashes.get('css/components/base.css'));
  assert.notEqual(first.assetHashes.get('css/styles.css'), second.assetHashes.get('css/styles.css'));
  assert.equal(first.themesHash, second.themesHash, 'unchanged themes keep identical hash');
});
