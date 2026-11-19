import test from 'node:test';
import assert from 'node:assert/strict';

function createMockRoot() {
  const listeners = new Map();
  const root = {
    addEventListener(type, fn, opts) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ fn, opts });
    },
    dispatch(type, evt) {
      for (const { fn } of listeners.get(type) || []) {
        fn(evt);
      }
    },
    getListeners(type) {
      return listeners.get(type) || [];
    }
  };
  return root;
}

test('bindWidgets prevents wheel stepping on input[type="number"] and preserves stepper clicks', async () => {
  const mockRoot = createMockRoot();
  globalThis.document = {
    getElementById: (id) => (id === 'pe-root' ? mockRoot : null),
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {} })
  };
  globalThis.Event = class FakeEvent {
    constructor(type, opts = {}) {
      this.type = type;
      this.bubbles = Boolean(opts.bubbles);
    }
  };

  const { bindWidgets } = await import('../../js/pack-editor/bindings/widgets.js');
  const controller = new AbortController();
  bindWidgets({ signal: controller.signal });

  // 1. Wheel on input[type="number"] should call preventDefault()
  let preventedNumber = false;
  mockRoot.dispatch('wheel', {
    target: { tagName: 'INPUT', type: 'number' },
    preventDefault() { preventedNumber = true; }
  });
  assert.equal(preventedNumber, true, 'wheel on number input must be prevented');

  // 2. Wheel on non-number element must NOT call preventDefault()
  let preventedDiv = false;
  mockRoot.dispatch('wheel', {
    target: { tagName: 'DIV' },
    preventDefault() { preventedDiv = true; }
  });
  assert.equal(preventedDiv, false, 'wheel on non-number element must not be prevented');

  // 3. Stepper button click still works
  let steppedUp = false;
  const dispatched = [];
  const numInput = {
    disabled: false,
    stepUp() { steppedUp = true; },
    stepDown() {},
    dispatchEvent(e) { dispatched.push(e.type); }
  };
  const stepperBtn = {
    dataset: { step: 'up' },
    closest: (sel) => (sel === '.pe-stepper' ? { querySelector: () => numInput } : null)
  };
  mockRoot.dispatch('click', {
    target: {
      closest: (sel) => (sel === '.pe-stepper__btn' ? stepperBtn : null)
    }
  });
  assert.equal(steppedUp, true);
  assert.deepEqual(dispatched, ['input', 'change']);
});
