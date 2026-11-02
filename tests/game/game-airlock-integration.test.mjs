import assert from 'node:assert';
import fs from 'node:fs';

console.log('Running game-airlock-integration tests...');

const gameSrc = fs.readFileSync('js/pages/game.js', 'utf8');

// 1. Verify game.js imports mountBunkerAirlock and unmountBunkerAirlock
assert.ok(
  gameSrc.includes("mountBunkerAirlock") && gameSrc.includes("unmountBunkerAirlock"),
  'game.js must import mountBunkerAirlock and unmountBunkerAirlock from bunker-airlock.js'
);

// 2. Verify game.js checks !soundManager.isUnlocked()
assert.ok(
  gameSrc.includes('!soundManager.isUnlocked()'),
  'game.js must check !soundManager.isUnlocked() before mounting airlock'
);

// 3. Verify all 3 modes ('join', 'reconnect', 'spectator') are determined
assert.ok(
  gameSrc.includes("'spectator'") && gameSrc.includes("'reconnect'") && gameSrc.includes("'join'"),
  'game.js must determine join, reconnect, and spectator modes'
);

// 4. Verify cleanupGame and roomFinished unmount airlock
assert.ok(
  gameSrc.includes('unmountBunkerAirlock()'),
  'cleanupGame must call unmountBunkerAirlock()'
);
assert.ok(
  /if\s*\(\s*fx\.roomFinished\s*\)\s*\{\s*unmountBunkerAirlock\(\);/.test(gameSrc),
  'fx.roomFinished branch must immediately call unmountBunkerAirlock()'
);

console.log('PASS: All game-airlock-integration tests passed!');

