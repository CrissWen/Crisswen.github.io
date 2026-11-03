import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITION_TEXTS } from '../../js/fx/bunker-transition.js';

describe('Bunker Transition Texts', () => {
  it('повинен містити режим cataclysm_timeout з протоколами аварійного закриття', () => {
    assert.ok(TRANSITION_TEXTS, 'TRANSITION_TEXTS має експортуватися');
    const cata = TRANSITION_TEXTS.cataclysm_timeout;
    assert.ok(cata, 'TRANSITION_TEXTS.cataclysm_timeout має бути визначений');
    assert.strictEqual(cata.aria, 'Катаклізм: аварійне закриття бункера');
    assert.deepStrictEqual(cata.closing, [
      'ПРОТОКОЛ: АВАРІЙНА ІЗОЛЯЦІЯ',
      'ЧАС ВИЧЕРПАНО // ЕВАКУАЦІЮ ЗАКРИТО',
      'EMERGENCY LOCKDOWN // PROTOCOL ACTIVE'
    ]);
    assert.deepStrictEqual(cata.sealed, [
      'СТАТУС: БУНКЕР ЗАПЕЧАТАНО',
      'ЖОДЕН НЕ ВСТИГ',
      'СИСТЕМА ЖИТТЄЗАБЕЗПЕЧЕННЯ // АВТОНОМНО'
    ]);
    assert.deepStrictEqual(cata.sealedReduced, [
      'СТАТУС: БУНКЕР ЗАПЕЧАТАНО',
      'АВАРІЙНЕ ЗАКРИТТЯ',
      'ЧАС ВИЧЕРПАНО'
    ]);
    assert.deepStrictEqual(cata.opening, [
      'ВХІД ЗАБЛОКОВАНО',
      'ДВЕРІ ЗАПЕЧАТАНІ',
      'РЕЗУЛЬТАТИ КАТАКЛІЗМУ'
    ]);
  });
});

