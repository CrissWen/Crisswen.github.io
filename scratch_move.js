const fs = require('fs');
const path = require('path');

const srcFiles = [
  'js/pages/pack-editor.js',
  'js/ui/editor-ui.js',
  'js/utils/pack-categories.js',
  'js/utils/pack-parser.js',
  'js/utils/pack-payload.js',
  'js/utils/pack-search.js'
];

const destDir = 'js/pack-editor';
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);

const destMap = {
  'js/pages/pack-editor.js': 'js/pack-editor/index.js',
  'js/ui/editor-ui.js': 'js/pack-editor/ui.js',
  'js/utils/pack-categories.js': 'js/pack-editor/categories.js',
  'js/utils/pack-parser.js': 'js/pack-editor/parser.js',
  'js/utils/pack-payload.js': 'js/pack-editor/payload.js',
  'js/utils/pack-search.js': 'js/pack-editor/search.js'
};

const regexps = [
  // replace from root (e.g. ./pages/pack-editor.js)
  { from: /\.\/pages\/pack-editor\.js/g, to: './pack-editor/index.js' },
  // replace cross-references among moved files inside themselves
  // old pack-editor.js imports from '../utils/pack-...' and '../ui/editor-ui.js'
  { from: /\.\.\/utils\/pack-categories\.js/g, to: './categories.js' },
  { from: /\.\.\/utils\/pack-parser\.js/g, to: './parser.js' },
  { from: /\.\.\/utils\/pack-payload\.js/g, to: './payload.js' },
  { from: /\.\.\/utils\/pack-search\.js/g, to: './search.js' },
  { from: /\.\.\/ui\/editor-ui\.js/g, to: './ui.js' },
  
  // pack-categories etc. imported from other files
  { from: /\.\.\/utils\/pack-payload\.js/g, to: '../pack-editor/payload.js' },
  { from: /\.\.\/utils\/pack-parser\.js/g, to: '../pack-editor/parser.js' },
  { from: /\.\/pack-categories\.js/g, to: '../pack-editor/categories.js' }, // in fallback.js
  
  // inside new ui.js
  { from: /\.\.\/utils\/pack-/g, to: './' }, // imports in ui.js were from ../utils/pack-...
  
  // inside utils/pack-... (now in pack-editor)
  { from: /\.\/pack-categories\.js/g, to: './categories.js' },
  { from: /\.\/pack-parser\.js/g, to: './parser.js' },
  { from: /\.\.\/services\//g, to: '../services/' }, // unchanged but checking
  
  // old pack-editor.js imported ../services/packs-store.js and ../game-modules/...
  // new path is js/pack-editor/index.js, which is same level as js/pages
  // so ../services is still ../services, ../game-modules is still ../game-modules
];

function doReplaces(content, filepath) {
  if (filepath.endsWith('packs.js')) {
    content = content.replace(/#\/pack-editor/g, '#/pack-editor'); // Hash remains same
  }
  if (filepath.endsWith('app.js')) {
    content = content.replace(/\.\/pages\/pack-editor\.js/g, './pack-editor/index.js');
  }
  if (filepath.endsWith('packs-store.js')) {
    content = content.replace(/\.\.\/utils\/pack-payload\.js/g, '../pack-editor/payload.js');
    content = content.replace(/\.\.\/utils\/pack-parser\.js/g, '../pack-editor/parser.js');
  }
  if (filepath.endsWith('pack-fallback.js')) {
    content = content.replace(/\.\/pack-categories\.js/g, '../pack-editor/categories.js');
  }
  
  // For files inside pack-editor:
  if (destMap[filepath] || filepath.startsWith('js/pack-editor')) {
    content = content.replace(/\.\.\/utils\/pack-categories\.js/g, './categories.js');
    content = content.replace(/\.\.\/utils\/pack-parser\.js/g, './parser.js');
    content = content.replace(/\.\.\/utils\/pack-payload\.js/g, './payload.js');
    content = content.replace(/\.\.\/utils\/pack-search\.js/g, './search.js');
    content = content.replace(/\.\.\/ui\/editor-ui\.js/g, './ui.js');
    content = content.replace(/\.\/pack-categories\.js/g, './categories.js');
    content = content.replace(/\.\/pack-parser\.js/g, './parser.js');
  }
  
  return content;
}

// First, read contents and apply replaces to the moved files
Object.keys(destMap).forEach(src => {
  let content = fs.readFileSync(src, 'utf8');
  content = doReplaces(content, src);
  fs.writeFileSync(destMap[src], content);
  fs.unlinkSync(src); // remove old file
});

// Also update other files:
const others = [
  'js/app.js',
  'js/services/packs-store.js',
  'js/utils/pack-fallback.js',
];
others.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = doReplaces(content, f);
  fs.writeFileSync(f, content);
});
console.log('done');
