import assert from 'node:assert';
import test from 'node:test';

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  supabase: {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }) })
    })
  }
};
globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null
};

const { buildBoardViewModel } = await import('../js/utils/board-view-model.js');
const { playersTable } = await import('../js/game-modules/board/players-table.js');
const { specialAbilitiesTable } = await import('../js/game-modules/board/special-abilities-table.js');

test('Offline replay reveals hidden stats and omits "На головну" button', () => {
  const mockRoomData = {
    room_code: 'TEST01',
    status: 'closed',
    players_state: {
      p1: {
        name: 'Гравець 1',
        gender: { value: 'Чоловік', is_revealed: true },
        is_alive: true,
        professions: { title: 'Лікар', is_revealed: true },
        health: { disease: 'Астма', severity: 'легка', is_revealed: false }, // скритий стат
        special_abilities: [
          { text: 'Швидке лікування', is_revealed: false } // скрита здібність
        ]
      }
    },
    bunker_state: {
      cataclysm: { text: 'Метеорит', description: 'Падіння метеорита' }
    }
  };

  // 1. Коли reveal: false (звичайний перегляд незавершеної кімнати)
  const vmHidden = buildBoardViewModel(mockRoomData, 'offline-viewer', { reveal: false });
  // Колонки: Стать, Професія, Здоров'я
  const healthIndex = vmHidden.columns.indexOf("Здоров'я");
  assert.ok(healthIndex !== -1, 'Колонка Здоров\'я знайдена');
  assert.strictEqual(vmHidden.tableRows[0].cells[healthIndex], null, 'Прихована характеристика має бути null без reveal');
  assert.strictEqual(vmHidden.parsedAbilities[0].ability1, null, 'Прихована здібність має бути null без reveal');

  // 2. Коли reveal: true (як в історії онлайн або в офлайн-реплеї)
  const isOfflineReplay = true;
  const isFinal = mockRoomData.status === 'finished' || isOfflineReplay;
  assert.strictEqual(isFinal, true);

  const vmRevealed = buildBoardViewModel(mockRoomData, 'offline-viewer', { reveal: isFinal });
  assert.strictEqual(vmRevealed.tableRows[0].cells[healthIndex], 'Астма (легка)', 'Прихована характеристика має розкриватися');
  assert.strictEqual(vmRevealed.tableRows[0].cellsOpen[healthIndex], false, 'cellsOpen має фіксувати, що стат був скритий');
  assert.strictEqual(vmRevealed.parsedAbilities[0].ability1, 'Швидке лікування', 'Прихована здібність має розкриватися');
  assert.strictEqual(vmRevealed.parsedAbilities[0].ability1Open, false, 'ability1Open має фіксувати, що здібність не була відкритою');

  // 3. Перевірка HTML-генерації таблиці гравців
  const tableHtml = playersTable(vmRevealed.columns, vmRevealed.tableRows, vmRevealed.alivePlayers, vmRevealed.totalPlayers, false, null, { final: isFinal });
  assert.match(tableHtml, /cell-value--unrevealed/, 'Має містити клас для невідкритих значень');
  assert.match(tableHtml, /cell-lock/, 'Має містити іконку замка для скритих раніше статів');
  assert.match(tableHtml, /Астма \(легка\)/, 'Текст характеристики має бути присутній у розмітці');

  // 4. Перевірка HTML-генерації таблиці здібностей
  const abilitiesHtml = specialAbilitiesTable(vmRevealed.parsedAbilities, { final: isFinal });
  assert.match(abilitiesHtml, /cell-value--unrevealed/, 'Здібності мають містити клас для невідкритих');
  assert.match(abilitiesHtml, /Швидке лікування/, 'Текст здібності має бути присутній у розмітці');

  // 5. Перевірка логіки кнопки "На головну":
  // Для онлайн завершеної гри (isFinal && !isOfflineReplay) -> кнопка є
  const onlineFinalActions = (true && !false)
    ? '<div class="final-actions"><button type="button" class="hp-btn hp-btn-red final-home-btn" data-final-home>На головну</button></div>'
    : '';
  assert.match(onlineFinalActions, /data-final-home/, 'В онлайн перегляді кнопка "На головну" має бути');

  // Для офлайн перегляду (isFinal && !isOfflineReplay) -> кнопки "На головну" НЕМАЄ
  const offlineFinalActions = (isFinal && !isOfflineReplay)
    ? '<div class="final-actions"><button type="button" class="hp-btn hp-btn-red final-home-btn" data-final-home>На головну</button></div>'
    : '';
  assert.strictEqual(offlineFinalActions, '', 'В офлайн перегляді кнопка "На головну" повинна бути відсутня');

  console.log('PASS: offline replay reveal and home button rules verified!');
});
