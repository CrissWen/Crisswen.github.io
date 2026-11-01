import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryManager } from '../../js/pack-editor/history.js';

test('HistoryManager: undo and redo do not lose action from stack if applier throws (Minor 1)', () => {
  const hm = new HistoryManager(10);
  hm.pushAction({
    type: 'CARD_EDIT',
    category: 'profession',
    description: 'Зміна: Професія',
    before: { profession: { text: 'A' } },
    after: { profession: { text: 'B' } }
  });

  hm.setApplier(() => {
    throw new Error('DOM applier failure');
  });

  assert.throws(() => hm.undo(), /DOM applier failure/);
  assert.equal(hm.canUndo(), true, 'Action must remain in undoStack when applier throws');
  assert.equal(hm.canRedo(), false, 'Action must not be pushed to redoStack when applier throws');

  // Тепер applier працює нормально -> undo проходить, а потім тестуємо збій у redo
  let failRedo = false;
  hm.setApplier((snap, action, dir) => {
    if (dir === 'redo' && failRedo) throw new Error('Redo DOM failure');
  });

  hm.undo();
  assert.equal(hm.canUndo(), false);
  assert.equal(hm.canRedo(), true);

  failRedo = true;
  assert.throws(() => hm.redo(), /Redo DOM failure/);
  assert.equal(hm.canRedo(), true, 'Action must remain in redoStack when redo applier throws');
  assert.equal(hm.canUndo(), false);
});

