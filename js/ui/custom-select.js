/**
 * Universal Custom Select Component (.pe-select-custom)
 * 
 * Automatically enhances standard <select> elements into accessible, styled custom dropdowns
 * conforming to TrueBunker design system (.pe-select-custom from packs.css).
 * 
 * Provides:
 * - Two-way sync with native <select> (fires native 'change' & 'input' events)
 * - Dynamic options sync via MutationObserver
 * - Full keyboard navigation (ArrowUp/ArrowDown/Home/End move the highlight only; Enter/Space confirm; Escape/Tab close without change)
 * - Complete accessibility (ARIA combobox: role="combobox", aria-controls, aria-activedescendant, aria-expanded, role="listbox", role="option")
 * - Outside click handling
 */

// Keep track of registered document listeners
let globalListenersAttached = false;
let customSelectUid = 0; // унікальні id для listbox/опцій (потрібні aria-controls та aria-activedescendant)

function ensureGlobalListeners() {
  if (globalListenersAttached || typeof document === 'undefined') return;
  globalListenersAttached = true;

  document.addEventListener('click', (e) => {
    // If click was outside any .pe-select-custom, close all open dropdowns
    if (!e.target.closest('.pe-select-custom')) {
      closeAllCustomSelects();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomSelects();
    }
  });
}

/**
 * Closes all open custom select dropdowns on the page
 * @param {HTMLElement} [exceptWrap] - Optional wrap element to keep open
 */
export function closeAllCustomSelects(exceptWrap = null) {
  document.querySelectorAll('.pe-select-custom__dropdown').forEach(drop => {
    const wrap = drop.closest('.pe-select-custom');
    if (wrap && wrap === exceptWrap) return;
    drop.hidden = true;
    drop.style.display = 'none';
    drop.classList.remove('is-drop-up');
    if (wrap) wrap.classList.remove('is-open');
    const btn = wrap?.querySelector('.pe-select-custom__btn');
    if (btn) {
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-activedescendant');
    }
    drop.querySelectorAll('.is-active').forEach(item => item.classList.remove('is-active'));
  });
}

/**
 * Synchronizes the custom UI with the native <select> state
 * @param {HTMLSelectElement} selectEl
 */
export function syncCustomSelect(selectEl) {
  if (!selectEl || !selectEl._customSelect) return;
  const { renderItems, btn, label } = selectEl._customSelect;
  if (typeof renderItems === 'function') {
    renderItems();
  }
}

/**
 * Initializes a single <select> element into a .pe-select-custom widget
 * @param {HTMLSelectElement} selectEl
 * @param {Object} [options]
 * @returns {HTMLElement} The wrapper element
 */
export function initCustomSelect(selectEl, options = {}) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return null;

  ensureGlobalListeners();

  // If already initialized, just re-sync and return wrapper
  if (selectEl._customSelect && selectEl._customSelect.wrap) {
    syncCustomSelect(selectEl);
    return selectEl._customSelect.wrap;
  }

  // Read explicit inline styles from select BEFORE applying hidden styles
  const initialWidth = selectEl.style.width;
  const initialMinWidth = selectEl.style.minWidth;
  const initialMaxWidth = selectEl.style.maxWidth;
  const initialFlex = selectEl.style.flex;
  const initialFlexShrink = selectEl.style.flexShrink;
  const initialZIndex = selectEl.style.zIndex;

  // Hide the native select accessibly
  selectEl.classList.add('pe-hidden-select');
  selectEl.style.position = 'absolute';
  selectEl.style.width = '1px';
  selectEl.style.height = '1px';
  selectEl.style.padding = '0';
  selectEl.style.margin = '-1px';
  selectEl.style.overflow = 'hidden';
  selectEl.style.clip = 'rect(0, 0, 0, 0)';
  selectEl.style.whiteSpace = 'nowrap';
  selectEl.style.border = '0';
  selectEl.style.opacity = '0';
  selectEl.style.pointerEvents = 'none';
  selectEl.setAttribute('tabindex', '-1');
  selectEl.setAttribute('aria-hidden', 'true');

  // Create custom wrapper
  const wrap = document.createElement('div');
  wrap.className = 'pe-select-custom';
  wrap.dataset.peSelectWrap = '';
  if (selectEl.id) {
    wrap.dataset.for = selectEl.id;
  }

  // Inherit explicit layout styles from select (width, flex, z-index, etc.)
  if (initialWidth && initialWidth !== '1px') wrap.style.width = initialWidth;
  if (initialMinWidth) wrap.style.minWidth = initialMinWidth;
  if (initialMaxWidth) wrap.style.maxWidth = initialMaxWidth;
  if (initialFlex) wrap.style.flex = initialFlex;
  if (initialFlexShrink) wrap.style.flexShrink = initialFlexShrink;
  if (initialZIndex) wrap.style.zIndex = initialZIndex;
  if (selectEl.style.display === 'none') wrap.style.display = 'none';

  // Insert wrapper into DOM right where the select is
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);

  // Trigger button
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pe-select-custom__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  if (selectEl.disabled) btn.disabled = true;

  const label = document.createElement('span');
  label.className = 'pe-select-custom__label';

  // SVG arrow (matches bunker icon style)
  const arrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrowSvg.setAttribute('class', 'pe-select-custom__arrow svg-icon');
  arrowSvg.setAttribute('viewBox', '0 0 24 24');
  arrowSvg.setAttribute('width', '14');
  arrowSvg.setAttribute('height', '14');
  arrowSvg.setAttribute('fill', 'none');
  arrowSvg.setAttribute('stroke', 'currentColor');
  arrowSvg.setAttribute('stroke-width', '2');
  arrowSvg.setAttribute('stroke-linecap', 'round');
  arrowSvg.setAttribute('stroke-linejoin', 'round');
  arrowSvg.setAttribute('aria-hidden', 'true');
  arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

  btn.appendChild(label);
  btn.appendChild(arrowSvg);
  wrap.appendChild(btn);

  // Dropdown list
  const dropdown = document.createElement('div');
  dropdown.className = 'pe-select-custom__dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.hidden = true;
  dropdown.style.display = 'none';
  wrap.appendChild(dropdown);

  // ARIA combobox (select-only): кнопка керує listbox, а підсвічена опція повідомляється через aria-activedescendant
  const uid = ++customSelectUid;
  const listId = 'pe-select-list-' + uid;
  dropdown.id = listId;
  btn.setAttribute('role', 'combobox');
  btn.setAttribute('aria-controls', listId);
  const ariaLabel = selectEl.getAttribute && selectEl.getAttribute('aria-label');
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);

  // Значення опції, яку зараз підсвічено клавіатурою (null — нічого). Значення <select> змінюється лише після Enter/Space/кліку.
  let activeValue = null;

  function applyActive() {
    let found = null;
    dropdown.querySelectorAll('.pe-select-custom__item').forEach(item => {
      const on = activeValue !== null && item.dataset.value === activeValue;
      item.classList.toggle('is-active', on);
      if (on) found = item;
    });
    if (found && !dropdown.hidden) btn.setAttribute('aria-activedescendant', found.id);
    else btn.removeAttribute('aria-activedescendant');
    return found;
  }

  function setActive(value) {
    activeValue = value;
    const found = applyActive();
    if (found) found.scrollIntoView({ block: 'nearest' });
  }

  function clearActive() {
    activeValue = null;
    applyActive();
  }

  function openDropdown() {
    if (btn.disabled) return;
    closeAllCustomSelects(wrap);

    // Smart flip: check if space below is too small (< 220px) and space above is larger
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < 220 && spaceAbove > spaceBelow) {
      dropdown.classList.add('is-drop-up');
    } else {
      dropdown.classList.remove('is-drop-up');
    }

    dropdown.hidden = false;
    dropdown.style.display = '';
    btn.classList.add('is-open');
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    const sel = dropdown.querySelector('.pe-select-custom__item.is-selected')
      || dropdown.querySelector('.pe-select-custom__item:not(.is-disabled)');
    if (sel) setActive(sel.dataset.value);
  }

  function closeDropdown() {
    dropdown.hidden = true;
    dropdown.style.display = 'none';
    dropdown.classList.remove('is-drop-up');
    btn.classList.remove('is-open');
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    clearActive();
  }

  function toggleDropdown() {
    if (dropdown.hidden || dropdown.style.display === 'none') openDropdown();
    else closeDropdown();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Keyboard navigation on trigger button.
  // Стрілки/Home/End лише рухають підсвітку; значення міняється тільки після Enter/Space (або кліку). Escape/Tab закривають без змін.
  btn.addEventListener('keydown', (e) => {
    const items = Array.from(dropdown.querySelectorAll('.pe-select-custom__item:not(.is-disabled)'));
    if (!items.length) return;
    const isOpen = !dropdown.hidden;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      const currentIdx = items.findIndex(it => it.dataset.value === activeValue);
      let nextIdx;
      if (currentIdx === -1) nextIdx = e.key === 'ArrowDown' ? 0 : items.length - 1;
      else nextIdx = e.key === 'ArrowDown' ? currentIdx + 1 : currentIdx - 1;
      if (nextIdx < 0) nextIdx = items.length - 1;
      if (nextIdx >= items.length) nextIdx = 0;
      setActive(items[nextIdx].dataset.value);
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!isOpen) return;
      e.preventDefault();
      setActive(items[e.key === 'Home' ? 0 : items.length - 1].dataset.value);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        openDropdown();
        return;
      }
      const target = items.find(it => it.dataset.value === activeValue);
      if (target) selectValue(target.dataset.value);
      closeDropdown();
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeDropdown();
    } else if (e.key === 'Tab' && isOpen) {
      closeDropdown();
    }
  });

  function selectValue(val) {
    if (selectEl.value !== val) {
      selectEl.value = val;
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderItems();
  }

  function renderItems() {
    dropdown.innerHTML = '';
    const optionsList = Array.from(selectEl.options);
    const currentVal = selectEl.value;
    let currentLabelText = '';

    optionsList.forEach((opt, idx) => {
      const isSel = opt.value === currentVal || (!currentVal && idx === 0 && !optionsList.some(o => o.selected));
      if (isSel) {
        currentLabelText = opt.textContent;
      }

      const item = document.createElement('div');
      item.className = 'pe-select-custom__item' + (isSel ? ' is-selected' : '');
      item.setAttribute('role', 'option');
      item.id = listId + '-opt-' + idx;
      item.setAttribute('data-value', opt.value);
      item.setAttribute('aria-selected', String(isSel));
      if (opt.disabled) {
        item.classList.add('is-disabled');
      }

      const check = document.createElement('span');
      check.className = 'pe-select-custom__check';
      check.textContent = isSel ? '✓' : '';

      const text = document.createElement('span');
      text.className = 'pe-select-custom__text';
      text.textContent = opt.textContent;

      item.appendChild(check);
      item.appendChild(text);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (opt.disabled) return;
        selectValue(opt.value);
        closeDropdown();
        btn.focus();
      });

      dropdown.appendChild(item);
    });

    label.textContent = currentLabelText || (optionsList[0] ? optionsList[0].textContent : '—');
    btn.disabled = Boolean(selectEl.disabled);
    applyActive(); // перемальовування (зміна значення/опцій) не має губити підсвітку відкритого списку
  }

  // Sync when native select changes programmatically via change/input events
  selectEl.addEventListener('change', () => {
    renderItems();
  });

  // Intercept programmatic .value assignments to automatically sync custom UI
  const protoDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (protoDescriptor && protoDescriptor.set) {
    Object.defineProperty(selectEl, 'value', {
      get() {
        return protoDescriptor.get.call(this);
      },
      set(newVal) {
        protoDescriptor.set.call(this, newVal);
        renderItems();
      },
      configurable: true
    });
  }

  // Watch for dynamic DOM changes to <option> tags, disabled, and style.display
  const observer = new MutationObserver(() => {
    renderItems();
    if (selectEl.style.display === 'none') {
      wrap.style.display = 'none';
    } else if (wrap.style.display === 'none' && selectEl.style.display !== 'none') {
      wrap.style.display = '';
    }
  });
  observer.observe(selectEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'selected', 'value', 'style']
  });

  // Initial render
  renderItems();

  // Store instance references
  selectEl._customSelect = {
    wrap,
    btn,
    label,
    dropdown,
    renderItems,
    openDropdown,
    closeDropdown,
    observer,
    destroy() {
      observer.disconnect();
      wrap.parentNode.insertBefore(selectEl, wrap);
      wrap.remove();
      selectEl.classList.remove('pe-hidden-select');
      selectEl.removeAttribute('tabindex');
      selectEl.removeAttribute('aria-hidden');
      delete selectEl.value;
      delete selectEl._customSelect;
    }
  };

  return wrap;
}

/**
 * Initializes all matching <select> elements in a container
 * @param {ParentNode} [container=document]
 * @param {string} [selector='select.pe-select-custom, select.pe-auto-select']
 * @returns {HTMLElement[]} Array of initialized wrappers
 */
export function initCustomSelects(container = document, selector = 'select.pe-select-custom, select.pe-auto-select') {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  const selects = Array.from(container.querySelectorAll(selector));
  return selects.map(sel => initCustomSelect(sel)).filter(Boolean);
}

/**
 * Destroys a custom select instance and restores native element
 * @param {HTMLSelectElement} selectEl
 */
export function destroyCustomSelect(selectEl) {
  if (selectEl && selectEl._customSelect && typeof selectEl._customSelect.destroy === 'function') {
    selectEl._customSelect.destroy();
  }
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initCustomSelects());
  } else {
    initCustomSelects();
  }
}

// Global browser window attachment
if (typeof window !== 'undefined') {
  window.CustomSelect = {
    initCustomSelect,
    initCustomSelects,
    syncCustomSelect,
    destroyCustomSelect,
    closeAllCustomSelects
  };
  window.initCustomSelects = initCustomSelects;
}
