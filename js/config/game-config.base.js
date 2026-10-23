// ===== Базовий конфіг балансу гри =====
// Цей файл ВІДСТЕЖУЄТЬСЯ Git і йде в реліз (GitHub Pages) — тут мають бути лише значення,
// з якими гра дійсно має запускатись для гравців. Локальні експерименти — у game-config.local.js
// (ігнорується Git, див. .gitignore), який config-manager.js підвантажує й зливає поверх цього об'єкта.
//
// Усі "магічні числа" балансу (шанси, діапазони, множники), які раніше лежали прямо в
// js/utils/game-generator.js, тепер живуть тут — генератор лише читає ці поля.

export const gameConfigBase = {
  // Мінімальна кількість гравців у кімнаті, щоб хост міг натиснути «Почати гру»
  // (кнопка/підказка під нею — js/game-modules/board/waiting-room.js)
  minPlayersToStart: 6,

  // Ліміт гравців, поки кімната ще в лобі (гра не почалась). Після старту гри не діє —
  // див. перевірку isGameStarted навколо цього ліміту в js/pages/game.js.
  maxPlayersInLobby: 15,

  // Місткість бункера при старті гри = floor(кількість гравців / bunkerCapacityDivisor)
  bunkerCapacityDivisor: 2,

  // Запасний діапазон віку, коли в конфігу пака (packs.config.age_range) його немає. Використовується
  // лише при переролі статі/віку ведучим (js/utils/host-actions.js → generateAge); при старті гри вік береться з пака.
  defaultAgeRange: { min: 18, max: 60 },

  // Скільки останніх записів лишається в «Лог подій» (bunker_state.logs). Старіші відкидаються,
  // щоб запис у базі не розростався (js/utils/log-writer.js → pushLog)
  maxLogEntries: 100,

  // Шанс (0..1), що здоров'я гравця одразу згенерується як "Ідеально здоровий" (без хвороби й стадії)
  perfectHealthChance: 0.20,

  // Шанс (0..1), що в бункера буде випадкова проблема з пулу pack_cards (інакше — "Відсутня")
  bunkerProblemChance: 0.65,

  // Шанс (0..1), що гравцю згенерується мітка "childfree". Діє лише якщо пак це дозволяє
  // (config.allow_childfree — окреме налаштування самого пака карток у Supabase, не тут).
  childfreeChance: 0.30,

  // Площа бункера, м². getSkewedRandomInt(min, max, skew) — чим більший skew, тим частіше
  // випадають значення ближче до min (щоб величезні бункери на 350 м² були рідкістю).
  bunkerSize: { min: 25, max: 350, skew: 4 },

  // Скільки випадкових предметів бункера видається при старті гри (з перемішаної колоди pack_cards.items)
  bunkerItemsCount: { min: 1, max: 5 },

  // Шанс (0..1), що до тексту "Запаси їжі/води" додасться окрема примітка з пулу food_supply пака
  foodSupplyNoteChance: 0.4,

  // Розрахунок кількості місяців запасів їжі відносно потрібного часу перебування (requiredMonths).
  // Чотири гілки за накопичувальними порогами одного random()-кидка: shortfall -> partial -> exact -> surplus.
  foodMonths: {
    shortfallThreshold: 0.15,                       // roll < 0.15  — катастрофічний дефіцит, лишилось 1-2 місяці
    shortfallRange: { min: 1, max: 2 },
    partialThreshold: 0.65,                         // roll < 0.65  — частковий запас, % від потрібного
    partialPercentRange: { min: 30, max: 80 },
    exactThreshold: 0.90,                           // roll < 0.90  — рівно стільки, скільки треба
    surplusPercentRange: { min: 110, max: 150 }      // roll >= 0.90 — із запасом
  }
};
