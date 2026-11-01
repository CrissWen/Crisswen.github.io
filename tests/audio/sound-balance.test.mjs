import test from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_CATALOG, SOUND_IDS } from '../../js/constants/sounds.js';

test('Audio Balance Calibration - Base Volumes Contract', () => {
  // 1. All sounds must have a defined baseVolume in [0.05, 1.0]
  for (const [id, sound] of Object.entries(SOUND_CATALOG)) {
    assert.ok(
      typeof sound.baseVolume === 'number' && sound.baseVolume > 0 && sound.baseVolume <= 1.0,
      `Sound ${id} must have baseVolume in (0, 1.0], got ${sound.baseVolume}`
    );
  }

  // 2. UI calibration: ui-click was recorded at -14.5dB peak, so baseVolume must be 1.0
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.UI_CLICK].baseVolume,
    1.0,
    'UI_CLICK must be calibrated to 1.0 because raw wav is quiet (-14.5dB peak)'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.LOCK_TOGGLE].baseVolume,
    0.3,
    'LOCK_TOGGLE should be calibrated to 0.30'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.TAB_SWITCH].baseVolume,
    0.4,
    'TAB_SWITCH should be calibrated to 0.40'
  );

  // 3. Roulette calibration: click series and reveal must not be at extreme 1.0
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.ROULETTE_TICK].baseVolume,
    0.4,
    'ROULETTE_TICK must be calibrated down from 1.0 to 0.40 to prevent deafening tick series'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.ROULETTE_REVEAL].baseVolume,
    0.65,
    'ROULETTE_REVEAL must be calibrated down from 1.0 to 0.65'
  );

  // 4. Cataclysm siren: 48kHz screech at -16.4dB RMS must be calibrated to 0.30
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.CATACLYSM_ALERT].baseVolume,
    0.3,
    'CATACLYSM_ALERT must be calibrated to 0.30 due to high RMS and ear sensitivity at 2-4kHz'
  );

  // 5. Bunker door sequences: prevent clipping on samples with -0.3dB / -0.7dB peaks
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.BUNKER_DOOR_CLOSE].baseVolume,
    0.55,
    'BUNKER_DOOR_CLOSE must be calibrated to 0.55 (peak -0.3dB)'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.BUNKER_DOOR_SLAM].baseVolume,
    0.7,
    'BUNKER_DOOR_SLAM must be calibrated to 0.70 (peak -0.7dB)'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.BUNKER_HYDRAULIC].baseVolume,
    0.5,
    'BUNKER_HYDRAULIC must be calibrated to 0.50'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.BUNKER_DOOR_OPEN].baseVolume,
    0.6,
    'BUNKER_DOOR_OPEN must be calibrated to 0.60'
  );

  // 6. Ambient and timer calibration
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.BUNKER_AMBIENT].baseVolume,
    0.35,
    'BUNKER_AMBIENT should be calibrated to 0.35 for unobtrusive background presence'
  );
  assert.strictEqual(
    SOUND_CATALOG[SOUND_IDS.TIMER_TICK].baseVolume,
    0.35,
    'TIMER_TICK should be calibrated to 0.35 so it does not drown player talk'
  );
});

