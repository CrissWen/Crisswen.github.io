import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Cataclysm End Modal Timing & Z-Index', () => {
  it('z-index модалки повинен бути строго меншим за z-index гермодверей', () => {
    const modalsCss = fs.readFileSync('css/components/modals.css', 'utf8');
    const transitionCss = fs.readFileSync('css/components/bunker-transition.css', 'utf8');

    const modalZMatch = modalsCss.match(/\.cataclysm-end-modal\s*\{[^}]*z-index:\s*(\d+)/);
    const doorZMatch = transitionCss.match(/\.bunker-vault-overlay\s*\{[^}]*z-index:\s*(\d+)/);

    assert.ok(modalZMatch, 'Має бути визначений z-index для .cataclysm-end-modal');
    assert.ok(doorZMatch, 'Має бути визначений z-index для .bunker-vault-overlay');

    const modalZ = parseInt(modalZMatch[1], 10);
    const doorZ = parseInt(doorZMatch[1], 10);

    assert.ok(modalZ < doorZ, `z-index модалки (${modalZ}) має бути меншим за z-index дверей (${doorZ})`);
  });

  it('game.js повинен передавати cataclysm_timeout в перехід дверей та показувати модалку', () => {
    const gameJs = fs.readFileSync('js/pages/game.js', 'utf8');

    assert.ok(gameJs.includes('mode: fx.doorTransitionMode || \'finish\''), 'game.js має використовувати fx.doorTransitionMode');
    assert.ok(gameJs.includes('showCataclysmEndModal()'), 'game.js має викликати showCataclysmEndModal');
    assert.ok(gameJs.includes('finishGameOnCataclysmTimeout'), 'game.js має викликати finishGameOnCataclysmTimeout при завершенні відліку ведучим');
  });

  it('game.js повинен монтувати модалку в onSealed, щоб вона вже була присутня при розчиненні стулок', () => {
    const gameJs = fs.readFileSync('js/pages/game.js', 'utf8');

    const onSealedMatch = gameJs.match(/onSealed:\s*\(\)\s*=>\s*\{([\s\S]*?)\}/);
    assert.ok(onSealedMatch, 'onSealed має бути визначений у playBunkerDoorTransition');
    assert.ok(onSealedMatch[1].includes('showCataclysmEndModal()'), 'onSealed повинен викликати showCataclysmEndModal() для появи під час відкриття');
  });

  it('cleanupGame та перехід на головну повинні прибирати червону димку (unmountCataclysmVignette)', () => {
    const gameJs = fs.readFileSync('js/pages/game.js', 'utf8');

    assert.ok(gameJs.includes('unmountCataclysmVignette'), 'game.js має імпортувати та викликати unmountCataclysmVignette');

    const cleanupMatch = gameJs.match(/export function cleanupGame\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(cleanupMatch, 'cleanupGame має бути знайдений');
    assert.ok(cleanupMatch[1].includes('unmountCataclysmVignette()'), 'cleanupGame повинен викликати unmountCataclysmVignette()');
  });
});
