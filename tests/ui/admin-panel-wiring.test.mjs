import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Охоронці інтеграції адмін-панелі: підключення в app.js та index.html, відсутність жорстких кольорів у CSS
// (панель має підлаштовуватись під усі теми), esc() лише з security.js.

const read = rel => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

test('app.js імпортує й викликає initAdminPanel', () => {
  const src = read('js/app.js');
  assert.match(src, /import\s*\{\s*initAdminPanel\s*\}\s*from\s*'\.\/ui\/admin-panel\.js'/);
  assert.match(src, /^initAdminPanel\(\);/m);
});

test('index.html підключає admin-panel.css', () => {
  assert.match(read('index.html'), /<link rel="stylesheet" href="css\/admin-panel\.css">/);
});

test('сторінки відладки підключають панель (CSS + initAdminPanel) і мають однаковий шлях до модуля', () => {
  for (const page of ['audio-lab.html', 'cataclysm-icon-curator.html']) {
    const html = read(page);
    assert.match(html, /<link rel="stylesheet" href="css\/admin-panel\.css">/, `${page}: немає admin-panel.css`);
    assert.match(html, /import \{ initAdminPanel \} from '\.\/js\/ui\/admin-panel\.js';\s*initAdminPanel\(\);/, `${page}: немає ініціалізації панелі`);
  }
});

test('хедери сторінок відладки більше не мають жорстких взаємних посилань', () => {
  const audio = read('audio-lab.html');
  const curator = read('cataclysm-icon-curator.html');
  assert.doesNotMatch(audio, /<a [^>]*href="cataclysm-icon-curator\.html"/, 'у audio-lab.html залишився лінк на куратор');
  assert.doesNotMatch(curator, /<a [^>]*href="audio-lab\.html"/, 'у кураторі залишився лінк на аудіо-лабораторію');
});

test('admin-panel.css: жодних жорстких кольорів і шрифтів, лише змінні теми', () => {
  const css = read('css/admin-panel.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'знайдено hex-колір');
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/i, 'знайдено rgb()/hsl()');
  assert.doesNotMatch(css, /(?<![\w-])(?:white|black|red|green|blue|yellow|orange|gray|grey)(?![\w-])/i, 'знайдено іменований колір');

  const fonts = [...css.matchAll(/font-family\s*:\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(fonts.length > 0);
  for (const f of fonts) assert.match(f, /^var\(--(?:head|body|mono)\)$/, `font-family «${f}» має братися зі змінної теми`);

  for (const v of ['--panel', '--panel-2', '--metal', '--metal-lt', '--hazard', '--text', '--text-mute', '--bg']) {
    assert.ok(css.includes(`var(${v})`), `панель має використовувати змінну теми ${v}`);
  }
});

test('admin-panel.js: esc() лише з security.js, без власних копій', () => {
  const src = read('js/ui/admin-panel.js');
  assert.match(src, /import\s*\{\s*esc\s*\}\s*from\s*'\.\.\/utils\/auth\/security\.js'/);
  assert.doesNotMatch(src, /(?:function|const|let|var)\s+(?:esc|escapeHtml|escHtml)\b/);
});

test('admin-panel.js: посилання з target=_blank завжди з rel=noopener', () => {
  const src = read('js/ui/admin-panel.js');
  assert.match(src, /rel="noopener noreferrer"/);
});
