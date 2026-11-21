/**
 * Рецепти процедурного синтезу звуків TrueBunker (метадані для audio-synth.js та audio-lab.html).
 * Тільки дані, без логіки; сам синтезатор і реекспорт SYNTH_RECIPES — у js/services/audio-synth.js.
 */

export const SYNTH_RECIPES = Object.freeze({
  'lock-hover': Object.freeze({
    id: 'lock-hover',
    category: 'ui',
    durationSec: 0.032,
    formula: 'Sine+Triangle Sweep (1650→2350 Hz, 26ms) + High Metallic Transient',
    description: 'Ультракороткий металевий мікро-імпульс при наведенні на замок',
  }),
  'lock-toggle': Object.freeze({
    id: 'lock-toggle',
    category: 'ui',
    durationSec: 0.125,
    formula: '2x Pin Clicks (0ms @ 440Hz, 46ms @ 680Hz) + Bandpass Latch Noise (2.8kHz)',
    description: 'Подвійне механічне клацання ригеля замка характеристики',
  }),
  'ui-click': Object.freeze({
    id: 'ui-click',
    category: 'ui',
    durationSec: 0.045,
    formula: 'Triangle Drop (840→220 Hz, 34ms) + Crisp Noise Burst (12ms @ 3.4kHz)',
    description: 'Щільний тактильний клік клавіші терміналу',
  }),
  'tab-switch': Object.freeze({
    id: 'tab-switch',
    category: 'ui',
    durationSec: 0.068,
    formula: 'Sine Glide (460→780 Hz, 55ms) + Soft Air Filter (LPF 1.8kHz)',
    description: 'М\'який шовковистий перехід між вкладками інтерфейсу',
  }),
  'dice-roll': Object.freeze({
    id: 'dice-roll',
    category: 'ui',
    durationSec: 0.34,
    formula: '5x Aperiodic Bounces (520..860→210 Hz) + Wood/Bone Noise Transients',
    description: 'Серія пружних ударів гральної кістки по поверхні столу',
  }),
  'roulette-tick': Object.freeze({
    id: 'roulette-tick',
    category: 'sfx',
    durationSec: 0.028,
    formula: 'Bandpass Noise Burst (3.2kHz, Q=4.5) + Triangle Peg Impulse (1250→480 Hz)',
    description: 'Гостре клацання прапорця барабана рулетки',
  }),
  'roulette-reveal': Object.freeze({
    id: 'roulette-reveal',
    category: 'sfx',
    durationSec: 0.82,
    formula: 'Harmonic Arpeggio (C5-E5-G5-C6) + Detuned Chorus + Bell Decay (0.8s)',
    description: 'Урочистий резонансний акорд фіксації результату рулетки',
  }),
  'timer-tick': Object.freeze({
    id: 'timer-tick',
    category: 'bunker',
    durationSec: 0.03,
    formula: 'Escapement Impulse (1180→440 Hz, 20ms) + Metallic Highpass Tick (2.2kHz)',
    description: 'Сухий чіткий хід годинникового механізму таймера',
  }),
  'cataclysm-alert': Object.freeze({
    id: 'cataclysm-alert',
    category: 'bunker',
    durationSec: 1.0,
    loopable: true,
    formula: 'Dual Sawtooth Klaxon (330↔670 Hz LFO) + Resonant Horn LPF (1.5kHz)',
    description: 'Тривожна сирена оповіщення про катаклізм у бункері',
  }),
  'bunker-door-close': Object.freeze({
    id: 'bunker-door-close',
    category: 'bunker',
    durationSec: 1.55,
    formula: 'Servo Sawtooth (52→96→58 Hz) + Sub Triangle (34 Hz) + Rail Noise',
    description: 'Важкий низькочастотний гул сервоприводів та насування бронестулок',
  }),
  'bunker-door-slam': Object.freeze({
    id: 'bunker-door-slam',
    category: 'bunker',
    durationSec: 0.62,
    formula: 'Sub-Bass Impact (180→28 Hz) + Metallic Clang (330→95 Hz) + Boom Burst',
    description: 'Масивний удар зіткнення багатотонних стулок гермошлюзу',
  }),
  'bunker-hydraulic': Object.freeze({
    id: 'bunker-hydraulic',
    category: 'bunker',
    durationSec: 0.78,
    formula: '2x Bolt Locks (440/560→170 Hz) + Pneumatic Steam Hiss (2.4kHz→650Hz)',
    description: 'Замикання гідроригелів та шипіння стисненого повітря шлюзу',
  }),
  'bunker-door-open': Object.freeze({
    id: 'bunker-door-open',
    category: 'bunker',
    durationSec: 1.45,
    formula: 'Seal Release Pop + Hydraulic Retract (48→116→68 Hz) + LPF Sweep',
    description: 'Розгерметизація ущільнювачів та відкат стулок бункера',
  }),
  'bunker-ambient': Object.freeze({
    id: 'bunker-ambient',
    category: 'bunker',
    durationSec: Infinity,
    loopable: true,
    formula: 'Poly Drone (55Hz A1 + 82.4Hz E2) + LPF 155Hz + Filtered Shaft Air Noise',
    description: 'Глибокий безперервний гул вентиляційної шахти та генераторів бункера',
  }),
});
