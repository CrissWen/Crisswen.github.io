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
    description: 'Кидок кубика, розкриття карток, таймер, голосування та сирени',
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
});

export const SOUND_IDS = Object.freeze({
  // --- Інтерфейс (UI) ---
  LOCK_HOVER: 'lock-hover',
  LOCK_TOGGLE: 'lock-toggle',
  UI_CLICK: 'ui-click',
  TAB_SWITCH: 'tab-switch',

  // --- Ігрові ефекти (SFX) ---
  DICE_ROLL: 'dice-roll',
  CARD_REVEAL: 'card-reveal',
  VOTE_CAST: 'vote-cast',
  TIMER_TICK: 'timer-tick',
  TIMER_END: 'timer-end',
  CATACLYSM_ALERT: 'cataclysm-alert',
  PLAYER_KICK: 'player-kick',

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
 * - preload: чи завантажувати наперед (false за замовчуванням, поки файли додаються поступово)
 * - synthType: тип процедурного Web Audio сигналу-фоллбеку, якщо аудіофайл ще відсутній на диску
 */
export const SOUND_CATALOG = Object.freeze({
  // ================= Інтерфейс (UI) =================
  [SOUND_IDS.LOCK_HOVER]: Object.freeze({
    id: SOUND_IDS.LOCK_HOVER,
    label: 'Наведення на замок',
    src: ['./audio/ui/lock-hover.webm', './audio/ui/lock-hover.mp3'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.35,   // делікатний тихий відгук при наведенні
    throttleMs: 65,     // анти-спам: не частіше ніж раз на 65 мс при проведенні мишею по таблиці
    interrupt: true,    // обривати попередній семпл, щоб не накладалися
    maxInstances: 1,
    pitchShift: 0.05,   // ±5% варіація тону, щоб серія замків звучала живо, а не механічно
    preload: false,
    synthType: 'lock-hover',
  }),

  [SOUND_IDS.LOCK_TOGGLE]: Object.freeze({
    id: SOUND_IDS.LOCK_TOGGLE,
    label: 'Відкриття / закриття замка',
    src: ['./audio/ui/lock-toggle.webm', './audio/ui/lock-toggle.mp3'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.65,
    throttleMs: 80,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.03,
    preload: false,
    synthType: 'lock-toggle',
  }),

  [SOUND_IDS.UI_CLICK]: Object.freeze({
    id: SOUND_IDS.UI_CLICK,
    label: 'Клік кнопки',
    src: ['./audio/ui/click.webm', './audio/ui/click.mp3'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.55,
    throttleMs: 45,
    interrupt: true,
    maxInstances: 2,
    pitchShift: 0.03,
    preload: false,
    synthType: 'click',
  }),

  [SOUND_IDS.TAB_SWITCH]: Object.freeze({
    id: SOUND_IDS.TAB_SWITCH,
    label: 'Перемикання вкладки',
    src: ['./audio/ui/tab-switch.webm', './audio/ui/tab-switch.mp3'],
    channel: AUDIO_CHANNELS.UI,
    baseVolume: 0.45,
    throttleMs: 50,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.02,
    preload: false,
    synthType: 'tab',
  }),

  // ================= Ігрові ефекти (SFX) =================
  [SOUND_IDS.DICE_ROLL]: Object.freeze({
    id: SOUND_IDS.DICE_ROLL,
    label: 'Кидок кубика',
    src: ['./audio/sfx/dice-roll.webm', './audio/sfx/dice-roll.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.85,
    throttleMs: 250,
    interrupt: true,
    maxInstances: 1,
    pitchShift: 0.03,
    preload: false,
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
    src: ['./audio/sfx/timer-tick.webm', './audio/sfx/timer-tick.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.4,    // цокання не має глушити розмову гравців
    throttleMs: 400,
    interrupt: true,
    maxInstances: 1,
    preload: false,
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
    src: ['./audio/sfx/cataclysm-siren.webm', './audio/sfx/cataclysm-siren.mp3'],
    channel: AUDIO_CHANNELS.SFX,
    baseVolume: 0.45,   // сирени зазвичай дуже гучні по LUFS, тому калібруємо нижче
    throttleMs: 1000,
    interrupt: true,
    maxInstances: 1,
    preload: false,
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

  // ================= Музика та атмосфера (MUSIC) =================
  [SOUND_IDS.BUNKER_AMBIENT]: Object.freeze({
    id: SOUND_IDS.BUNKER_AMBIENT,
    label: 'Атмосфера бункера',
    src: ['./audio/music/bunker-ambient.webm', './audio/music/bunker-ambient.mp3'],
    channel: AUDIO_CHANNELS.MUSIC,
    baseVolume: 0.4,
    loop: true,
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

