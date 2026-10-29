/**
 * Централізований менеджер аудіо (SoundManager) на базі Howler.js
 * із підтримкою каналів гучності (Master, SFX, UI, Music),
 * точкового калібрування кожного звуку (baseVolume),
 * захисту від какофонії (throttleMs, interrupt, maxInstances, pitchShift)
 * та синтезованого Web Audio фоллбеку на випадок відсутності аудіофайлів.
 */

import {
  AUDIO_CHANNELS,
  DEFAULT_AUDIO_SETTINGS,
  SOUND_CATALOG,
  SOUND_IDS,
  getSoundConfig,
} from '../constants/sounds.js';

const STORAGE_KEY_SETTINGS = 'bunker-audio-settings';

class SoundManager {
  constructor() {
    this._settings = { ...DEFAULT_AUDIO_SETTINGS };
    this._howls = new Map(); // Кеш інстансів Howl: soundId -> Howl
    this._lastPlayedAt = new Map(); // Час останнього відтворення (ms): soundId -> timestamp
    this._activeInstances = new Map(); // Активні ID звуків: soundId -> Set<number>
    this._missingFiles = new Set(); // Звуки, чиї файли ще не додані на диск (фоллбек на синт)
    this._listeners = new Set(); // Підписники на зміну налаштувань гучності
    this._audioCtx = null; // Web Audio API контекст для синтезованого фоллбеку
    this._ambientDroneNodes = null; // Активні вузли синтезованого ембієнту
    this._wasAmbientPlayingBeforeHide = false;
    this._initialized = false;

    this._loadFromStorage();
    // Також працює на окремій сторінці тесту виживання, де init() не викликається.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY_SETTINGS && event.key !== null) return;
        this._loadFromStorage();
        this._applyGlobalHowlerState();
        this._refreshAllActiveVolumes();
        this._notifyListeners();
      });
    }
  }

  /**
   * Ініціалізує глобальні слухачі розблокування аудіо, видимості вкладки та UI-ховерів.
   */
  init() {
    if (this._initialized || typeof window === 'undefined') return;
    this._initialized = true;

    this._applyGlobalHowlerState();
    this._setupUnlockListeners();
    this._setupVisibilityListener();
    this._setupGlobalUIHooks();
  }

  // ===========================================================================
  // Керування налаштуваннями та збереженням
  // ===========================================================================

  _loadFromStorage() {
    this._settings = { ...DEFAULT_AUDIO_SETTINGS };
    if (typeof localStorage === 'undefined') return;
    try {
      const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        this._settings = {
          masterVolume: this._clamp01(parsed.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume),
          sfxVolume: this._clamp01(parsed.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
          uiVolume: this._clamp01(parsed.uiVolume ?? DEFAULT_AUDIO_SETTINGS.uiVolume),
          musicVolume: this._clamp01(parsed.musicVolume ?? DEFAULT_AUDIO_SETTINGS.musicVolume),
          muted: Boolean(parsed.muted ?? DEFAULT_AUDIO_SETTINGS.muted),
        };
      }
    } catch (_) {
      this._settings = { ...DEFAULT_AUDIO_SETTINGS };
    }
  }

  _saveSettings() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(this._settings));
    } catch (_) {}
  }

  _clamp01(val) {
    const num = Number(val);
    if (Number.isNaN(num)) return 0;
    return Math.max(0, Math.min(1, num));
  }

  _notifyListeners() {
    const snapshot = this.getSettings();
    this._listeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (err) {
        console.error('Помилка у слухачі SoundManager:', err);
      }
    });
  }

  /**
   * Підписка на зміни гучності / Mute.
   * Повертає функцію відписки.
   */
  subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * Повертає копію поточних налаштувань гучності.
   */
  getSettings() {
    return { ...this._settings };
  }

  /**
   * Повертає базову гучність (baseVolume) конкретного звуку з каталогу розробника (sounds.js).
   */
  getSoundBaseVolume(soundId) {
    const config = getSoundConfig(soundId);
    return config ? this._clamp01(config.baseVolume ?? 1) : 1;
  }

  /**
   * Скидає загальні налаштування гучності каналів до дефолтних.
   */
  resetSettings() {
    this._settings = { ...DEFAULT_AUDIO_SETTINGS };
    this._saveSettings();
    this._applyGlobalHowlerState();
    this._refreshAllActiveVolumes();
    this._notifyListeners();
  }

  // ===========================================================================
  // Керування каналами гучності та Mute
  // ===========================================================================

  getChannelVolume(channel) {
    switch (channel) {
      case AUDIO_CHANNELS.MASTER:
        return this._settings.masterVolume;
      case AUDIO_CHANNELS.SFX:
        return this._settings.sfxVolume;
      case AUDIO_CHANNELS.UI:
        return this._settings.uiVolume;
      case AUDIO_CHANNELS.MUSIC:
        return this._settings.musicVolume;
      default:
        return 1;
    }
  }

  setChannelVolume(channel, value) {
    const clamped = this._clamp01(value);
    switch (channel) {
      case AUDIO_CHANNELS.MASTER:
        this._settings.masterVolume = clamped;
        break;
      case AUDIO_CHANNELS.SFX:
        this._settings.sfxVolume = clamped;
        break;
      case AUDIO_CHANNELS.UI:
        this._settings.uiVolume = clamped;
        break;
      case AUDIO_CHANNELS.MUSIC:
        this._settings.musicVolume = clamped;
        break;
      default:
        return;
    }

    // Якщо користувач тягне повзунок вгору при увімкненому Mute — автоматично розм'ючуємо
    if (clamped > 0 && this._settings.muted && channel === AUDIO_CHANNELS.MASTER) {
      this._settings.muted = false;
    }

    this._saveSettings();
    this._applyGlobalHowlerState();
    this._refreshAllActiveVolumes();
    this._notifyListeners();
  }

  setMasterVolume(value) {
    this.setChannelVolume(AUDIO_CHANNELS.MASTER, value);
  }

  setMuted(muted) {
    this._settings.muted = Boolean(muted);
    this._saveSettings();
    this._applyGlobalHowlerState();
    this._refreshAllActiveVolumes();
    this._notifyListeners();
  }

  toggleMute() {
    this.setMuted(!this._settings.muted);
    return this._settings.muted;
  }

  isMuted() {
    return this._settings.muted;
  }

  /**
   * Обчислює фінальну гучність для конкретного звуку:
   * FinalVolume = baseVolume * channelVolume * masterVolume * customVolume
   */
  getEffectiveVolume(soundId, customMultiplier = 1) {
    if (this._settings.muted) return 0;
    const config = getSoundConfig(soundId);
    if (!config) return 0;

    const baseVol = this.getSoundBaseVolume(soundId);
    const channelVol = this.getChannelVolume(config.channel);
    const masterVol = this._settings.masterVolume;

    return this._clamp01(baseVol * channelVol * masterVol * customMultiplier);
  }

  _applyGlobalHowlerState() {
    if (typeof window !== 'undefined' && window.Howler) {
      window.Howler.mute(this._settings.muted);
    }
    if (this._ambientDroneNodes?.gainNode && this._audioCtx) {
      const targetVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
      this._ambientDroneNodes.gainNode.gain.setTargetAtTime(
        targetVol * 0.25,
        this._audioCtx.currentTime,
        0.05
      );
    }
  }

  _refreshActiveVolumes(soundId) {
    const howl = this._howls.get(soundId);
    if (howl) {
      const effectiveVol = this.getEffectiveVolume(soundId);
      howl.volume(effectiveVol);
    }
    if (soundId === SOUND_IDS.BUNKER_AMBIENT && this._ambientDroneNodes?.gainNode && this._audioCtx) {
      const targetVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
      this._ambientDroneNodes.gainNode.gain.setTargetAtTime(
        targetVol * 0.25,
        this._audioCtx.currentTime,
        0.05
      );
    }
  }

  _refreshAllActiveVolumes() {
    for (const soundId of Object.keys(SOUND_CATALOG)) {
      this._refreshActiveVolumes(soundId);
    }
  }

  // ===========================================================================
  // Відтворення звуків (Play / Stop / Fade)
  // ===========================================================================

  /**
   * Програє звук за його ідентифікатором із каталогу.
   * @param {string} soundId - Ключ із SOUND_IDS / SOUND_CATALOG
   * @param {object} [options]
   * @param {number} [options.volume=1] - Додатковий множник гучності для цього конкретного виклику
   * @param {number} [options.rate] - Примусова швидкість/висота тону
   * @param {boolean} [options.bypassThrottle=false] - Ігнорувати кулдаун (напр. при кліку на кнопку "Тест")
   */
  play(soundId, options = {}) {
    const config = getSoundConfig(soundId);
    if (!config) {
      console.warn(`[SoundManager] Невідомий soundId: "${soundId}"`);
      return null;
    }

    if (this._settings.muted) return null;

    // Спроба автоматично розблокувати Howler AudioContext (актуально при виклику з консолі або передчасному запуску)
    if (typeof window !== 'undefined' && window.Howler && window.Howler.ctx && window.Howler.ctx.state === 'suspended') {
      window.Howler.ctx.resume().catch(() => {});
    }

    // 1. Захист на тач-пристроях: ховер-звуки не повинні спрацьовувати від синтетичного mouseenter при тапі
    if (soundId.endsWith('-hover') && !options.bypassThrottle) {
      if (typeof window !== 'undefined' && window.matchMedia && !window.matchMedia('(hover: hover)').matches) {
        return null;
      }
    }

    // 2. Захист від спаму та какофонії (Throttle / Cooldown)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!options.bypassThrottle && config.throttleMs > 0) {
      const lastTime = this._lastPlayedAt.get(soundId) || 0;
      if (now - lastTime < config.throttleMs) {
        return null;
      }
    }
    this._lastPlayedAt.set(soundId, now);

    // 3. Обчислення фінальної гучності та висоти тону (Pitch Shift)
    const effectiveVol = this.getEffectiveVolume(soundId, options.volume ?? 1);
    if (effectiveVol <= 0.001) return null;

    let rate = options.rate ?? 1;
    if (!options.rate && config.pitchShift > 0) {
      const delta = (Math.random() * 2 - 1) * config.pitchShift;
      rate = Math.max(0.5, Math.min(2.0, 1 + delta));
    }

    // 4. Якщо файл раніше не знайдено на диску або Howler недоступний — граємо синтезований фоллбек
    if (this._missingFiles.has(soundId) || typeof window === 'undefined' || !window.Howl) {
      this._playSynthFallback(config, effectiveVol, rate);
      return null;
    }

    // 5. Відтворення через Howler.js
    const howl = this._getOrCreateHowl(config);
    if (!howl) {
      this._playSynthFallback(config, effectiveVol, rate);
      return null;
    }

    // Обмеження одночасних інстансів (interrupt / maxInstances)
    const activeSet = this._activeInstances.get(soundId);
    if (config.interrupt) {
      howl.stop();
      activeSet?.clear();
    } else if (config.maxInstances && activeSet && activeSet.size >= config.maxInstances) {
      const oldestId = activeSet.values().next().value;
      if (oldestId !== undefined) {
        howl.stop(oldestId);
        activeSet.delete(oldestId);
      }
    }

    howl.volume(effectiveVol);
    const instanceId = howl.play();
    if (rate !== 1) {
      howl.rate(rate, instanceId);
    }

    if (activeSet && instanceId !== null && instanceId !== undefined) {
      activeSet.add(instanceId);
    }

    return instanceId;
  }

  /**
   * Зупиняє відтворення конкретного звуку.
   */
  stop(soundId) {
    const howl = this._howls.get(soundId);
    if (howl) {
      howl.stop();
    }
    this._activeInstances.get(soundId)?.clear();

    if (soundId === SOUND_IDS.BUNKER_AMBIENT) {
      this._stopAmbientDrone();
    }
  }

  /**
   * Зупиняє всі активні звуки.
   */
  stopAll() {
    if (typeof window !== 'undefined' && window.Howler) {
      window.Howler.stop();
    }
    for (const set of this._activeInstances.values()) {
      set.clear();
    }
    this._stopAmbientDrone();
  }

  /**
   * Перевіряє, чи відтворюється зараз вказаний звук (зокрема ембієнт).
   */
  isPlaying(soundId) {
    if (soundId === SOUND_IDS.BUNKER_AMBIENT && this._ambientDroneNodes) {
      return true;
    }
    const howl = this._howls.get(soundId);
    return Boolean(howl && howl.playing());
  }

  /**
   * Плавна зміна гучності звуку (Fade In / Fade Out).
   */
  fade(soundId, fromMultiplier, toMultiplier, durationMs = 500) {
    const howl = this._howls.get(soundId);
    if (!howl) return;
    const fromVol = this.getEffectiveVolume(soundId, fromMultiplier);
    const toVol = this.getEffectiveVolume(soundId, toMultiplier);
    howl.fade(fromVol, toVol, durationMs);
  }

  _getOrCreateHowl(config) {
    if (this._howls.has(config.id)) {
      return this._howls.get(config.id);
    }

    if (typeof window === 'undefined' || !window.Howl) return null;

    const activeSet = new Set();
    this._activeInstances.set(config.id, activeSet);

    const howl = new window.Howl({
      src: Array.isArray(config.src) ? config.src : [config.src],
      loop: Boolean(config.loop),
      preload: Boolean(config.preload),
      volume: this.getEffectiveVolume(config.id),
      onend: (id) => {
        activeSet.delete(id);
      },
      onstop: (id) => {
        activeSet.delete(id);
      },
      onplayerror: (id, err) => {
        console.warn(`[SoundManager] Відтворення "${config.id}" заблоковане політикою браузера (Autoplay). Клікніть на сторінці для розблокування:`, err);
        howl.once('unlock', () => {
          howl.play(id);
        });
      },
      onloaderror: (id, err) => {
        console.warn(`[SoundManager] Помилка завантаження аудіофайлу для "${config.id}":`, err);
        // Якщо аудіофайл ще фізично не поклали у папку /audio — перемикаємо цей звук на синтезатор
        if (!this._missingFiles.has(config.id)) {
          this._missingFiles.add(config.id);
          const effVol = this.getEffectiveVolume(config.id);
          if (effVol > 0.001) {
            this._playSynthFallback(config, effVol, 1);
          }
        }
      },
    });

    this._howls.set(config.id, howl);
    return howl;
  }

  // ===========================================================================
  // Процедурний Web Audio API Синтезатор (Fallback для тестування без файлів)
  // ===========================================================================

  _getAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!this._audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this._audioCtx = new AudioCtx();
      }
    }
    if (this._audioCtx && this._audioCtx.state === 'suspended') {
      this._audioCtx.resume().catch(() => {});
    }
    return this._audioCtx;
  }

  _playSynthFallback(config, effectiveVol, rate = 1) {
    const ctx = this._getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const type = config.synthType || 'click';

    if (type === 'drone') {
      this._toggleAmbientDrone(effectiveVol);
      return;
    }

    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    switch (type) {
      case 'lock-hover': {
        // Делікатний високочастотний металевий мікро-імпульс (22 мс)
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1350 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(1950 * rate, now + 0.022);

        masterGain.gain.setValueAtTime(effectiveVol * 0.25, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.024);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.025);
        break;
      }

      case 'lock-toggle': {
        // Механічне подвійне клацання ригеля замка
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(420 * rate, now);
        osc.frequency.setValueAtTime(640 * rate, now + 0.045);

        masterGain.gain.setValueAtTime(effectiveVol * 0.4, now);
        masterGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
        masterGain.gain.setValueAtTime(effectiveVol * 0.45, now + 0.045);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.115);
        break;
      }

      case 'click': {
        // Тактильний короткий клік кнопки
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(720 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(240 * rate, now + 0.032);

        masterGain.gain.setValueAtTime(effectiveVol * 0.35, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.038);
        break;
      }

      case 'tab': {
        // М'який перехід вкладки
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(480 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(760 * rate, now + 0.05);

        masterGain.gain.setValueAtTime(effectiveVol * 0.3, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.06);
        break;
      }

      case 'dice': {
        // Серія з 4 швидких пружних ударів гральної кістки
        const offsets = [0, 0.055, 0.105, 0.145];
        const freqs = [520, 680, 590, 820];
        offsets.forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const tapGain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freqs[idx] * rate, now + offset);
          osc.frequency.exponentialRampToValueAtTime(220 * rate, now + offset + 0.038);

          tapGain.gain.setValueAtTime(effectiveVol * 0.4, now + offset);
          tapGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.04);

          osc.connect(tapGain);
          tapGain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.042);
        });
        break;
      }

      case 'card': {
        // Розкриття картки — приємний двоногий акорд
        [440, 660].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const noteGain = ctx.createGain();
          const start = now + i * 0.045;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq * rate, start);
          osc.frequency.exponentialRampToValueAtTime(freq * 1.15 * rate, start + 0.14);

          noteGain.gain.setValueAtTime(effectiveVol * 0.32, start);
          noteGain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

          osc.connect(noteGain);
          noteGain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.16);
        });
        break;
      }

      case 'vote': {
        // Чіткий сигнал фіксації голосу
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33 * rate, now); // D5
        osc.frequency.setValueAtTime(880 * rate, now + 0.06); // A5

        masterGain.gain.setValueAtTime(effectiveVol * 0.35, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.17);
        break;
      }

      case 'tick': {
        // Коротке цокання таймера
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1050 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(450 * rate, now + 0.018);

        masterGain.gain.setValueAtTime(effectiveVol * 0.3, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.022);
        break;
      }

      case 'timer-end': {
        // Подвійний сигнал завершення часу
        [0, 0.14].forEach((offset) => {
          const osc = ctx.createOscillator();
          const beepGain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(740, now + offset);

          beepGain.gain.setValueAtTime(effectiveVol * 0.3, now + offset);
          beepGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);

          osc.connect(beepGain);
          beepGain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.11);
        });
        break;
      }

      case 'alarm': {
        // Тривожна сирена бункера (плавний підйом та спад частоти)
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.linearRampToValueAtTime(680, now + 0.32);
        osc.frequency.linearRampToValueAtTime(380, now + 0.65);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, now);

        masterGain.gain.setValueAtTime(0.001, now);
        masterGain.gain.linearRampToValueAtTime(effectiveVol * 0.38, now + 0.06);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);

        osc.connect(filter);
        filter.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.7);
        break;
      }

      case 'kick': {
        // Низький глухий удар закриття гермодверей бункера
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(38, now + 0.28);

        masterGain.gain.setValueAtTime(effectiveVol * 0.55, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.32);
        break;
      }

      case 'door-close': {
        // Важкий низькочастотний гул сервоприводів та рейок при повільному розгоні бронестулок (~1.45с)
        const osc = ctx.createOscillator();
        const sub = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(54 * rate, now);
        osc.frequency.linearRampToValueAtTime(96 * rate, now + 0.95);
        osc.frequency.linearRampToValueAtTime(60 * rate, now + 1.4);

        sub.type = 'triangle';
        sub.frequency.setValueAtTime(34 * rate, now);
        sub.frequency.linearRampToValueAtTime(50 * rate, now + 1.35);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(160, now);
        filter.frequency.linearRampToValueAtTime(380, now + 1.05);

        masterGain.gain.setValueAtTime(0.001, now);
        masterGain.gain.linearRampToValueAtTime(effectiveVol * 0.45, now + 0.18);
        masterGain.gain.setValueAtTime(effectiveVol * 0.45, now + 1.15);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.42);

        osc.connect(filter);
        sub.connect(filter);
        filter.connect(masterGain);

        osc.start(now);
        sub.start(now);
        osc.stop(now + 1.45);
        sub.stop(now + 1.45);
        break;
      }

      case 'door-slam': {
        // Масивний удар зіткнення багатотонних стулок + металевий резонанс (~0.42с)
        const subOsc = ctx.createOscillator();
        const clangOsc = ctx.createOscillator();
        const clangGain = ctx.createGain();

        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(175 * rate, now);
        subOsc.frequency.exponentialRampToValueAtTime(28 * rate, now + 0.36);

        clangOsc.type = 'triangle';
        clangOsc.frequency.setValueAtTime(320 * rate, now);
        clangOsc.frequency.exponentialRampToValueAtTime(95 * rate, now + 0.18);

        masterGain.gain.setValueAtTime(effectiveVol * 0.72, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        clangGain.gain.setValueAtTime(effectiveVol * 0.38, now);
        clangGain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

        subOsc.connect(masterGain);
        clangOsc.connect(clangGain);
        clangGain.connect(ctx.destination);

        subOsc.start(now);
        clangOsc.start(now);
        subOsc.stop(now + 0.42);
        clangOsc.stop(now + 0.2);
        break;
      }

      case 'door-hydraulic': {
        // Подвійне клацання ригелів + пневматичне шипіння пари (декомпресія ~0.46с)
        [0, 0.11].forEach((offset, idx) => {
          const boltOsc = ctx.createOscillator();
          const boltGain = ctx.createGain();
          boltOsc.type = 'triangle';
          const baseFreq = idx === 0 ? 440 : 560;
          boltOsc.frequency.setValueAtTime(baseFreq * rate, now + offset);
          boltOsc.frequency.exponentialRampToValueAtTime(170 * rate, now + offset + 0.065);

          boltGain.gain.setValueAtTime(effectiveVol * 0.42, now + offset);
          boltGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.07);

          boltOsc.connect(boltGain);
          boltGain.connect(ctx.destination);
          boltOsc.start(now + offset);
          boltOsc.stop(now + offset + 0.075);
        });

        // Генерація короткого шумового імпульсу пневматики
        const bufferSize = Math.floor(ctx.sampleRate * 0.32);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const bpFilter = ctx.createBiquadFilter();
        bpFilter.type = 'bandpass';
        bpFilter.frequency.setValueAtTime(1900, now + 0.14);
        bpFilter.frequency.exponentialRampToValueAtTime(650, now + 0.44);
        bpFilter.Q.setValueAtTime(2.2, now + 0.14);

        const hissGain = ctx.createGain();
        hissGain.gain.setValueAtTime(0.001, now + 0.14);
        hissGain.gain.linearRampToValueAtTime(effectiveVol * 0.28, now + 0.18);
        hissGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        noise.connect(bpFilter);
        bpFilter.connect(hissGain);
        hissGain.connect(ctx.destination);
        noise.start(now + 0.14);
        noise.stop(now + 0.46);
        break;
      }

      case 'door-open': {
        // Розблокування замка + величний гідравлічний відкат стулок (~1.35с)
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(48 * rate, now);
        osc.frequency.exponentialRampToValueAtTime(116 * rate, now + 0.98);
        osc.frequency.linearRampToValueAtTime(70 * rate, now + 1.32);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(200, now);
        filter.frequency.linearRampToValueAtTime(460, now + 0.85);
        filter.frequency.linearRampToValueAtTime(140, now + 1.32);

        masterGain.gain.setValueAtTime(0.001, now);
        masterGain.gain.linearRampToValueAtTime(effectiveVol * 0.42, now + 0.1);
        masterGain.gain.setValueAtTime(effectiveVol * 0.38, now + 0.95);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 1.34);

        osc.connect(filter);
        filter.connect(masterGain);
        osc.start(now);
        osc.stop(now + 1.36);
        break;
      }

      default: {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600 * rate, now);
        masterGain.gain.setValueAtTime(effectiveVol * 0.3, now);
        masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(masterGain);
        osc.start(now);
        osc.stop(now + 0.055);
      }
    }
  }

  _toggleAmbientDrone(effectiveVol) {
    if (this._ambientDroneNodes) {
      this._stopAmbientDrone();
      return;
    }

    const ctx = this._getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gainNode = ctx.createGain();

    // Глибокий низькочастотний гул вентиляції бункера
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(55, now); // A1
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(82.41, now); // E2

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, now);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(effectiveVol * 0.25, now + 0.6);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);

    this._ambientDroneNodes = { osc1, osc2, filter, gainNode };
    this._notifyListeners();
  }

  _stopAmbientDrone() {
    if (!this._ambientDroneNodes) return;
    const { osc1, osc2, gainNode } = this._ambientDroneNodes;
    this._ambientDroneNodes = null;
    try {
      if (this._audioCtx) {
        const now = this._audioCtx.currentTime;
        gainNode.gain.setTargetAtTime(0.0001, now, 0.08);
        setTimeout(() => {
          try {
            osc1.stop();
            osc2.stop();
            osc1.disconnect();
            osc2.disconnect();
          } catch (_) {}
        }, 250);
      }
    } catch (_) {}
    this._notifyListeners();
  }

  // ===========================================================================
  // Браузерні життєві цикли (Autoplay Unlock, Visibility, Делеговані UI-хуки)
  // ===========================================================================

  _setupUnlockListeners() {
    const unlock = () => {
      if (this._audioCtx && this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }
      if (window.Howler && window.Howler.ctx && window.Howler.ctx.state === 'suspended') {
        window.Howler.ctx.resume().catch(() => {});
      }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  _setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this._ambientDroneNodes) {
          this._wasAmbientPlayingBeforeHide = true;
          this._stopAmbientDrone();
        }
        const ambientHowl = this._howls.get(SOUND_IDS.BUNKER_AMBIENT);
        if (ambientHowl && ambientHowl.playing()) {
          this._wasAmbientPlayingBeforeHide = true;
          ambientHowl.pause();
        }
      } else if (this._wasAmbientPlayingBeforeHide) {
        this._wasAmbientPlayingBeforeHide = false;
        const ambientHowl = this._howls.get(SOUND_IDS.BUNKER_AMBIENT);
        if (ambientHowl && !this._missingFiles.has(SOUND_IDS.BUNKER_AMBIENT)) {
          ambientHowl.play();
        } else if (!this._settings.muted) {
          const effVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
          if (effVol > 0.001) {
            this._toggleAmbientDrone(effVol);
          }
        }
      }
    });
  }

  /**
   * Глобальні делеговані слухачі для типових UI-взаємодій (зокрема наведення на замки `.char-lock`).
   * Завдяки делегуванню на `document`, працює на будь-яких динамічно перемальованих картках без витоків пам'яті.
   */
  _setupGlobalUIHooks() {
    let lastHoveredLock = null;

    document.addEventListener(
      'pointerover',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        const lockEl = e.target.closest?.('.char-lock');
        if (lockEl && lockEl !== lastHoveredLock) {
          lastHoveredLock = lockEl;
          this.play(SOUND_IDS.LOCK_HOVER);
        } else if (!lockEl) {
          lastHoveredLock = null;
        }
      },
      { passive: true }
    );
  }
}

export const soundManager = new SoundManager();

if (typeof window !== 'undefined') {
  window.soundManager = soundManager;
  window.SOUND_IDS = SOUND_IDS;
}

export {
  AUDIO_CHANNELS,
  DEFAULT_AUDIO_SETTINGS,
  SOUND_CATALOG,
  SOUND_IDS,
};

