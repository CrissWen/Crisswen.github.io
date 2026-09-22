import { catastrophe } from './catastrophe.js';
import { bunkerInfo } from './bunker-info.js';
import { playerCharacteristics } from './player-characteristics.js';
import { playersTable } from './players-table.js';
import { specialAbilitiesTable } from './special-abilities-table.js';

// КОНТЕЙНЕР — збирає всі блоки в потрібному порядку в #app
document.addEventListener("DOMContentLoaded", function () {
  const app = document.getElementById("app");

  const order = [
    catastrophe(),
    bunkerInfo(),
    playerCharacteristics(),
    playersTable(),
    specialAbilitiesTable()
  ];

  app.innerHTML = order.join("");
});