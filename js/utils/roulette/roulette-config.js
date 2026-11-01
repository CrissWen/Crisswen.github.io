// ===== Налаштування рулеток: нормалізація конфігу =====
// Читає блок налаштувань рулетки з конфігу балансу й повертає безпечні значення навіть для неповного або зіпсованого
// game-config.local.js. Усі «ручки» (тривалість, звук, режим) описані в game-config.base.js (cataclysmRoulette).
// Спільна для рулетки катаклізму й рулетки тесту виживання.

export function normalizeRouletteConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const sounds = src.sounds && typeof src.sounds === 'object' ? src.sounds : {};
  const num = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const url = value => (typeof value === 'string' && value.trim() ? value.trim() : null);

  return {
    enabled: src.enabled !== false,
    durationMs: num(src.durationMs, 6000, 1500, 15000),
    startLeadMs: num(src.startLeadMs, 1500, 300, 5000),
    holdAfterMs: num(src.holdAfterMs, 3000, 500, 6000),
    easingPower: num(src.easingPower, 3, 1.5, 6),
    fillerZone: num(src.fillerZone, 0.55, 0, 1),
    maxFillers: Math.round(num(src.maxFillers, 24, 0, 60)),
    // true/false або об'єкт { holdMs, snapMs, approachMs, decoyReach, powerBoost, swapChance } для тонкого налаштування (див. createTravelCurve)
    suspense: src.suspense && typeof src.suspense === 'object' ? src.suspense : src.suspense !== false,
    mode: ['auto', 'full', 'light'].includes(src.mode) ? src.mode : 'auto',
    sounds: {
      enabled: sounds.enabled !== false,
      volume: num(sounds.volume, 0.5, 0, 1),
      tickUrl: url(sounds.tickUrl),
      revealUrl: url(sounds.revealUrl)
    }
  };
}
