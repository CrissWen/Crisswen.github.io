import assert from 'node:assert';
import path from 'node:path';
import { analyzeAudioFile, analyzeAudioDirectory } from '../../scripts/analyze-audio.mjs';

async function runTests() {
  console.log('Running analyze-audio tests...');

  // 1. Test WAV parsing for lock-hover.wav
  const lockHoverPath = path.resolve('audio/ui/lock-hover.wav');
  const lockHoverProfile = await analyzeAudioFile(lockHoverPath);
  assert.ok(lockHoverProfile, 'Profile should exist for lock-hover.wav');
  assert.strictEqual(lockHoverProfile.format, 'wav');
  assert.ok(lockHoverProfile.durationSec > 0.01 && lockHoverProfile.durationSec < 5, `Duration should be reasonable, got ${lockHoverProfile.durationSec}`);
  assert.ok(lockHoverProfile.sampleRate >= 8000, `Sample rate should be valid, got ${lockHoverProfile.sampleRate}`);
  assert.ok(lockHoverProfile.peakAmplitude >= 0 && lockHoverProfile.peakAmplitude <= 1, 'Peak amplitude should be normalized 0..1');

  // 2. Test WAV parsing for bunker-door-slam.wav
  const slamPath = path.resolve('audio/sfx/bunker-door/bunker-door-slam.wav');
  const slamProfile = await analyzeAudioFile(slamPath);
  assert.strictEqual(slamProfile.format, 'wav');
  assert.ok(slamProfile.durationSec > 0.1, 'Slam duration should be > 0.1s');

  // 3. Test directory analysis
  const allProfiles = await analyzeAudioDirectory(path.resolve('audio'));
  assert.ok(Object.keys(allProfiles).length >= 14, `Expected at least 14 audio files analyzed, got ${Object.keys(allProfiles).length}`);

  console.log('PASS: All analyze-audio tests passed!');
}

runTests().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
