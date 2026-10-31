import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const labPath = path.resolve(__dirname, '../audio-lab.html');

test('Audio Lab Layout Contract - Option A Studio Rack', () => {
  const html = fs.readFileSync(labPath, 'utf8');

  // 1. Structure: Left column contains oscilloscope AND full profile mixer list
  assert.ok(html.includes('class="lab-console"'), 'Must have .lab-console container');
  assert.ok(html.includes('id="scope-canvas"'), 'Must have #scope-canvas inside lab-console');
  assert.ok(html.includes('id="lab-audio-mixer-list"'), 'Must have #lab-audio-mixer-list');

  // 2. Full 4-channel profile audio mixers inside mixer list
  assert.ok(html.includes('audio-mixer-card--master'), 'Must have Master profile card');
  assert.ok(html.includes('id="audio-slider-master"'), 'Must have #audio-slider-master');
  assert.ok(html.includes('id="audio-val-master"'), 'Must have #audio-val-master');
  assert.ok(html.includes('id="lab-audio-mute-btn"'), 'Must have #lab-audio-mute-btn');

  assert.ok(html.includes('id="audio-slider-sfx"'), 'Must have #audio-slider-sfx');
  assert.ok(html.includes('id="audio-val-sfx"'), 'Must have #audio-val-sfx');

  assert.ok(html.includes('id="audio-slider-ui"'), 'Must have #audio-slider-ui');
  assert.ok(html.includes('id="audio-val-ui"'), 'Must have #audio-val-ui');

  assert.ok(html.includes('id="audio-slider-music"'), 'Must have #audio-slider-music');
  assert.ok(html.includes('id="audio-val-music"'), 'Must have #audio-val-music');
  assert.ok(html.includes('id="lab-audio-ambient-btn"'), 'Must have #lab-audio-ambient-btn');
  assert.ok(html.includes('id="lab-audio-bg-ambient"'), 'Must have #lab-audio-bg-ambient');

  // 3. Option A layout CSS: 2-column studio rack container
  assert.match(
    html,
    /\.lab-wrap\s*\{[^}]*grid-template-columns:\s*440px\s+1fr/s,
    '.lab-wrap must have 2-column grid: 440px left rack + 1fr right catalog'
  );

  // 4. Right catalog grid has 2-column layout to avoid 1-column stretching or 4-column squishing
  assert.match(
    html,
    /\.lab-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(380px,\s*1fr\)\)/s,
    '.lab-grid must use comfortable 2-column grid (~380px minmax)'
  );

  // 5. Sound cards must have .sound-card__btn-group and dedicated .sound-card__calibration row
  assert.ok(html.includes('sound-card__btn-group'), 'Sound card must have .sound-card__btn-group');
  assert.ok(html.includes('sound-card__calibration'), 'Sound card must have .sound-card__calibration');
});
