import { state } from '../state.js';

export function updateMobileInert() {
  const isMobile = window.matchMedia('(max-width: 899px)').matches;
  const sidebar = document.querySelector('.pe-char-sidebar');
  const main = document.querySelector('.pe-char-main');
  const listCol = document.querySelector('.pe-char-list-col');
  const formCol = document.querySelector('.pe-char-form-col');
  const fab = document.querySelector('#pe-fab-back');

  if (!isMobile) {
    sidebar?.removeAttribute('inert');
    main?.removeAttribute('inert');
    listCol?.removeAttribute('inert');
    formCol?.removeAttribute('inert');
    fab?.removeAttribute('inert');
    return;
  }

  const view = state.mobileCardView || 'categories';
  if (view === 'categories') {
    sidebar?.removeAttribute('inert');
    main?.setAttribute('inert', '');
    fab?.setAttribute('inert', '');
  } else if (view === 'list') {
    sidebar?.setAttribute('inert', '');
    main?.removeAttribute('inert');
    listCol?.removeAttribute('inert');
    formCol?.setAttribute('inert', '');
    fab?.removeAttribute('inert');
  } else if (view === 'form') {
    sidebar?.setAttribute('inert', '');
    main?.removeAttribute('inert');
    listCol?.setAttribute('inert', '');
    formCol?.removeAttribute('inert');
    fab?.removeAttribute('inert');
  }
}

export function setMobileCardView(view, { scroll = true } = {}) {
  const isMobile = window.matchMedia('(max-width: 899px)').matches;
  const block = document.querySelector('.pe-char-block');
  const fab = document.querySelector('#pe-fab-back');
  const fabText = document.querySelector('#pe-fab-back-text');

  state.mobileCardView = view;
  if (block) {
    block.dataset.mobileView = view;
  }

  if (fab && fabText) {
    if (view === 'form') {
      fabText.textContent = 'Список карток';
      fab.setAttribute('title', 'Повернутися до списку карток');
      fab.setAttribute('aria-label', 'Повернутися до списку карток');
    } else {
      fabText.textContent = 'Категорії';
      fab.setAttribute('title', 'Повернутися до списку категорій');
      fab.setAttribute('aria-label', 'Повернутися до списку категорій');
    }
  }

  updateMobileInert();

  if (scroll && isMobile && block) {
    const blockTop = block.getBoundingClientRect().top + window.scrollY;
    const targetTop = Math.max(0, blockTop - 10);
    if (Math.abs(window.scrollY - targetTop) > 15) {
      window.scrollTo({
        top: targetTop,
        behavior: 'instant'
      });
    }
  }
}

export function initMobileNav() {
  const mql = window.matchMedia('(max-width: 899px)');
  mql.addEventListener('change', () => {
    updateMobileInert();
  });
  window.addEventListener('resize', () => {
    updateMobileInert();
  });
  setMobileCardView(state.mobileCardView || 'categories', { scroll: false });
}
