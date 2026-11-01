import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedImageFormat, ALLOWED_MIME_TYPES, loadImage } from '../../js/utils/auth/image-file.js';

test('image-file: ALLOWED_MIME_TYPES contains standard web image formats', () => {
  assert.ok(ALLOWED_MIME_TYPES.has('image/jpeg'));
  assert.ok(ALLOWED_MIME_TYPES.has('image/png'));
  assert.ok(ALLOWED_MIME_TYPES.has('image/webp'));
  assert.ok(!ALLOWED_MIME_TYPES.has('image/gif'));
});

test('image-file: isAllowedImageFormat detects valid and invalid files by MIME or extension', () => {
  assert.equal(isAllowedImageFormat(null), false);
  assert.equal(isAllowedImageFormat(undefined), false);

  // By MIME
  assert.equal(isAllowedImageFormat({ type: 'image/jpeg', name: 'photo.bin' }), true);
  assert.equal(isAllowedImageFormat({ type: 'IMAGE/PNG', name: 'photo.bin' }), true);
  assert.equal(isAllowedImageFormat({ type: 'image/webp', name: 'photo.bin' }), true);
  assert.equal(isAllowedImageFormat({ type: 'image/gif', name: 'photo.bin' }), false);

  // By Extension fallback
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.jpg' }), true);
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.JPEG' }), true);
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.png' }), true);
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.webp' }), true);
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.gif' }), false);
  assert.equal(isAllowedImageFormat({ type: '', name: 'avatar.svg' }), false);
});

test('image-file: loadImage is exported as a function', () => {
  assert.equal(typeof loadImage, 'function');
});

