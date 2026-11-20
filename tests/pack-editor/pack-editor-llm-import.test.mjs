import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMPORT_FILE_BYTES,
  validateImportFileMeta,
  cleanTxtLine,
  importCardsContent,
  importStagesContent,
  processDroppedLlmFiles
} from '../../js/pack-editor/llm-file-import.js';
import { packEditorTemplate } from '../../js/pack-editor/ui/template.js';
import { PACK_EDITOR_TOUR_STEPS } from '../../js/pack-editor/tour-steps.js';

test('validateImportFileMeta приймає лише .txt та .json у межах 1 МБ', () => {
  assert.deepEqual(validateImportFileMeta({ name: 'cards.txt', type: 'text/plain', size: 120 }), {
    ok: true,
    kind: 'txt'
  });
  assert.deepEqual(validateImportFileMeta({ name: 'pack.JSON', type: 'application/json', size: 512 }), {
    ok: true,
    kind: 'json'
  });

  const badExt = validateImportFileMeta({ name: 'image.png', type: 'image/png', size: 200 });
  assert.equal(badExt.ok, false);
  assert.ok(badExt.error);

  const emptyFile = validateImportFileMeta({ name: 'empty.txt', type: 'text/plain', size: 0 });
  assert.equal(emptyFile.ok, false);

  const tooBig = validateImportFileMeta({ name: 'big.txt', type: 'text/plain', size: MAX_IMPORT_FILE_BYTES + 1 });
  assert.equal(tooBig.ok, false);
});

test('cleanTxtLine та importCardsContent (.txt) прибирають markdown-блоки, нумерацію, дублікати та поламані дужки', () => {
  assert.equal(cleanTxtLine('```txt'), '');
  assert.equal(cleanTxtLine('1. Хірург - робить операції'), 'Хірург - робить операції');
  assert.equal(cleanTxtLine('2) Інженер'), 'Інженер');
  assert.equal(cleanTxtLine('- Механік'), 'Механік');
  assert.equal(cleanTxtLine('• Пілот'), 'Пілот');

  const txt = [
    '```txt',
    '1. Хірург - робить складні операції',
    '2) Інженер - лагодить генератор [Стажер: 12, Майстер]',
    '- Хірург - дублікат за назвою',
    'Поламаний рядок {rep: true',
    'Чужий ключ {pop: 5000, stay: 12}',
    '```'
  ].join('\n');

  const res = importCardsContent({
    content: txt,
    kind: 'txt',
    category: 'profession',
    existingText: 'Водій - водить авто'
  });

  assert.equal(res.error, undefined);
  assert.equal(res.addedCount, 2);
  assert.equal(res.skippedCount, 3);
  assert.equal(
    res.nextText,
    [
      'Водій - водить авто',
      'Хірург - робить складні операції',
      'Інженер - лагодить генератор [Стажер: 12, Майстер]'
    ].join('\n')
  );
});

test('importCardsContent для cataclysm валідує stay, pop і timer у .txt та .json', () => {
  const txt = [
    'Ядерна зима {desc: "Холод і попіл", timer: 60, stay: 24, pop: 50000}',
    'Без популіції {desc: "Немає pop", timer: 0, stay: 12}',
    'Невірний таймер {desc: "Забагато", timer: 999, stay: 12, pop: 1000}'
  ].join('\n');

  const txtRes = importCardsContent({
    content: txt,
    kind: 'txt',
    category: 'cataclysm',
    existingText: ''
  });
  assert.equal(txtRes.addedCount, 1);
  assert.equal(txtRes.skippedCount, 2);
  assert.ok(txtRes.nextText.includes('Ядерна зима'));
  assert.ok(txtRes.nextText.includes('stay: 24'));

  const jsonContent = JSON.stringify({
    cards: [
      { name: 'Всесвітній потоп', desc: 'Вода затопила материки', timer: 0, stay: 36, pop: 120000 },
      { name: 'Помилковий', desc: 'Немає stay', pop: 500 }
    ]
  });
  const jsonRes = importCardsContent({
    content: jsonContent,
    kind: 'json',
    category: 'cataclysm',
    existingText: txtRes.nextText
  });
  assert.equal(jsonRes.addedCount, 1);
  assert.equal(jsonRes.skippedCount, 1);
  assert.equal(jsonRes.nextText.split('\n').length, 2);

  const allBad = importCardsContent({
    content: 'Розбитий катаклізм {desc: "Без обовʼязкових полів"}',
    kind: 'txt',
    category: 'cataclysm',
    existingText: 'Існуючий'
  });
  assert.equal(allBad.addedCount, 0);
  assert.ok(allBad.error);
  assert.equal(allBad.nextText, 'Існуючий');
});

test('importCardsContent (.json) підтримує масив рядків та обʼєктів для динамічних категорій', () => {
  const genderJson = JSON.stringify([
    { name: 'Кіборг', rep: false, no_age: true },
    { value: 'Жінка', meta: { can_reproduce: true, opposite: 'Чоловік' } },
    { name: 'Невалідний діапазон', age_min: 50, age_max: 20 }
  ]);

  const res = importCardsContent({
    content: genderJson,
    kind: 'json',
    category: 'gender',
    existingText: ''
  });

  assert.equal(res.addedCount, 2);
  assert.equal(res.skippedCount, 1);
  assert.ok(res.nextText.includes('Кіборг {rep: false, no_age: true}'));
  assert.ok(res.nextText.includes('Жінка {rep: true, opp: "Чоловік"}'));
});

test('importStagesContent валідує стадії з числовим лімітом і прості стадії', () => {
  const profStagesTxt = [
    '1. Новачок: 11',
    '2. Стажер: 35',
    '3. Помилка: -5',
    '4. ПомилкаТекст: абв',
    '5. Експерт'
  ].join('\n');

  const res = importStagesContent({
    content: profStagesTxt,
    kind: 'txt',
    stageKey: 'profession',
    existingText: 'Учень: 5'
  });

  assert.equal(res.addedCount, 3);
  assert.equal(res.skippedCount, 2);
  assert.equal(res.nextText, ['Учень: 5', 'Новачок: 11', 'Стажер: 35', 'Експерт'].join('\n'));
});


test('packEditorTemplate та PACK_EDITOR_TOUR_STEPS містять тулбар завантаження і підказки про .txt / .json у Режимі LLM', () => {
  const html = packEditorTemplate({ isEdit: false, isDefaultEdit: false });
  assert.ok(html.includes('id="pe-llm-toolbar"'));
  assert.ok(html.includes('id="pe-llm-upload-btn"'));
  assert.ok(html.includes('id="pe-llm-file-input"'));
  assert.ok(html.includes('id="pe-llm-drop-hint"'));
  assert.ok(html.includes('.txt'));
  assert.ok(html.includes('.json'));

  const listStep = PACK_EDITOR_TOUR_STEPS.find(s => s.id === 'cards-list');
  assert.ok(listStep);
  assert.ok(listStep.text.includes('.txt') && listStep.text.includes('.json'));
});

test('processDroppedLlmFiles обробляє dropped File-обʼєкти, додає записи і формує повідомлення для тосту', async () => {
  const makeFile = (name, text, type = 'text/plain') => ({
    name,
    type,
    size: Buffer.byteLength(text, 'utf8'),
    text: async () => text
  });

  const okRes = await processDroppedLlmFiles(
    [
      makeFile('part1.txt', '1. Лікар - лікує людей\n2. Пожежник - гасить вогонь'),
      makeFile('part2.json', JSON.stringify(['Біолог - вивчає віруси', 'Лікар - дублікат']), 'application/json')
    ],
    { mode: 'cards', targetKey: 'profession', existingText: 'Водій - керує транспортом' }
  );

  assert.equal(okRes.ok, true);
  assert.equal(okRes.addedCount, 3);
  assert.equal(okRes.skippedCount, 1);
  assert.ok(okRes.message.includes('3'));
  assert.ok(okRes.message.includes('1'));
  assert.equal(okRes.nextText.split('\n').length, 4);

  const badExtRes = await processDroppedLlmFiles(
    [makeFile('photo.png', 'binary', 'image/png')],
    { mode: 'cards', targetKey: 'profession', existingText: 'Водій' }
  );
  assert.equal(badExtRes.ok, false);
  assert.equal(badExtRes.nextText, 'Водій');
  assert.ok(badExtRes.message.includes('.txt'));
});
