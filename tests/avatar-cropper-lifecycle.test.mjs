import assert from 'node:assert';

// I-6: повторний openAvatarCropper() не повинен лишати попередній проміс висіти назавжди,
// а паралельні виклики не повинні змагатися за спільний стан модуля (imgSource, dialog).

const ctx2d = new Proxy({}, { get: () => () => {} });
function makeEl(tag = 'div') {
  return {
    tag, style: {}, listeners: {}, _children: {}, open: false, value: '1', innerHTML: '',
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    setAttribute() {},
    appendChild() {},
    getContext: () => ctx2d,
    setPointerCapture() {},
    releasePointerCapture() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    toBlob(cb) { cb({ type: 'image/webp', size: 1 }); },
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    querySelector(sel) { return (this._children[sel] ||= makeEl()); },
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); },
  };
}

globalThis.HTMLDialogElement = class {};
globalThis.HTMLDialogElement.prototype.closedBy = ''; // пропускаємо fallback кліку по backdrop
const dialogs = [];
globalThis.document = {
  createElement: tag => { const el = makeEl(tag); if (tag === 'dialog') dialogs.push(el); return el; },
  body: { appendChild() {} },
  documentElement: {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

let bitmapQueue = [];
const closedBitmaps = [];
function makeBitmap(label) { return { width: 400, height: 400, label, close() { closedBitmaps.push(label); } }; }
globalThis.__nextBitmap = () => Promise.resolve(makeBitmap('auto'));
const createImageBitmap = (...args) => globalThis.__nextBitmap(...args);
globalThis.createImageBitmap = createImageBitmap;
globalThis.window = { createImageBitmap };

const { openAvatarCropper } = await import('../js/ui/avatar-cropper-modal.js');

const file = name => ({ type: 'image/png', name });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HUNG = Symbol('hung');
const settle = (p, ms = 60) => Promise.race([p, sleep(ms).then(() => HUNG)]);
const dlg = () => dialogs[0];
const btn = sel => dlg().querySelector(sel);

let failed = 0;
async function check(name, fn) {
  try {
    closedBitmaps.length = 0;
    globalThis.__nextBitmap = () => Promise.resolve(makeBitmap('auto'));
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
  // гарантуємо закритий діалог для наступного кроку
  if (dialogs[0]) { try { btn('#avatar-crop-cancel-btn').click(); } catch (_) {} }
  await sleep(0);
}

console.log('Running avatar-cropper-lifecycle tests...');

await check('регресія: скасування закриває діалог і повертає null', async () => {
  const p = openAvatarCropper(file('a.png'));
  await sleep(0);
  assert.strictEqual(dlg().open, true);
  btn('#avatar-crop-cancel-btn').click();
  assert.strictEqual(await settle(p), null);
  assert.strictEqual(dlg().open, false);
});

await check('регресія: «Застосувати» повертає обрізаний Blob', async () => {
  const p = openAvatarCropper(file('a.png'));
  await sleep(0);
  btn('#avatar-crop-apply-btn').click();
  const res = await settle(p);
  assert.ok(res && res.type === 'image/webp', 'очікували Blob із WebP');
});

await check('I-6: повторне відкриття завершує попередній проміс значенням null', async () => {
  const p1 = openAvatarCropper(file('a.png'));
  await sleep(0);
  const p2 = openAvatarCropper(file('b.png'));
  await sleep(0);
  const r1 = await settle(p1);
  assert.notStrictEqual(r1, HUNG, 'попередній проміс завис назавжди');
  assert.strictEqual(r1, null);
  btn('#avatar-crop-cancel-btn').click();
  assert.strictEqual(await settle(p2), null);
});

await check('I-6: після повторного відкриття діалог лишається відкритим для нового виклику', async () => {
  const p1 = openAvatarCropper(file('a.png'));
  await sleep(0);
  const p2 = openAvatarCropper(file('b.png'));
  await sleep(0);
  assert.strictEqual(dlg().open, true, 'діалог закрито старим викликом');
  btn('#avatar-crop-apply-btn').click();
  const r2 = await settle(p2);
  assert.ok(r2 && r2.type === 'image/webp', 'новий виклик не отримав результат');
  assert.strictEqual(await settle(p1), null);
});

await check('I-6: паралельні виклики під час завантаження зображення не змагаються за стан', async () => {
  const resolvers = [];
  globalThis.__nextBitmap = () => new Promise(res => resolvers.push(res));
  const p1 = openAvatarCropper(file('a.png'));
  const p2 = openAvatarCropper(file('b.png'));
  await sleep(0);
  assert.strictEqual(resolvers.length, 2, 'обидва виклики мали почати читання');
  resolvers[0](makeBitmap('first'));
  resolvers[1](makeBitmap('second'));
  const r1 = await settle(p1);
  assert.strictEqual(r1, null, 'застарілий виклик має завершитись null, а не зависнути');
  assert.ok(closedBitmaps.includes('first'), 'bitmap застарілого виклику має бути звільнений');
  assert.strictEqual(dlg().open, true);
  btn('#avatar-crop-apply-btn').click();
  const r2 = await settle(p2);
  assert.ok(r2 && r2.type === 'image/webp', 'актуальний виклик має отримати результат');
});

await check('I-6: невірний формат кидає помилку і не зачіпає відкритий діалог', async () => {
  const p1 = openAvatarCropper(file('a.png'));
  await sleep(0);
  await assert.rejects(() => openAvatarCropper({ type: 'text/plain', name: 'a.txt' }), /JPEG, PNG, WebP/);
  assert.strictEqual(dlg().open, true);
  btn('#avatar-crop-cancel-btn').click();
  assert.strictEqual(await settle(p1), null);
});

if (failed) {
  console.error(`FAIL: avatar-cropper-lifecycle (${failed} failed)`);
  process.exit(1);
}
console.log('PASS: all avatar-cropper-lifecycle tests passed!');
process.exit(0);
