import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROD_DIRS = ['css', 'js', 'icons', 'img', 'textures', 'audio'];
const PROD_HTML_FILES = [
  'index.html',
  'survival-test.html',
  'audio-lab.html',
  'cataclysm-icon-curator.html'
];
const EXCLUDED_REL_PATHS = new Set(['js/config/game-config.local.js']);

function toPosixPath(p) {
  return p.replace(/\\/g, '/');
}

function shortHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function walkFiles(dir, baseDir = dir, results = []) {
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, baseDir, results);
    } else if (entry.isFile()) {
      results.push(toPosixPath(relative(baseDir, full)));
    }
  }
  return results;
}

function isExternalOrSpecialUrl(spec) {
  return (
    !spec ||
    /^(?:https?:|data:|blob:|mailto:|javascript:|\/\/|#)/i.test(spec)
  );
}

function stripQueryAndHash(spec) {
  const qIdx = spec.indexOf('?');
  const hIdx = spec.indexOf('#');
  const cut =
    qIdx !== -1 && hIdx !== -1 ? Math.min(qIdx, hIdx) : qIdx !== -1 ? qIdx : hIdx;
  return cut === -1 ? spec : spec.slice(0, cut);
}

function resolveRelativeAsset(fromRelPath, spec) {
  const cleanSpec = stripQueryAndHash(spec);
  const fromDir = posix.dirname(fromRelPath);
  return posix.normalize(fromDir === '.' ? cleanSpec : posix.join(fromDir, cleanSpec));
}

function appendVersionQuery(spec, hash) {
  if (!hash) return spec;
  const hIdx = spec.indexOf('#');
  const base = hIdx === -1 ? spec : spec.slice(0, hIdx);
  const frag = hIdx === -1 ? '' : spec.slice(hIdx);
  const cleanBase = stripQueryAndHash(base);
  return `${cleanBase}?v=${hash}${frag}`;
}

export function buildRelease({
  rootDir = fileURLToPath(new URL('../', import.meta.url)),
  outDir = resolve(rootDir, 'dist'),
  now = new Date()
} = {}) {
  const absRoot = resolve(rootDir);
  const absOut = resolve(outDir);
  const relOutToRoot = toPosixPath(relative(absOut, absRoot));
  if (
    !relOutToRoot ||
    relOutToRoot === '.' ||
    (!relOutToRoot.startsWith('..') && !/^(?:\/|[a-zA-Z]:)/.test(relOutToRoot))
  ) {
    throw new Error(`Unsafe outDir "${outDir}": outDir must not equal or contain rootDir`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. Copy production directories and HTML entrypoints
  for (const dirName of PROD_DIRS) {
    const srcDir = join(rootDir, dirName);
    if (!existsSync(srcDir)) continue;
    cpSync(srcDir, join(outDir, dirName), {
      recursive: true,
      filter: (src) => {
        const rel = toPosixPath(relative(rootDir, src));
        return !EXCLUDED_REL_PATHS.has(rel);
      }
    });
  }

  for (const htmlFile of PROD_HTML_FILES) {
    const srcHtml = join(rootDir, htmlFile);
    if (existsSync(srcHtml) && statSync(srcHtml).isFile()) {
      cpSync(srcHtml, join(outDir, htmlFile));
    }
  }

  const assetHashes = new Map();

  // 2. Compute combined themesHash across css/themes/*.css
  const themeFiles = walkFiles(join(outDir, 'css', 'themes'), outDir).filter((f) => f.endsWith('.css'));
  const themeHasher = createHash('sha256');
  for (const relTheme of themeFiles) {
    const raw = readFileSync(join(outDir, relTheme), 'utf8');
    themeHasher.update(`${relTheme}:${raw}\n`);
  }
  const themesHash = themeHasher.digest('hex').slice(0, 8);
  for (const relTheme of themeFiles) {
    assetHashes.set(relTheme, themesHash);
  }

  // 3. Process CSS files bottom-up (Merkle hash for @import url(...))
  const allCssFiles = walkFiles(join(outDir, 'css'), outDir).filter((f) => f.endsWith('.css'));
  const cssState = new Map(); // relPath -> 'visiting' | 'done'

  function processCssFile(relCss) {
    if (assetHashes.has(relCss)) return assetHashes.get(relCss);
    if (cssState.get(relCss) === 'visiting') return '';
    cssState.set(relCss, 'visiting');

    const absPath = join(outDir, relCss);
    if (!existsSync(absPath)) return '';

    let content = readFileSync(absPath, 'utf8');
    content = content.replace(
      /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)/g,
      (fullMatch, q1, url1, q2, url2) => {
        const rawUrl = url1 || url2;
        if (isExternalOrSpecialUrl(rawUrl)) return fullMatch;
        const targetRel = resolveRelativeAsset(relCss, rawUrl);
        if (!existsSync(join(outDir, targetRel))) return fullMatch;
        const targetHash = processCssFile(targetRel);
        const updatedUrl = appendVersionQuery(rawUrl, targetHash);
        if (url1 !== undefined) {
          const quote = q1 || '"';
          return `@import url(${quote}${updatedUrl}${quote})`;
        }
        return `@import ${q2}${updatedUrl}${q2}`;
      }
    );

    writeFileSync(absPath, content, 'utf8');
    const hash = shortHash(content);
    assetHashes.set(relCss, hash);
    cssState.set(relCss, 'done');
    return hash;
  }

  for (const relCss of allCssFiles) {
    processCssFile(relCss);
  }

  // 4. Process JS files bottom-up (Merkle hash for static & dynamic imports + theme-manager template)
  const allJsFiles = walkFiles(join(outDir, 'js'), outDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  const jsState = new Map();

  function rewriteJsImportsInSource(sourceText, fromRelPath) {
    // Process outside comments so comment examples mentioning import/export are untouched
    return sourceText.replace(
      /(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)|((?:^|[;\r\n])[ \t]*(?:import|export)\b[^;={}()]*?(?:\{[^};]*\}[^;={}()]*?)?\s+from\s*(['"])(\.\.?\/[^'"]+)\3)|((?:^|[;\r\n])[ \t]*import\s*(['"])(\.\.?\/[^'"]+)\6)|(\bimport\s*\(\s*(['"])(\.\.?\/[^'"]+)\9\s*\))/gm,
      (
        fullMatch,
        comment,
        fromStmt,
        fromQuote,
        fromSpec,
        sideStmt,
        sideQuote,
        sideSpec,
        dynStmt,
        dynQuote,
        dynSpec
      ) => {
        if (comment) return fullMatch;
        const spec = fromSpec || sideSpec || dynSpec;
        const quote = fromQuote || sideQuote || dynQuote;
        if (!spec) return fullMatch;
        const targetRel = resolveRelativeAsset(fromRelPath, spec);
        if (EXCLUDED_REL_PATHS.has(targetRel) || !existsSync(join(outDir, targetRel))) {
          return fullMatch;
        }
        const targetHash = processJsFile(targetRel);
        const hashedSpec = appendVersionQuery(spec, targetHash);
        const idx = fullMatch.lastIndexOf(`${quote}${spec}${quote}`);
        if (idx === -1) return fullMatch;
        return (
          fullMatch.slice(0, idx) +
          `${quote}${hashedSpec}${quote}` +
          fullMatch.slice(idx + quote.length * 2 + spec.length)
        );
      }
    );
  }

  function processJsFile(relJs) {
    if (assetHashes.has(relJs)) return assetHashes.get(relJs);
    if (jsState.get(relJs) === 'visiting') return '';
    jsState.set(relJs, 'visiting');

    const absPath = join(outDir, relJs);
    if (!existsSync(absPath)) return '';

    let content = readFileSync(absPath, 'utf8');

    // Stamp themesHash onto themeHref template in theme-manager.js
    if (relJs === 'js/utils/common/theme-manager.js') {
      content = content.replace(
        /`css\/themes\/theme-\$\{themeName\}\.css(?:\?v=[^`]*)?`/g,
        `\`css/themes/theme-\${themeName}.css?v=${themesHash}\``
      );
    }

    content = rewriteJsImportsInSource(content, relJs);

    writeFileSync(absPath, content, 'utf8');
    const hash = shortHash(content);
    assetHashes.set(relJs, hash);
    jsState.set(relJs, 'done');
    return hash;
  }

  for (const relJs of allJsFiles) {
    processJsFile(relJs);
  }

  // 5. Compute overall buildId from all asset hashes and HTML contents
  const buildHasher = createHash('sha256');
  const sortedAssets = [...assetHashes.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [relPath, hash] of sortedAssets) {
    buildHasher.update(`${relPath}:${hash}\n`);
  }
  for (const htmlFile of PROD_HTML_FILES) {
    const absHtml = join(outDir, htmlFile);
    if (existsSync(absHtml)) {
      buildHasher.update(`${htmlFile}:${readFileSync(absHtml, 'utf8')}\n`);
    }
  }
  const buildId = buildHasher.digest('hex').slice(0, 8);

  // 6. Rewrite HTML entrypoints: <link href>, <script src>, inline theme switcher, inline module imports, and <meta name="app-build-id">
  for (const htmlFile of PROD_HTML_FILES) {
    const absHtml = join(outDir, htmlFile);
    if (!existsSync(absHtml)) continue;
    let html = readFileSync(absHtml, 'utf8');

    // Inject <meta name="app-build-id" content="...">
    const metaTag = `<meta name="app-build-id" content="${buildId}">`;
    if (/<meta\s+charset=["'][^"']+["']\s*\/?>/i.test(html)) {
      html = html.replace(/(<meta\s+charset=["'][^"']+["']\s*\/?>)/i, `$1\n  ${metaTag}`);
    } else if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/(<head[^>]*>)/i, `$1\n  ${metaTag}`);
    }

    // Rewrite local <link ... href="css/...">
    html = html.replace(
      /(<link\b[^>]*?\bhref=(['"]))([^'"]+)(\2[^>]*>)/gi,
      (fullMatch, prefix, quote, href, suffix) => {
        if (isExternalOrSpecialUrl(href)) return fullMatch;
        const targetRel = resolveRelativeAsset(htmlFile, href);
        if (!targetRel.endsWith('.css')) return fullMatch;
        const hash = targetRel.startsWith('css/themes/') ? themesHash : assetHashes.get(targetRel);
        if (!hash) return fullMatch;
        return `${prefix}${appendVersionQuery(href, hash)}${suffix}`;
      }
    );

    // Rewrite local <script ... src="js/...">
    html = html.replace(
      /(<script\b[^>]*?\bsrc=(['"]))([^'"]+)(\2[^>]*>)/gi,
      (fullMatch, prefix, quote, src, suffix) => {
        if (isExternalOrSpecialUrl(src)) return fullMatch;
        const targetRel = resolveRelativeAsset(htmlFile, src);
        const hash = assetHashes.get(targetRel);
        if (!hash) return fullMatch;
        return `${prefix}${appendVersionQuery(src, hash)}${suffix}`;
      }
    );

    // Rewrite inline theme switcher template: 'css/themes/theme-' + t + '.css'
    html = html.replace(
      /('css\/themes\/theme-'\s*\+\s*t\s*\+\s*')\.css(?:\?v=[^']*)?(')/g,
      `$1.css?v=${themesHash}$2`
    );

    // Rewrite inline <script type="module">...</script> relative imports
    html = html.replace(
      /(<script\b[^>]*\btype=(['"])module\2[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (fullMatch, openTag, _q, scriptBody, closeTag) => {
        if (!scriptBody.trim()) return fullMatch;
        return `${openTag}${rewriteJsImportsInSource(scriptBody, htmlFile)}${closeTag}`;
      }
    );

    writeFileSync(absHtml, html, 'utf8');
  }

  // 7. Extract version from js/config/changelog-config.js and write dist/version.json
  let version = '0.0.0';
  const changelogPath = join(rootDir, 'js', 'config', 'changelog-config.js');
  if (existsSync(changelogPath)) {
    const changelogSrc = readFileSync(changelogPath, 'utf8');
    const m = changelogSrc.match(/version\s*:\s*['"]([^'"]+)['"]/);
    if (m) version = m[1];
  }

  const versionPayload = {
    version,
    buildId,
    builtAt: now.toISOString()
  };
  writeFileSync(join(outDir, 'version.json'), `${JSON.stringify(versionPayload, null, 2)}\n`, 'utf8');

  return {
    buildId,
    version,
    themesHash,
    assetHashes
  };
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outArg = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : 'dist';
  const rootDir = fileURLToPath(new URL('../', import.meta.url));
  const outDir = resolve(rootDir, outArg);
  const result = buildRelease({ rootDir, outDir });
  console.log(`Built TrueBunker v${result.version} (buildId=${result.buildId}) -> ${outDir}`);
}
