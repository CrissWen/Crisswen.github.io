// Перевірка наявності нового релізу під час роботи відкритої вкладки (version.json).
// Працює лише у зібраному релізі (де в <head> присутній <meta name="app-build-id">),
// тому під час локальної розробки без білду є повним no-op.

export const UNSAFE_AUTO_BANNER_ROUTES = new Set(['#/game', '#/pack-editor']);

export function initVersionCheck({
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  minIntervalMs = 60_000,
  autoStart = typeof document !== 'undefined' && doc === document
} = {}) {
  const noop = { checkNow: async () => false, destroy: () => {} };
  if (!doc || !win || typeof fetchImpl !== 'function') return noop;

  const metaEl = doc.querySelector('meta[name="app-build-id"]');
  const currentBuildId = (metaEl?.getAttribute('content') || '').trim();
  if (!currentBuildId) return noop;

  let lastCheckedAt = 0;
  let updatePending = false;
  let latestRemoteBuildId = null;
  let dismissedBuildId = null;

  function getCurrentRoutePath() {
    const rawHash = win.location?.hash || '#/login';
    return rawHash.split('?')[0] || '#/login';
  }

  function isSafeRoute() {
    return !UNSAFE_AUTO_BANNER_ROUTES.has(getCurrentRoutePath());
  }

  function removeBanner() {
    const existing = doc.querySelector('#update-banner');
    if (existing) existing.remove();
  }

  function maybeShowBanner() {
    if (!updatePending || !latestRemoteBuildId) return;
    if (dismissedBuildId === latestRemoteBuildId) return;
    if (!isSafeRoute()) {
      removeBanner();
      return;
    }
    if (doc.querySelector('#update-banner')) return;

    const banner = doc.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = [
      '<span class="update-banner__text">Доступне оновлення гри</span>',
      '<div class="update-banner__actions">',
      '  <button type="button" class="update-banner__btn" data-update-reload>Оновити</button>',
      '  <button type="button" class="update-banner__dismiss" data-update-dismiss aria-label="Відкласти оновлення">Пізніше</button>',
      '</div>'
    ].join('\n');

    const reloadBtn = banner.querySelector('[data-update-reload]');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', () => {
        win.location?.reload?.();
      });
    }

    const dismissBtn = banner.querySelector('[data-update-dismiss]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        dismissedBuildId = latestRemoteBuildId;
        banner.remove();
      });
    }

    doc.body?.appendChild(banner);
  }

  async function checkNow() {
    lastCheckedAt = Date.now();
    try {
      const res = await fetchImpl(`version.json?t=${lastCheckedAt}`, { cache: 'no-store' });
      if (!res || !res.ok) return false;
      const data = await res.json();
      const remoteBuildId = typeof data?.buildId === 'string' ? data.buildId.trim() : '';
      if (remoteBuildId && remoteBuildId !== currentBuildId) {
        updatePending = true;
        latestRemoteBuildId = remoteBuildId;
        maybeShowBanner();
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function onVisibilityChange() {
    if (doc.visibilityState !== 'visible') return;
    if (Date.now() - lastCheckedAt < minIntervalMs) return;
    checkNow();
  }

  function onHashChange() {
    maybeShowBanner();
  }

  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('hashchange', onHashChange);

  if (autoStart) {
    Promise.resolve().then(() => checkNow());
  }

  function destroy() {
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    win.removeEventListener('hashchange', onHashChange);
    removeBanner();
  }

  return { checkNow, destroy };
}
