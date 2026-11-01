import assert from 'node:assert';
import test from 'node:test';

function makeEl(tag = 'div') {
  return {
    tag,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '',
    draggable: false,
    _children: [],
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(child) { this._children.push(child); return child; },
    querySelector(sel) {
      if (sel === 'img.avatar-img') return this._children.find(c => c.className === 'avatar-img') || null;
      return null;
    },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; }
  };
}

const fakeAvatarEl = makeEl('div');
fakeAvatarEl.textContent = 'A';

const fakeNameEl = makeEl('span');
fakeNameEl.textContent = 'Alex';

const domElements = {
  'app': makeEl('div'),
  'global-header': makeEl('header'),
  'header-user-name': fakeNameEl,
  'header-user-avatar': fakeAvatarEl,
  'header-audio-widget': null,
  'header-audio-btn': null,
  'header-audio-master-slider': null,
  'header-audio-master-val': null,
  'header-audio-open-settings': null
};

globalThis.window = {
  supabase: {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
      }
    })
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  location: { hash: '#/lobby', pathname: '/', origin: 'http://localhost' },
  scrollTo: () => {}
};

globalThis.document = {
  createElement: tag => makeEl(tag),
  getElementById: (id) => domElements[id] || null,
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => [],
  activeElement: null
};

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { handleHeaderAvatarChange, setCurrentSessionUserId } = await import('../../js/app.js');

test('Header Avatar Isolation: чужі аватарки не потрапляють у хедер поточного гравця', () => {
  const CURRENT_USER_ID = '11111111-aaaa-bbbb-cccc-111111111111';
  const OTHER_USER_ID = '22222222-xxxx-yyyy-zzzz-222222222222';
  const OTHER_AVATAR_URL = 'https://yamapgouatvnvloatnxg.supabase.co/storage/v1/object/public/avatars/22222222-xxxx-yyyy-zzzz-222222222222/avatar.webp';
  const MY_AVATAR_URL = 'https://yamapgouatvnvloatnxg.supabase.co/storage/v1/object/public/avatars/11111111-aaaa-bbbb-cccc-111111111111/avatar.webp';

  // 1. Поточний користувач залогінений як CURRENT_USER_ID
  setCurrentSessionUserId(CURRENT_USER_ID);

  // 2. Імітуємо подію зміни або підвантаження аватарки чужого гравця (OTHER_USER_ID)
  const handledOther = handleHeaderAvatarChange(OTHER_AVATAR_URL, OTHER_USER_ID);

  // Очікуємо: подія для чужого гравця повністю ігнорується
  assert.strictEqual(handledOther, false, 'Подія для чужого id не повинна оброблятись');
  assert.strictEqual(fakeAvatarEl.querySelector('img.avatar-img'), null, 'Аватарка в хедері не повинна підмінятися чужим зображенням');

  // 3. Імітуємо подію для власного користувача (CURRENT_USER_ID)
  const handledOwn = handleHeaderAvatarChange(MY_AVATAR_URL, CURRENT_USER_ID);

  // Очікуємо: власна аватарка застосовується
  assert.strictEqual(handledOwn, true, 'Власна аватарка повинна бути застосована');
  const img = fakeAvatarEl.querySelector('img.avatar-img');
  assert.ok(img, 'Аватарка повинна бути додана в DOM');
  assert.strictEqual(img.src, MY_AVATAR_URL, 'URL повинен відповідати власній аватарці');

  // 4. Без активної сесії (null) жодні оновлення не змінюють хедер
  setCurrentSessionUserId(null);
  fakeAvatarEl._children = [];
  const handledUnauthed = handleHeaderAvatarChange(MY_AVATAR_URL, CURRENT_USER_ID);
  assert.strictEqual(handledUnauthed, false, 'Без активної сесії оновлення повинні блокуватися');
  assert.strictEqual(fakeAvatarEl.querySelector('img.avatar-img'), null, 'Хедер не повинен змінюватися');
});
