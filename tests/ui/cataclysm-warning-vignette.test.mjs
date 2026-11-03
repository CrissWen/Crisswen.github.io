import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mountCataclysmVignette,
  unmountCataclysmVignette,
  isCataclysmVignetteMounted
} from '../../js/fx/cataclysm-vignette.js';

describe('Cataclysm Vignette Lifecycle', () => {
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
          remove() {
            if (el.id) elements.delete(el.id);
          }
        };
        return el;
      },
      body: {
        appendChild(el) {
          if (el.id) elements.set(el.id, el);
          return el;
        }
      }
    };
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it('повинен створювати та видаляти елемент червоної димки в DOM', () => {
    assert.strictEqual(isCataclysmVignetteMounted(), false);
    const el = mountCataclysmVignette();
    assert.ok(el, 'mountCataclysmVignette має повертати створений елемент');
    assert.strictEqual(el.id, 'cataclysm-hazard-vignette');
    assert.ok(el.classList.contains('cataclysm-hazard-vignette'));
    assert.strictEqual(isCataclysmVignetteMounted(), true);

    // Повторний виклик не створює дублікатів
    const secondEl = mountCataclysmVignette();
    assert.strictEqual(secondEl, el);

    unmountCataclysmVignette();
    assert.strictEqual(isCataclysmVignetteMounted(), false);
  });
});

