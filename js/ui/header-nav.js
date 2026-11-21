let activeController = null;

/**
 * Closes the currently active mobile header navigation dropdown, if any.
 */
export function closeHeaderNav() {
  activeController?.close();
}

/**
 * Initializes mobile portrait dropdown toggle and dismissal behavior for `#global-header`.
 *
 * @param {object} options
 * @param {HTMLElement|null} options.headerEl
 * @param {HTMLElement|null} options.toggleBtn
 * @param {HTMLElement|null} options.navEl
 * @param {Document} [options.doc]
 * @param {Window} [options.win]
 * @returns {{ open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean, destroy: () => void }}
 */
export function initHeaderNav({
  headerEl,
  toggleBtn,
  navEl,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null
} = {}) {
  if (!headerEl || !toggleBtn || !navEl) {
    return {
      open() {},
      close() {},
      toggle() {},
      isOpen: () => false,
      destroy() {}
    };
  }

  activeController?.destroy();

  const setOpen = (nextOpen) => {
    headerEl.classList.toggle('is-nav-open', nextOpen);
    toggleBtn.setAttribute('aria-expanded', String(nextOpen));
  };

  const isOpen = () => headerEl.classList.contains('is-nav-open');
  const open = () => setOpen(true);
  const close = () => {
    if (!isOpen()) return;
    setOpen(false);
  };
  const toggle = () => setOpen(!isOpen());

  setOpen(false);

  const onToggleClick = (e) => {
    e?.stopPropagation?.();
    toggle();
  };

  const onNavClick = (e) => {
    if (e?.target?.closest?.('.header-nav-link')) {
      close();
    }
  };

  const onDocPointerDown = (e) => {
    if (!isOpen()) return;
    if (e?.target && headerEl.contains(e.target)) return;
    close();
  };

  const onDocKeyDown = (e) => {
    if (e?.key !== 'Escape' || !isOpen()) return;
    close();
    toggleBtn.focus?.();
  };

  const onHashChange = () => {
    close();
  };

  toggleBtn.addEventListener('click', onToggleClick);
  navEl.addEventListener('click', onNavClick);
  doc?.addEventListener('pointerdown', onDocPointerDown);
  doc?.addEventListener('keydown', onDocKeyDown);
  win?.addEventListener('hashchange', onHashChange);

  const controller = {
    open,
    close,
    toggle,
    isOpen,
    destroy() {
      toggleBtn.removeEventListener('click', onToggleClick);
      navEl.removeEventListener('click', onNavClick);
      doc?.removeEventListener('pointerdown', onDocPointerDown);
      doc?.removeEventListener('keydown', onDocKeyDown);
      win?.removeEventListener('hashchange', onHashChange);
      if (activeController === controller) {
        activeController = null;
      }
    }
  };

  activeController = controller;
  return controller;
}
