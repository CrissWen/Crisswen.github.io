import assert from 'node:assert';
import { register } from 'node:module';

// MINOR 5 (аудит етапу 3): тимчасова помилка завантаження аватарки не має блокувати її до F5.
// Зламана адреса блокується лише на короткий час (TTL) і одразу розблокується, коли мережа повернулась (подія online).

const STUBS = {
  '../services/avatar-service.js': `
    export function getCachedAvatar() { return globalThis.__avatarUrl; }
    export function hasCachedAvatar() { return true; }
    export function fetchAvatars() { return Promise.resolve(); }`
};
const hooksSource = `
  const STUBS = ${JSON.stringify(STUBS)};
  export async function resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.endsWith('avatar.js') && STUBS[specifier]) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
    }
    return next(specifier, context);
  }`;
register('data:text/javascript,' + encodeURIComponent(hooksSource));

// ===== Мінімальні глобальні об'єкти браузера =====
class FakeImage {
  constructor(src) {
    this._src = src;
    this.classList = { contains: (c) => c === 'avatar-img' };
    this.removed = false;
  }
  getAttribute() { return this._src; }
  remove() { this.removed = true; }
}
globalThis.HTMLImageElement = FakeImage;

const docListeners = {};
globalThis.document = {
  addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
  createElement() { return {}; }
};
const winListeners = {};
globalThis.window = {
  addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); }
};

const realNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => fakeNow;

const { avatarImgHtml } = await import('../../js/utils/avatar.js');

const URL1 = 'https://example.supabase.co/storage/v1/object/public/avatars/u1/a.png';
globalThis.__avatarUrl = URL1;

const failLoad = () => {
  const [onError] = docListeners.error;
  onError({ target: new FakeImage(URL1) });
};

// 1) Без помилок аватарка малюється
assert.ok(avatarImgHtml('u1').includes('<img'), 'аватарка має малюватись, поки помилок немає');

// 2) Після помилки завантаження адреса тимчасово блокується
failLoad();
assert.strictEqual(avatarImgHtml('u1'), '', 'зламана адреса блокується одразу після помилки');

// 3) Через TTL адреса знову дозволена (без перезавантаження сторінки)
fakeNow += 5 * 60 * 1000;
assert.ok(avatarImgHtml('u1').includes('<img'), 'I: після TTL аватарка має знову підставлятись');

// 4) Подія online знімає блокування одразу
failLoad();
assert.strictEqual(avatarImgHtml('u1'), '', 'знову заблоковано');
assert.ok((winListeners.online || []).length > 0, 'avatar.js має слухати подію online');
winListeners.online.forEach((fn) => fn());
assert.ok(avatarImgHtml('u1').includes('<img'), 'online має розблокувати зламані адреси');

Date.now = realNow;
console.log('avatar-broken-url: ok');
