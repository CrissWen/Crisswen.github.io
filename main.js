// КОНТЕЙНЕР — збирає всі блоки в потрібному порядку в #app
document.addEventListener("DOMContentLoaded", function () {
  const app = document.getElementById("app");
  const B = window.BunkerBlocks;

  const order = [
    B.catastrophe(),
    B.bunkerInfo(),
    B.playerCharacteristics(),
    B.playersTable(),
    B.specialAbilitiesTable()
  ];

  app.innerHTML = order.join("");
});
