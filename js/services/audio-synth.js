/**
 * Процедурний Web Audio API синтезатор звукових ефектів TrueBunker.
 * Забезпечує автентичне резервне звучання (fallback) для всіх 14 аудіофайлів гри
 * та надає відкритий інтерфейс для інтерактивної Аудіо-лабораторії (audio-lab.html).
 */

import { SYNTH_RECIPES } from '../constants/synth-recipes.js';

// Рецепти винесено в constants/synth-recipes.js; реекспорт зберігає публічний API модуля
export { SYNTH_RECIPES };

// Мапінг аліасів та legacy synthType на канонічні ID
const SOUND_ID_ALIASES = Object.freeze({
  'cataclysm-siren': 'cataclysm-alert',
  'alarm': 'cataclysm-alert',
  'click': 'ui-click',
  'tab': 'tab-switch',
  'dice': 'dice-roll',
  'tick': 'timer-tick',
  'door-close': 'bunker-door-close',
  'door-slam': 'bunker-door-slam',
  'door-hydraulic': 'bunker-hydraulic',
  'door-open': 'bunker-door-open',
  'drone': 'bunker-ambient',
});

let _sharedCtx = null;
let _instanceSeq = 0;
let _outputDestination = null; // Дозволяє підключити AnalyserNode в audio-lab.html
const _activeInstances = new Map();
let _ambientState = null;
let _unlocked = false;

function _resolveId(soundIdOrType) {
  if (!soundIdOrType) return 'ui-click';
  return SOUND_ID_ALIASES[soundIdOrType] || soundIdOrType;
}

function _getContext() {
  if (typeof window === 'undefined') return null;

  // Якщо Howler вже створив власний AudioContext — використовуємо його для синхронного автоплею
  if (window.Howler && window.Howler.ctx && window.Howler.ctx.state !== 'closed') {
    _sharedCtx = window.Howler.ctx;
  }

  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      _sharedCtx = new AudioCtx();
    }
  }
  return _sharedCtx;
}

function _getDestination(ctx, customDest) {
  if (customDest) return customDest;
  if (_outputDestination) return _outputDestination;
  return ctx.destination;
}

function _createNoiseBuffer(ctx, durationSec, pink = false) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (!pink) {
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  } else {
    // Наближення рожевого шуму (фільтр Келлета) для природного гулу та тертя металу
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

export const AudioSynth = {
  /**
   * Повертає активний AudioContext.
   */
  getContext() {
    return _getContext();
  },

  /**
   * Кількість активних one-shot/loop інстансів (діагностика та тести витоків).
   */
  getActiveCount() {
    return _activeInstances.size;
  },

  /**
   * Дозволяє підключити проміжний вузол виводу (напр. AnalyserNode для осцилографа в лабораторії).
   */
  setOutputNode(node) {
    _outputDestination = node || null;
  },

  /**
   * Розблоковує AudioContext після жесту користувача.
   */
  isUnlocked() {
    return Boolean(_unlocked || (_sharedCtx && _sharedCtx.state === 'running'));
  },

  async unlock() {
    _unlocked = true;
    const ctx = _getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        await ctx.resume();
      } catch (_) {}
    }
  },

  /**
   * Повертає масив усіх канонічних звукових ідентифікаторів.
   */
  getSupportedSoundIds() {
    return Object.keys(SYNTH_RECIPES);
  },

  /**
   * Повертає метадані та формулу синтезу для конкретного звуку.
   */
  getRecipe(soundId) {
    const canonical = _resolveId(soundId);
    return SYNTH_RECIPES[canonical] || null;
  },

  /**
   * Відтворює синтезований звук за його ID.
   * @param {string} soundId
   * @param {object} [options]
   * @param {number} [options.volume=0.8]
   * @param {number} [options.rate=1.0]
   * @param {boolean} [options.loop=false]
   * @param {AudioNode} [options.destination]
   */
  play(soundId, options = {}) {
    const ctx = _getContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      if (_unlocked) ctx.resume().catch(() => {});
    }

    const canonicalId = _resolveId(soundId);
    const vol = Math.max(0.0001, Math.min(1, Number(options.volume ?? 0.8)));
    const rate = Math.max(0.5, Math.min(2.0, Number(options.rate ?? 1.0)));
    const loop = Boolean(options.loop);

    if (canonicalId === 'bunker-ambient') {
      this.startAmbient({ volume: vol, destination: options.destination });
      return {
        id: 'synth-ambient',
        soundId: 'bunker-ambient',
        stop: (fadeMs = 300) => this.stopAmbient(fadeMs / 1000),
      };
    }

    const now = ctx.currentTime;
    const dest = _getDestination(ctx, options.destination);
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1, now);
    masterGain.connect(dest);

    const sources = [];
    const timers = [];
    const instanceId = `synth_${++_instanceSeq}`;

    // I-1: інстанс прибирається, коли завершились усі його джерела. Loop-інстанс (є активний таймер)
    // живе між циклами і знімається лише через stop().
    let pendingSources = 0;
    const finalizeInstance = () => {
      timers.forEach((id) => clearInterval(id));
      timers.length = 0;
      try { masterGain.disconnect(); } catch (_) {}
      _activeInstances.delete(instanceId);
    };

    const registerSource = (src) => {
      sources.push(src);
      pendingSources++;
      src.onended = () => {
        pendingSources--;
        if (pendingSources <= 0 && timers.length === 0) finalizeInstance();
      };
      return src;
    };

    switch (canonicalId) {
      case 'lock-hover': {
        // Делікатний високочастотний металевий мікро-клац (26 мс)
        const osc = registerSource(ctx.createOscillator());
        const sub = registerSource(ctx.createOscillator());
        const env = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1650 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(2350 * rate, now + 0.024);

        sub.type = 'triangle';
        sub.frequency.setValueAtTime(3300 * rate, now);
        sub.frequency.exponentialRampToValueAtTime(1900 * rate, now + 0.02);

        env.gain.setValueAtTime(vol * 0.28, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

        osc.connect(env);
        sub.connect(env);
        env.connect(masterGain);

        osc.start(now);
        sub.start(now);
        osc.stop(now + 0.03);
        sub.stop(now + 0.025);
        break;
      }

      case 'lock-toggle': {
        // Подвійне пружинне клацання ригеля замка (0 мс та 46 мс) + короткий шум тертя
        const clicks = [
          { offset: 0, fStart: 440, fEnd: 290, dur: 0.038, gain: 0.45 },
          { offset: 0.046, fStart: 680, fEnd: 480, dur: 0.062, gain: 0.52 },
        ];

        clicks.forEach((c) => {
          const t = now + c.offset;
          const osc = registerSource(ctx.createOscillator());
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(c.fStart * rate, t);
          osc.frequency.exponentialRampToValueAtTime(c.fEnd * rate, t + c.dur);

          g.gain.setValueAtTime(vol * c.gain, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + c.dur + 0.005);

          osc.connect(g);
          g.connect(masterGain);
          osc.start(t);
          osc.stop(t + c.dur + 0.008);
        });

        // Шумовий сплеск механізму
        const noise = registerSource(ctx.createBufferSource());
        noise.buffer = _createNoiseBuffer(ctx, 0.09);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(2800 * rate, now);
        bp.Q.setValueAtTime(3.0, now);

        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.2, now);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

        noise.connect(bp);
        bp.connect(ng);
        ng.connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.09);
        break;
      }

      case 'ui-click': {
        // Тактильний клік клавіші: швидкий спад тону + мікро-сплеск шуму
        const osc = registerSource(ctx.createOscillator());
        const env = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(840 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(220 * rate, now + 0.034);

        env.gain.setValueAtTime(vol * 0.42, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

        osc.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.042);

        const noise = registerSource(ctx.createBufferSource());
        noise.buffer = _createNoiseBuffer(ctx, 0.015);
        const hp = ctx.createBiquadFilter();
        hp.type = 'bandpass';
        hp.frequency.setValueAtTime(3400 * rate, now);
        hp.Q.setValueAtTime(2.5, now);

        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.22, now);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.014);

        noise.connect(hp);
        hp.connect(ng);
        ng.connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.015);
        break;
      }

      case 'tab-switch': {
        // М'який шовковистий перехід вкладки
        const osc = registerSource(ctx.createOscillator());
        const lpf = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(460 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(780 * rate, now + 0.055);

        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(1800, now);

        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(vol * 0.34, now + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.062);

        osc.connect(lpf);
        lpf.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.066);
        break;
      }

      case 'dice-roll': {
        // 5 пружних ударів гральної кістки по столу зі спадаючою енергією
        const hits = [
          { t: 0.0, freq: 540, amp: 0.48 },
          { t: 0.065, freq: 710, amp: 0.42 },
          { t: 0.13, freq: 620, amp: 0.36 },
          { t: 0.19, freq: 790, amp: 0.3 },
          { t: 0.24, freq: 860, amp: 0.22 },
        ];

        hits.forEach((h) => {
          const start = now + h.t;
          const osc = registerSource(ctx.createOscillator());
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(h.freq * rate, start);
          osc.frequency.exponentialRampToValueAtTime(210 * rate, start + 0.04);

          g.gain.setValueAtTime(vol * h.amp, start);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.044);

          osc.connect(g);
          g.connect(masterGain);
          osc.start(start);
          osc.stop(start + 0.046);

          // Короткий кістяний клік при кожному ударі
          const n = registerSource(ctx.createBufferSource());
          n.buffer = _createNoiseBuffer(ctx, 0.016);
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(2600 * rate, start);
          bp.Q.setValueAtTime(3.2, start);

          const ng = ctx.createGain();
          ng.gain.setValueAtTime(vol * h.amp * 0.45, start);
          ng.gain.exponentialRampToValueAtTime(0.0001, start + 0.014);

          n.connect(bp);
          bp.connect(ng);
          ng.connect(masterGain);
          n.start(start);
          n.stop(start + 0.016);
        });
        break;
      }

      case 'roulette-tick': {
        // Гостре клацання пластикового прапорця рулетки
        const osc = registerSource(ctx.createOscillator());
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1250 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(480 * rate, now + 0.018);

        g.gain.setValueAtTime(vol * 0.38, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.021);

        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.024);

        const noise = registerSource(ctx.createBufferSource());
        noise.buffer = _createNoiseBuffer(ctx, 0.012);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(3200 * rate, now);
        bp.Q.setValueAtTime(4.5, now);

        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vol * 0.32, now);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.011);

        noise.connect(bp);
        bp.connect(ng);
        ng.connect(masterGain);
        noise.start(now);
        noise.stop(now + 0.012);
        break;
      }

      case 'roulette-reveal':
      case 'card-reveal': {
        // Урочистий резонансний акорд фіксації вибору (C5 - E5 - G5 - C6)
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const start = now + idx * 0.045;
          const dur = 0.62 - idx * 0.05;
          const osc = registerSource(ctx.createOscillator());
          const sub = registerSource(ctx.createOscillator());
          const g = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq * rate, start);

          sub.type = 'sine';
          sub.frequency.setValueAtTime(freq * 1.003 * rate, start); // легкий хорус

          g.gain.setValueAtTime(0.001, start);
          g.gain.linearRampToValueAtTime(vol * 0.24, start + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

          osc.connect(g);
          sub.connect(g);
          g.connect(masterGain);

          osc.start(start);
          sub.start(start);
          osc.stop(start + dur + 0.02);
          sub.stop(start + dur + 0.02);
        });
        break;
      }

      case 'timer-tick': {
        // Чіткий металевий хід секундоміра бункера
        const osc = registerSource(ctx.createOscillator());
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1180 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(440 * rate, now + 0.02);

        g.gain.setValueAtTime(vol * 0.35, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.023);

        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.025);
        break;
      }

      case 'cataclysm-alert': {
        // Тривожна сирена бункера (підтримує як one-shot 1с, так і нескінченний loop)
        const triggerSirenCycle = (cycleStart) => {
          const osc1 = registerSource(ctx.createOscillator());
          const osc2 = registerSource(ctx.createOscillator());
          const filter = ctx.createBiquadFilter();
          const cycleGain = ctx.createGain();

          osc1.type = 'sawtooth';
          osc1.frequency.setValueAtTime(330 * rate, cycleStart);
          osc1.frequency.linearRampToValueAtTime(670 * rate, cycleStart + 0.45);
          osc1.frequency.linearRampToValueAtTime(350 * rate, cycleStart + 0.92);

          osc2.type = 'triangle';
          osc2.frequency.setValueAtTime(165 * rate, cycleStart);
          osc2.frequency.linearRampToValueAtTime(335 * rate, cycleStart + 0.45);
          osc2.frequency.linearRampToValueAtTime(175 * rate, cycleStart + 0.92);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1500, cycleStart);

          cycleGain.gain.setValueAtTime(0.001, cycleStart);
          cycleGain.gain.linearRampToValueAtTime(vol * 0.42, cycleStart + 0.08);
          cycleGain.gain.setValueAtTime(vol * 0.42, cycleStart + 0.78);
          cycleGain.gain.exponentialRampToValueAtTime(0.0001, cycleStart + 0.96);

          osc1.connect(filter);
          osc2.connect(filter);
          filter.connect(cycleGain);
          cycleGain.connect(masterGain);

          osc1.start(cycleStart);
          osc2.start(cycleStart);
          osc1.stop(cycleStart + 0.98);
          osc2.stop(cycleStart + 0.98);
        };

        triggerSirenCycle(now);

        if (loop && typeof setInterval === 'function') {
          const intervalId = setInterval(() => {
            if (!_activeInstances.has(instanceId)) {
              clearInterval(intervalId);
              return;
            }
            const c = _getContext();
            if (c) triggerSirenCycle(c.currentTime);
          }, 980);
          timers.push(intervalId);
        }
        break;
      }

      case 'bunker-door-close': {
        // Важкий низькочастотний гул сервоприводів та тертя бронестулок (~1.55с)
        const osc = registerSource(ctx.createOscillator());
        const sub = registerSource(ctx.createOscillator());
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(52 * rate, now);
        osc.frequency.linearRampToValueAtTime(96 * rate, now + 0.98);
        osc.frequency.linearRampToValueAtTime(58 * rate, now + 1.48);

        sub.type = 'triangle';
        sub.frequency.setValueAtTime(34 * rate, now);
        sub.frequency.linearRampToValueAtTime(50 * rate, now + 1.42);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(170, now);
        filter.frequency.linearRampToValueAtTime(390, now + 1.05);
        filter.frequency.linearRampToValueAtTime(150, now + 1.5);

        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(vol * 0.48, now + 0.18);
        env.gain.setValueAtTime(vol * 0.48, now + 1.2);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 1.52);

        osc.connect(filter);
        sub.connect(filter);
        filter.connect(env);
        env.connect(masterGain);

        osc.start(now);
        sub.start(now);
        osc.stop(now + 1.55);
        sub.stop(now + 1.55);

        // Шум металевих рейок
        const railNoise = registerSource(ctx.createBufferSource());
        railNoise.buffer = _createNoiseBuffer(ctx, 1.5, true);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(850, now);
        bp.frequency.linearRampToValueAtTime(1450, now + 1.1);
        bp.Q.setValueAtTime(2.0, now);

        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.001, now);
        ng.gain.linearRampToValueAtTime(vol * 0.2, now + 0.25);
        ng.gain.exponentialRampToValueAtTime(0.0001, now + 1.48);

        railNoise.connect(bp);
        bp.connect(ng);
        ng.connect(masterGain);
        railNoise.start(now);
        railNoise.stop(now + 1.5);
        break;
      }

      case 'bunker-door-slam': {
        // Масивний удар зачинення шлюзу + металевий резонанс (~0.62с)
        const subOsc = registerSource(ctx.createOscillator());
        const clangOsc = registerSource(ctx.createOscillator());
        const subGain = ctx.createGain();
        const clangGain = ctx.createGain();

        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(180 * rate, now);
        subOsc.frequency.exponentialRampToValueAtTime(28 * rate, now + 0.48);

        clangOsc.type = 'triangle';
        clangOsc.frequency.setValueAtTime(330 * rate, now);
        clangOsc.frequency.exponentialRampToValueAtTime(95 * rate, now + 0.24);

        subGain.gain.setValueAtTime(vol * 0.78, now);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.56);

        clangGain.gain.setValueAtTime(vol * 0.42, now);
        clangGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

        subOsc.connect(subGain);
        subGain.connect(masterGain);
        clangOsc.connect(clangGain);
        clangGain.connect(masterGain);

        subOsc.start(now);
        clangOsc.start(now);
        subOsc.stop(now + 0.58);
        clangOsc.stop(now + 0.28);

        // Ударний шумовий імпульс зіткнення
        const boomNoise = registerSource(ctx.createBufferSource());
        boomNoise.buffer = _createNoiseBuffer(ctx, 0.35, true);
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(950, now);
        lpf.frequency.exponentialRampToValueAtTime(140, now + 0.32);

        const bg = ctx.createGain();
        bg.gain.setValueAtTime(vol * 0.5, now);
        bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

        boomNoise.connect(lpf);
        lpf.connect(bg);
        bg.connect(masterGain);
        boomNoise.start(now);
        boomNoise.stop(now + 0.35);
        break;
      }

      case 'bunker-hydraulic': {
        // Подвійне клацання ригелів + пневматичне шипіння пари (~0.78с)
        [0, 0.115].forEach((offset, idx) => {
          const boltOsc = registerSource(ctx.createOscillator());
          const boltGain = ctx.createGain();
          boltOsc.type = 'triangle';
          const baseFreq = idx === 0 ? 440 : 560;
          boltOsc.frequency.setValueAtTime(baseFreq * rate, now + offset);
          boltOsc.frequency.exponentialRampToValueAtTime(170 * rate, now + offset + 0.075);

          boltGain.gain.setValueAtTime(vol * 0.46, now + offset);
          boltGain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.08);

          boltOsc.connect(boltGain);
          boltGain.connect(masterGain);
          boltOsc.start(now + offset);
          boltOsc.stop(now + offset + 0.085);
        });

        // Пневматичне шипіння виходу повітря
        const noise = registerSource(ctx.createBufferSource());
        noise.buffer = _createNoiseBuffer(ctx, 0.62);

        const bpFilter = ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.setValueAtTime(2400 * rate, now + 0.14);
        bpFilter.frequency.exponentialRampToValueAtTime(650 * rate, now + 0.72);
        bpFilter.Q.setValueAtTime(2.2, now + 0.14);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, now + 0.14);
        hissGain.gain.linearRampToValueAtTime(vol * 0.34, now + 0.19);
        hissGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.74);

        noise.connect(bpFilter);
        bpFilter.connect(hissGain);
        hissGain.connect(masterGain);
        noise.start(now + 0.14);
        noise.stop(now + 0.76);
        break;
      }

      case 'bunker-door-open': {
        // Розгерметизація замків та гідравлічний відкат стулок (~1.45с)
        const osc = registerSource(ctx.createOscillator());
        const filter = ctx.createBiquadFilter();
        const env = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(48 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(116 * rate, now + 0.98);
        osc.frequency.linearRampToValueAtTime(68 * rate, now + 1.38);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(200, now);
        filter.frequency.linearRampToValueAtTime(490, now + 0.88);
        filter.frequency.linearRampToValueAtTime(140, now + 1.38);

        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(vol * 0.45, now + 0.12);
        env.gain.setValueAtTime(vol * 0.4, now + 1.0);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 1.42);

        osc.connect(filter);
        filter.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 1.45);
        break;
      }

      default: {
        // Fallback для додаткових ID (vote-cast, timer-end, player-kick)
        const osc = registerSource(ctx.createOscillator());
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(880 * rate, now + 0.08);
        env.gain.setValueAtTime(vol * 0.35, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        osc.connect(env);
        env.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    }

    const handle = {
      id: instanceId,
      soundId: canonicalId,
      stop: (fadeMs = 50) => {
        timers.forEach((id) => clearInterval(id));
        timers.length = 0;
        const c = _getContext();
        const fadeSec = Math.max(0.005, (fadeMs || 50) / 1000);
        if (c) {
          const t = c.currentTime;
          try {
            masterGain.gain.cancelScheduledValues(t);
            masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value || 0.1), t);
            masterGain.gain.exponentialRampToValueAtTime(0.0001, t + fadeSec);
          } catch (_) {}
        }
        sources.forEach((src) => {
          try {
            src.stop(c ? c.currentTime + fadeSec : 0);
          } catch (_) {}
        });
        _activeInstances.delete(instanceId);
      },
    };

    _activeInstances.set(instanceId, handle);
    return handle;
  },

  /**
   * Зупиняє активний інстанс або всі інстанси певного soundId.
   */
  stop(instanceOrSoundId, fadeMs = 50) {
    if (!instanceOrSoundId) return;
    if (typeof instanceOrSoundId === 'object' && typeof instanceOrSoundId.stop === 'function') {
      instanceOrSoundId.stop(fadeMs);
      return;
    }
    const targetId = _resolveId(String(instanceOrSoundId));
    if (targetId === 'bunker-ambient') {
      this.stopAmbient((fadeMs || 300) / 1000);
      return;
    }
    for (const inst of _activeInstances.values()) {
      if (inst.soundId === targetId || inst.id === targetId) {
        inst.stop(fadeMs);
      }
    }
  },

  /**
   * Зупиняє всі активні синтезовані звуки та фоновий ембієнт.
   */
  stopAll(fadeMs = 50) {
    for (const inst of _activeInstances.values()) {
      inst.stop(fadeMs);
    }
    _activeInstances.clear();
    this.stopAmbient((fadeMs || 100) / 1000);
  },

  /**
   * Запускає поліфонічний фоновий гул вентиляції бункера.
   */
  startAmbient(options = {}) {
    const ctx = _getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      if (_unlocked) ctx.resume().catch(() => {});
    }

    const vol = Math.max(0.0001, Math.min(1, Number(options.volume ?? 0.4)));
    const rampDuration = Math.max(0.02, Number(options.rampDuration ?? 0.6));

    if (_ambientState) {
      this.setAmbientVolume(vol, rampDuration * 1000);
      return;
    }

    const now = ctx.currentTime;
    const dest = _getDestination(ctx, options.destination);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gainNode = ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(55, now); // A1

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(82.41, now); // E2

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(155, now);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(vol * 0.25, now + rampDuration);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(dest);

    osc1.start(now);
    osc2.start(now);

    _ambientState = {
      osc1,
      osc2,
      filter,
      gainNode,
      targetVolume: vol,
    };
  },

  /**
   * Плавно змінює гучність активного ембієнт-дрона.
   */
  setAmbientVolume(volume, rampMs = 60) {
    if (!_ambientState) return;
    const ctx = _getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const rampSec = Math.max(0.01, (rampMs || 60) / 1000);
    const targetGain = Math.max(0.0001, Math.min(1, Number(volume ?? 0))) * 0.25;

    _ambientState.targetVolume = volume;
    try {
      _ambientState.gainNode.gain.cancelScheduledValues(now);
      _ambientState.gainNode.gain.setValueAtTime(
        Math.max(0.0001, _ambientState.gainNode.gain.value || 0.01),
        now
      );
      _ambientState.gainNode.gain.linearRampToValueAtTime(targetGain, now + rampSec);
    } catch (_) {}
  },

  /**
   * Зупиняє фоновий ембієнт-дрон.
   */
  stopAmbient(fadeSec = 0.35) {
    if (!_ambientState) return;
    const state = _ambientState;
    _ambientState = null;

    const ctx = _getContext();
    const dur = Math.max(0.01, Number(fadeSec ?? 0.35));

    try {
      if (ctx) {
        const now = ctx.currentTime;
        state.gainNode.gain.cancelScheduledValues(now);
        state.gainNode.gain.setValueAtTime(Math.max(0.0001, state.gainNode.gain.value || 0.05), now);
        state.gainNode.gain.linearRampToValueAtTime(0.0001, now + dur);
        state.osc1.stop(now + dur + 0.02);
        state.osc2.stop(now + dur + 0.02);
      } else {
        state.osc1.stop();
        state.osc2.stop();
      }
    } catch (_) {}
  },

  /**
   * Чи активний зараз синтезований фоновий ембієнт.
   */
  isAmbientPlaying() {
    return Boolean(_ambientState);
  },
};
