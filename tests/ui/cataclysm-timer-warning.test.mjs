import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeSupabaseEnv } from '../helpers/fake-supabase.mjs';

installFakeSupabaseEnv();

const {
  mountCataclysmTimer,
  unmountCataclysmTimer,
  syncCataclysmTimer
} = await import('../../js/game-modules/timers/cataclysm-timer.js');

describe('Cataclysm Timer 5s Warning', () => {
  let originalDocument;

  beforeEach(() => {
    originalDocument = globalThis.document;
    const elements = new Map();
    globalThis.document = {
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement(tag) {
        const el = {
          tagName: tag.toUpperCase(),
          id: '',
          className: '',
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); el.className = Array.from(this.classes).join(' '); },
            remove(c) { this.classes.delete(c); el.className = Array.from(this.classes).join(' '); },
            contains(c) { return this.classes.has(c); }
          },
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = String(v); },
          getAttribute(k) { return this.attributes[k]; },
          querySelector(sel) {
            return { textContent: '', style: {} };
          },
          remove() {
            if (el.id) elements.delete(el.id);
          }
        };
        return el;
      },
      body: {
        insertAdjacentHTML(pos, html) {
          const match = html.match(/id="([^"]+)"/);
          if (match) {
            const id = match[1];
            const el = globalThis.document.createElement('div');
            el.id = id;
            elements.set(id, el);
          }
        },
        appendChild(el) {
          if (el.id) elements.set(el.id, el);
          return el;
        }
      }
    };
  });

  afterEach(() => {
    unmountCataclysmTimer();
    globalThis.document = originalDocument;
  });

  it('повинен підтримувати реєстрацію onWarning5s і викликати його при <= 5с', () => {
    let warningCalled = false;
    let expiredCalled = false;
    mountCataclysmTimer({
      onExpire: () => { expiredCalled = true; },
      onWarning5s: () => { warningCalled = true; }
    });

    const now = Date.now();
    const fakeState = { cataclysm_timer_end: now + 4000 };
    syncCataclysmTimer(fakeState, 'in_progress');

    assert.strictEqual(warningCalled, true, 'onWarning5s повинен спрацювати при <= 5с');
    assert.strictEqual(expiredCalled, false, 'onExpire не повинен спрацьовувати завчасно');
  });
});
