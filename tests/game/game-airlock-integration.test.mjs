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

// 5. Verify notifyAirlockGameStarted is imported and called on game start
assert.ok(
  gameSrc.includes('notifyAirlockGameStarted'),
  'game.js must import and call notifyAirlockGameStarted from bunker-airlock.js'
);
assert.ok(
  /fx\.playStartDoor[\s\S]*?notifyAirlockGameStarted\(\)/.test(gameSrc) ||
  /notifyAirlockGameStarted\(\)[\s\S]*?playBunkerDoorTransition/.test(gameSrc),
  'game.js must call notifyAirlockGameStarted() when game starts'
);

// 6. Verify bunker-airlock.css has z-index: 10100 (above bunker doors 10050 and roulette 10012)
const airlockCss = fs.readFileSync('css/components/bunker-airlock.css', 'utf8');
assert.ok(
  /z-index:\s*10100;/.test(airlockCss),
  'bunker-airlock.css must specify z-index: 10100 to stay above bunker-vault-overlay (10050)'
);

// 7. Verify roulette-overlay.js lockPage does NOT lock bunker-airlock with inert
const rouletteSrc = fs.readFileSync('js/ui/roulette-overlay.js', 'utf8');
assert.ok(
  rouletteSrc.includes('bunker-airlock') || rouletteSrc.includes('bunker-airlock-overlay'),
  'roulette-overlay.js must exempt bunker-airlock from being marked inert'
);

console.log('PASS: All game-airlock-integration tests passed!');

