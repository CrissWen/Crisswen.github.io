/**
 * Каталог звуків та налаштувань аудіосистеми проєкту (/audio).
 * Забезпечує єдине джерело правди для всіх аудіошляхів, каналів гучності,
 * точкового калібрування (baseVolume) та захисту від спаму (throttleMs / maxInstances).
 */

export const AUDIO_CHANNELS = Object.freeze({
  MASTER: 'master',
  SFX: 'sfx',
  UI: 'ui',
  MUSIC: 'music',
});

export const AUDIO_CHANNEL_META = Object.freeze({
  [AUDIO_CHANNELS.MASTER]: {
    id: AUDIO_CHANNELS.MASTER,
    label: 'Загальна гучність',
    description: 'Мастер-рівень для всіх звуків гри',
  },
  [AUDIO_CHANNELS.SFX]: {
    id: AUDIO_CHANNELS.SFX,
    label: 'Ігрові ефекти (SFX)',
    description: 'Рулетки, кидок кубика, розкриття карток, таймер, голосування та сирени',
  },
  [AUDIO_CHANNELS.UI]: {
    id: AUDIO_CHANNELS.UI,
    label: 'Інтерфейс (UI)',
    description: 'Наведення на замки, кліки кнопок та перемикання вкладок',
  },
  [AUDIO_CHANNELS.MUSIC]: {
    id: AUDIO_CHANNELS.MUSIC,
    label: 'Музика та атмосфера',
    description: 'Фоновий ембієнт бункера та атмосферні теми',
  },
});

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  sfxVolume: 0.85,
  uiVolume: 0.7,
  musicVolume: 0.5,
  muted: false,
  backgroundAmbient: false,
});

export const SOUND_IDS = Object.freeze({
  // --- Інтерфейс (UI) ---
  LOCK_HOVER: 'lock-hover',
  LOCK_TOGGLE: 'lock-toggle',
  UI_CLICK: 'ui-click',
  TAB_SWITCH: 'tab-switch',

  // --- Ігрові ефекти (SFX) ---
  DICE_ROLL: 'dice-roll',
  CARD_REVEAL: 'card-reveal', // не надо
  VOTE_CAST: 'vote-cast', // +- надо подумать
  TIMER_TICK: 'timer-tick',
  TIMER_END: 'timer-end',// не надо
  CATACLYSM_ALERT: 'cataclysm-alert', // не надо
  PLAYER_KICK: 'player-kick', //

  // --- Рулетка (SFX) ---
  ROULETTE_TICK: 'roulette-tick',
  ROULETTE_REVEAL: 'roulette-reveal',

  // --- Двері бункеру (SFX) ---
  BUNKER_DOOR_CLOSE: 'bunker-door-close',
  BUNKER_DOOR_SLAM: 'bunker-door-slam',
  BUNKER_HYDRAULIC: 'bunker-hydraulic',
  BUNKER_DOOR_OPEN: 'bunker-door-open',

  // --- Музика та ембієнт (MUSIC) ---
  BUNKER_AMBIENT: 'bunker-ambient',
});

/**
 * Повний реєстр звуків.
 * Поля кожного запису:
 * - id: унікальний ідентифікатор звуку
 * - label: людиночитана назва (для UI та тестування)
 * - src: масив відносних шляхів до аудіофайлів (Howler вибере підтримуваний браузером)
 * - channel: канал гучності (AUDIO_CHANNELS.UI | SFX | MUSIC)
 * - baseVolume: точкове калібрування гучності (0.0 .. 1.0) для вирівнювання балансу композиції
 * - throttleMs: мінімальний інтервал між викликами в мс (захист від какофонії при швидкому ховері)
 * - interrupt: якщо true — новий виклик перериває попередній екземпляр цього ж звуку
 * - maxInstances: максимальна кількість одночасно активних копій цього звуку
 * - pitchShift: діапазон випадкової мікро-варіації висоти тону (напр. 0.04 = ±4%) для природності
 * - loop: чи зациклювати доріжку (для ембієнту)
 * - preload: чи завантажувати наперед (ВАЖЛИВО: обов'язково ставити true, щойно аудіофайл додано на диск, інакше перший клік буде без звуку через асинхронне завантаження!)
 * - synthType: тип процедурного Web Audio сигналу-фоллбеку, якщо аудіофайл ще відсутній на диску
 */
export const SOUND_CATALOG = Object.freeze({
  // ================= Інтерфейс (UI) =================
  [SOUND_IDS.LOCK_HOVER]: Object.freeze({
    id: SOUND_IDS.LOCK_HOVER,
    label: 'Наведення на замок',
    src: ['./audio/ui/lock-hover.wav'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.15,   // делікатний тихий відгук при наведенні
    throttleMs: 85,     // анти-спам: не частіше ніж раз на 65 мс при проведенні мишею по таблиці
    interrupt: true,    // обривати попередній семпл, щоб не накладалися
    maxInstances: 1,
    pitchShift: 0.05,   // ±5% варіація тону, щоб серія замків звучала живо, а не механічно
    preload: true,
    synthType: 'lock-hover',
  }),

  [SOUND_IDS.LOCK_TOGGLE]: Object.freeze({
    id: SOUND_IDS.LOCK_TOGGLE,
    label: 'Відкриття / закриття замка',
    src: ['./audio/ui/lock-toggle.wav'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.35,
    throttleMs: 80,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.03,
    preload: true,
    synthType: 'lock-toggle',
  }),

  [SOUND_IDS.UI_CLICK]: Object.freeze({
    id: SOUND_IDS.UI_CLICK,
    label: 'Клік кнопки',
    src: ['./audio/ui/ui-click.wav'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.85,
    throttleMs: 45,
    interrupt: true,
    maxInstances: 2,
    pitchShift: 0.03,
    preload: true,
    synthType: 'click',
  }),

  [SOUND_IDS.TAB_SWITCH]: Object.freeze({
    id: SOUND_IDS.TAB_SWITCH,
    label: 'Перемикання вкладки',
    src: ['./audio/ui/tab-switch.mp3'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.45,
    throttleMs: 50,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.02,
    preload: true,
    synthType: 'tab',
  }),

  // ================= Ігрові ефекти (SFX) =================
  [SOUND_IDS.DICE_ROLL]: Object.freeze({
    id: SOUND_IDS.DICE_ROLL,
    label: 'Кидок кубика',
    src: ['./audio/ui/dice-roll.wav'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.85,
    throttleMs: 250,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.03,
    preload: true,
    synthType: 'dice',
  }),

  [SOUND_IDS.CARD_REVEAL]: Object.freeze({
    id: SOUND_IDS.CARD_REVEAL,
    label: 'Розкриття картки',
    src: ['./audio/sfx/card-reveal.webm', './audio/sfx/card-reveal.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.75,
    throttleMs: 100,
    interrupt: false,
    maxInstances: 2,
    pitchShift: 0.02,
    preload: false,
    synthType: 'card',
  }),

  [SOUND_IDS.VOTE_CAST]: Object.freeze({
    id: SOUND_IDS.VOTE_CAST,
    label: 'Голосування',
    src: ['./audio/sfx/vote-cast.webm', './audio/sfx/vote-cast.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.7,
    throttleMs: 90,
    interrupt: false,
    maxInstances: 3,
    pitchShift: 0.03,
    preload: false,
    synthType: 'vote',
  }),

  [SOUND_IDS.TIMER_TICK]: Object.freeze({
    id: SOUND_IDS.TIMER_TICK,
    label: 'Відлік таймера',
    src: ['./audio/sfx/bunker-inside/timer-tick.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.4,    // цокання не має глушити розмову гравців
    throttleMs: 400,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'tick',
  }),

  [SOUND_IDS.TIMER_END]: Object.freeze({
    id: SOUND_IDS.TIMER_END,
    label: 'Завершення таймера',
    src: ['./audio/sfx/timer-end.webm', './audio/sfx/timer-end.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.75,
    throttleMs: 500,
    interrupt: true,
    maxInstances: 1,
    preload: false,
    synthType: 'timer-end',
  }),

  [SOUND_IDS.CATACLYSM_ALERT]: Object.freeze({
    id: SOUND_IDS.CATACLYSM_ALERT,
    label: 'Сирена катаклізму',
    src: ['./audio/sfx/bunker-door/cataclysm-siren.wav'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.45,   // сирени зазвичай дуже гучні по LUFS, тому калібруємо нижче
    throttleMs: 1000,
    interrupt: true,
    maxInstances: 1,
    loop: true,
    preload: true,
    synthType: 'alarm',
  }),

  [SOUND_IDS.PLAYER_KICK]: Object.freeze({
    id: SOUND_IDS.PLAYER_KICK,
    label: 'Вигнання з бункера',
    src: ['./audio/sfx/player-kick.webm', './audio/sfx/player-kick.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.8,
    throttleMs: 500,
    interrupt: true,
    maxInstances: 1,
    preload: false,
    synthType: 'kick',
  }),

  // Рулетка катаклізму / тесту виживання (ui/roulette-overlay.js). Гучність додатково множиться на cataclysmRoulette.sounds.volume з конфігу гри.
  [SOUND_IDS.ROULETTE_TICK]: Object.freeze({
    id: SOUND_IDS.ROULETTE_TICK,
    label: 'Клацання стрічки рулетки',
    src: ['./audio/sfx/roulette/click.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 1,
    throttleMs: 30,     // тіки частіші за 30 мс зливаються в тріск (раніше MIN_TICK_GAP_MS у sfx.js)
    interrupt: false,   // тіки йдуть серією й можуть накладатися
    maxInstances: 4,
    preload: true,
    synthType: 'tick',
  }),

  [SOUND_IDS.ROULETTE_REVEAL]: Object.freeze({
    id: SOUND_IDS.ROULETTE_REVEAL,
    label: 'Результат рулетки',
    src: ['./audio/sfx/roulette/choose.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 1,
    throttleMs: 500,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'card',
  }),

  [SOUND_IDS.BUNKER_DOOR_CLOSE]: Object.freeze({
    id: SOUND_IDS.BUNKER_DOOR_CLOSE,
    label: 'Рух гермодверей (закриття)',
    src: ['./audio/sfx/bunker-door/bunker-door-close.wav', './audio/sfx/bunker-door-close.webm', './audio/sfx/bunker-door-close.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.7,
    throttleMs: 300,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'door-close',
  }),

  [SOUND_IDS.BUNKER_DOOR_SLAM]: Object.freeze({
    id: SOUND_IDS.BUNKER_DOOR_SLAM,
    label: 'Удар зачинення шлюзу',
    src: ['./audio/sfx/bunker-door/bunker-door-slam.wav', './audio/sfx/bunker-door-slam.webm', './audio/sfx/bunker-door-slam.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.85,
    throttleMs: 300,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'door-slam',
  }),

  [SOUND_IDS.BUNKER_HYDRAULIC]: Object.freeze({
    id: SOUND_IDS.BUNKER_HYDRAULIC,
    label: 'Гідравліка та ригелі шлюзу',
    src: ['./audio/sfx/bunker-door/bunker-hydraulic.wav', './audio/sfx/bunker-hydraulic.webm', './audio/sfx/bunker-hydraulic.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.65,
    throttleMs: 250,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'door-hydraulic',
  }),

  [SOUND_IDS.BUNKER_DOOR_OPEN]: Object.freeze({
    id: SOUND_IDS.BUNKER_DOOR_OPEN,
    label: 'Відкриття шлюзу бункера',
    src: ['./audio/sfx/bunker-door/bunker-door-open.wav', './audio/sfx/bunker-door-open.webm', './audio/sfx/bunker-door-open.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.75,
    throttleMs: 300,
    interrupt: true,
    maxInstances: 1,
    preload: true,
    synthType: 'door-open',
  }),

  // ================= Музика та атмосфера (MUSIC) =================
  [SOUND_IDS.BUNKER_AMBIENT]: Object.freeze({
    id: SOUND_IDS.BUNKER_AMBIENT,
    label: 'Атмосфера бункера',
    src: ['./audio/sfx/bunker-inside/bunker-ambient.mp3'],
    channel: AUDIO_CHANNELS.MUSIC,
    baseVolume: 0.4,
    loop: true,
    html5: true,        // файл ~4 МБ: стрімінг через <audio> замість повного декодування в пам'ять: стартує одразу й не їсть ~50 МБ RAM
    interrupt: true,
    maxInstances: 1,
    preload: false,
    synthType: 'drone',
  }),
});

/**
 * Повертає конфігурацію звуку за його ID або null, якщо не знайдено.
 */
export function getSoundConfig(soundId) {
  return SOUND_CATALOG[soundId] || null;
}

/**
 * Повертає список усіх звуків певного каналу.
 */
export function getSoundsByChannel(channel) {
  return Object.values(SOUND_CATALOG).filter(item => item.channel === channel);
}

