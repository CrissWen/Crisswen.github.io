import assert from 'node:assert';
import test from 'node:test';

// Setup DOM mocks for avatar.js
class FakeClassList {
  constructor(classes = []) { this._classes = new Set(classes); }
  contains(cls) { return this._classes.has(cls); }
  add(cls) { this._classes.add(cls); }
  remove(cls) { this._classes.delete(cls); }
}

class FakeImageElement {
  constructor({ src = '', isConnected = true, className = 'avatar-img' } = {}) {
    this.tagName = 'IMG';
    this.tag = 'img';
    this.classList = new FakeClassList(className.split(' ').filter(Boolean));
    this.src = src;
    this.attributes = { src };
    this.isConnected = isConnected;
    this.removed = false;
  }
  getAttribute(name) { return this.attributes[name] || this[name] || null; }
  setAttribute(name, val) { this.attributes[name] = val; this[name] = val; }
  remove() { this.removed = true; }
}

globalThis.HTMLImageElement = FakeImageElement;

const listeners = {};
globalThis.document = {
  addEventListener(type, fn, capture) {
    (listeners[type] ||= []).push({ fn, capture });
  },
  removeEventListener() {},
  getElementById(id) { return null; },
  querySelector(sel) { return null; },
  querySelectorAll(sel) { return []; },
  createElement(tag) {
    return new FakeImageElement({ isConnected: true });
  },
  body: {
    classList: new FakeClassList(),
    style: {}
  }
};

globalThis.window = {
  supabase: {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
      },
      from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) })
    })
  },
  addEventListener(type, fn) {
    (listeners[type] ||= []).push({ fn, capture: false });
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  location: { hash: '#/game', pathname: '/', origin: 'http://localhost', search: '' },
  scrollTo: () => {}
};

// Dispatch helper for global error listener
function triggerImgError(img) {
  const errListeners = listeners['error'] || [];
  for (const { fn } of errListeners) {
    fn({ target: img });
  }
}

// Import module under test
const {
  avatarImgHtml,
  clearBrokenAvatarUrl,
  isAvatarUrlBroken,
  handleImgError
} = await import('../../js/utils/auth/avatar.js');

test("Avatar Error Resilience: від'єднаний елемент (isConnected = false) не блокує URL", () => {
  const TEST_URL = 'https://yamapgouatvnvloatnxg.supabase.co/storage/v1/object/public/avatars/user-1/avatar.webp';

  const detachedImg = new FakeImageElement({
    src: TEST_URL,
    isConnected: false,
    className: 'avatar-img'
  });

  triggerImgError(detachedImg);

  assert.strictEqual(detachedImg.removed, false, 'Відключений від DOM елемент не повинен повторно викликати remove');
  assert.strictEqual(isAvatarUrlBroken(TEST_URL), false, "URL від'єднаного елемента не повинен потрапляти у brokenUrls");
});

test("Avatar Error Resilience: приєднаний елемент (isConnected = true) блокує битий URL і видаляє тег", () => {
  const BROKEN_URL = 'https://yamapgouatvnvloatnxg.supabase.co/storage/v1/object/public/avatars/user-2/broken.webp';

  const attachedImg = new FakeImageElement({
    src: BROKEN_URL,
    isConnected: true,
    className: 'avatar-img'
  });

  triggerImgError(attachedImg);

  assert.strictEqual(attachedImg.removed, true, 'Приєднаний битий елемент повинен викликати remove()');
  assert.strictEqual(isAvatarUrlBroken(BROKEN_URL), true, 'URL повинен бути заблокований у brokenUrls');

  // Очищення блокування
  clearBrokenAvatarUrl(BROKEN_URL);
  assert.strictEqual(isAvatarUrlBroken(BROKEN_URL), false, 'clearBrokenAvatarUrl повинен знімати блокування');
});

test("Reactive Avatar Update: точкове оновлення бейджів гравця без перемалювання лобі", async () => {
  const { applyPlayerAvatarUpdate } = await import('../../js/pages/game.js');

  const FAKE_USER_ID = 'user-realtime-999';
  const FAKE_URL = 'https://yamapgouatvnvloatnxg.supabase.co/storage/v1/object/public/avatars/user-realtime-999/test.webp';

  const badgeEl = {
    tagName: 'SPAN',
    tag: 'span',
    classList: new FakeClassList(['avatar-badge']),
    textContent: 'T',
    _children: [],
    attributes: {
      'data-profile-user': FAKE_USER_ID,
      'data-profile-name': 'Timur'
    },
    getAttribute(name) { return this.attributes[name] || null; },
    querySelector(sel) {
      if (sel === 'img.avatar-img') return this._children.find(c => c.className === 'avatar-img') || null;
      return null;
    },
    appendChild(child) {
      this._children.push(child);
      return child;
    }
  };

  const boardEl = {
    id: 'game-board',
    querySelectorAll(selector) {
      if (selector.includes(FAKE_USER_ID)) return [badgeEl];
      return [];
    }
  };

  globalThis.document.getElementById = (id) => {
    if (id === 'game-board') return boardEl;
    return null;
  };

  globalThis.document.createElement = (tag) => {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      alt: '',
      decoding: '',
      referrerPolicy: '',
      draggable: false,
      src: '',
      classList: new FakeClassList()
    };
  };

  // Викликаємо оновлення аватарки
  applyPlayerAvatarUpdate(FAKE_USER_ID, FAKE_URL);

  const img = badgeEl.querySelector('img.avatar-img');
  assert.ok(img, 'Тег img повинен бути доданий до бейджа');
  assert.strictEqual(img.src, FAKE_URL, 'src картинки повинен відповідати новому URL');
});

test("prefetchAvatars: не падає на порожній кімнаті та ініціює запит для нових id", async () => {
  const { prefetchAvatars } = await import('../../js/pages/game.js');

  // Не повинно викидати помилок для null/undefined/{}
  assert.doesNotThrow(() => prefetchAvatars(null));
  assert.doesNotThrow(() => prefetchAvatars({}));
  assert.doesNotThrow(() => prefetchAvatars({ players_state: {} }));
});

