import { catastrophe } from '../game-moduls/catastrophe.js';
import { bunkerInfo } from '../game-moduls/bunker-info.js';
import { playerCharacteristics } from '../game-moduls/player-characteristics.js';
import { playersTable } from '../game-moduls/players-table.js';
import { specialAbilitiesTable } from '../game-moduls/special-abilities-table.js';

export function renderGame() {
  // Збираємо всі блоки в єдиний HTML рядок
  const order = [
    catastrophe(),
    bunkerInfo(),
    playerCharacteristics(),
    playersTable(),
    specialAbilitiesTable()
  ];

  return order.join("");
}