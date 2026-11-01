/**
 * Централізований менеджер аудіо (SoundManager) на базі Howler.js
 * із підтримкою каналів гучності (Master, SFX, UI, Music),
 * точкового калібрування кожного звуку (baseVolume),
 * захисту від какофонії (throttleMs, interrupt, maxInstances, pitchShift)
 * та синтезованого Web Audio фоллбеку (AudioSynth) на випадок відсутності аудіофайлів.
 */

import {
  AUDIO_CHANNELS,
  DEFAULT_AUDIO_SETTINGS,
  SOUND_CATALOG,
  SOUND_IDS,
  getSoundConfig,
} from '../constants/sounds.js';
import { AudioSynth } from './audio-synth.js';

const STORAGE_KEY_SETTINGS = 'bunker-audio-settings';

class SoundManager {
  constructor() {
    this._settings = { ...DEFAULT_AUDIO_SETTINGS };
    this._howls = new Map(); // Кеш інстансів Howl: soundId -> Howl
    this._lastPlayedAt = new Map(); // Час останнього відтворення (ms): soundId -> timestamp
    this._activeInstances = new Map(); // Активні ID звуків: soundId -> Set<number>
    this._missingFiles = new Set(); // Звуки, чиї файли ще не додані на диск (фоллбек на синт)
    // I-3: збій завантаження не блокує файл назавжди: запис протухає через _missingRetryMs, скидається подією 'online',
    // а після _missingMaxAttempts невдач файл вважається справді відсутнім
    this._missingAttempts = new Map(); // soundId -> кількість невдалих завантажень поспіль
    this._missingSince = new Map(); // soundId -> Date.now() останнього збою
    this._missingRetryMs = 30000;
    this._missingMaxAttempts = 3;
    this._ambientWanted = false; // гра хоче грати атмосферу (startAmbient): відновлюється після роз-mute / підняття гучності
    this._silentLoad = new Set(); // Звуки, що вантажаться наперед (preload): помилка завантаження не має грати синтез-фоллбек при старті
    this._listeners = new Set(); // Підписники на зміну налаштувань гучності
    this._audioCtx = null; // Web Audio API контекст для синтезованого фоллбеку
    this._ambientDroneNodes = null; // Активні вузли синтезованого ембієнту
    this._wasAmbientPlayingBeforeHide = false;
    this._wasDroneBeforeHide = false;
    this._ambientFadeTimeout = null; // Таймаут згасання при згортанні вкладки
    this._initialized = false;
    this._globalClicksDisabled = false;
    this._domCleanups = []; // функції зняття глобальних слухачів (для destroy())

    this._loadFromStorage();
    // Також працює на окремій сторінці тесту виживання, де init() не викликається.
    if (typeof window !== 'undefined') {
      this._listen(window, 'online', () => this._retryMissing()); // I-3: мережа повернулась -> пробуємо завантажити файли знову
      this._listen(window, 'storage', (event) => {
        if (event.key !== STORAGE_KEY_SETTINGS && event.key !== null) return;
        this._loadFromStorage();
        this._applyGlobalHowlerState();
        this._refreshAllActiveVolumes();
        this._notifyListeners();
      });
    }
  }

  // Реєструє слухача і запам'ятовує, як його зняти: без цього обробники жили б вічно (тести, скидання середовища)
  _listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._domCleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /**
   * Знімає усі глобальні слухачі подій (storage, visibilitychange, розблокування, глобальні UI-хуки) і зупиняє звук.
   * Після destroy() можна знову викликати init().
   */
  destroy() {
    this._domCleanups.splice(0).forEach(cleanup => {
      try { cleanup(); } catch (_) {}
    });
    clearTimeout(this._ambientFadeTimeout);
    this._ambientFadeTimeout = null;
    this.stopAll();
    this._initialized = false;
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
    this._preloadCatalog();
  }

  /**
   * Створює Howl наперед для всіх звуків з preload: true, щоб файл був уже завантажений і декодований до першого play().
   * Без цього Howl створювався б лише в момент першого відтворення, і прапорець preload нічого не давав.
   */
  _preloadCatalog() {
    if (typeof window === 'undefined' || !window.Howl) return;
    for (const config of Object.values(SOUND_CATALOG)) {
      if (!config.preload || config.loop) continue;
      this._silentLoad.add(config.id);
      this._getOrCreateHowl(config);
    }
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
          backgroundAmbient: Boolean(parsed.backgroundAmbient ?? DEFAULT_AUDIO_SETTINGS.backgroundAmbient),
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

  setBackgroundAmbient(enabled) {
    this._settings.backgroundAmbient = Boolean(enabled);
    this._saveSettings();
    this._notifyListeners();
  }

  isBackgroundAmbientEnabled() {
    return Boolean(this._settings.backgroundAmbient);
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
    if (AudioSynth.isAmbientPlaying()) {
      const targetVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
      AudioSynth.setAmbientVolume(targetVol, 50);
    }
  }

  _refreshActiveVolumes(soundId) {
    const howl = this._howls.get(soundId);
    if (howl) {
      const effectiveVol = this.getEffectiveVolume(soundId);
      howl.volume(effectiveVol);
    }
    if (soundId === SOUND_IDS.BUNKER_AMBIENT && AudioSynth.isAmbientPlaying()) {
      const targetVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
      AudioSynth.setAmbientVolume(targetVol, 50);
    }
  }

  _refreshAllActiveVolumes() {
    for (const soundId of Object.keys(SOUND_CATALOG)) {
      this._refreshActiveVolumes(soundId);
    }
    this._resumeAmbientIfWanted();
  }

  // play() мовчки виходить при mute або нульовій гучності, тому атмосферу, яку гра вже просила, запускаємо ще раз, коли звук з'явився
  _resumeAmbientIfWanted() {
    if (!this._ambientWanted || this._settings.muted) return;
    if (this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT) <= 0.001) return;
    if (AudioSynth.isAmbientPlaying()) return;
    const howl = this._howls.get(SOUND_IDS.BUNKER_AMBIENT);
    if (howl && (howl.playing() || howl.state() === 'loading')) return;
    this.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
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

    if (soundId === SOUND_IDS.BUNKER_AMBIENT) {
      this._ambientWanted = true;
    }

    // 4. Якщо файл раніше не знайдено на диску або Howler недоступний — граємо синтезований фоллбек
    if (this._isMissing(soundId) || typeof window === 'undefined' || !window.Howl) {
      this._playSynthFallback(config, effectiveVol, rate, options.loop);
      return null;
    }

    // 5. Відтворення через Howler.js
    const howl = this._getOrCreateHowl(config);
    if (!howl) {
      this._playSynthFallback(config, effectiveVol, rate, options.loop);
      return null;
    }

    // Обмеження одночасних інстансів (interrupt / maxInstances).
    // Незавантаженому Howl stop()/volume() не викликаємо: вони стали б у чергу очікування завантаження перед play() і могли її збити.
    const isLoaded = howl.state() === 'loaded';
    const activeSet = this._activeInstances.get(soundId);
    if (!isLoaded) {
      // перший запуск: скасовувати нічого
    } else if (config.interrupt) {
      howl.stop();
      activeSet?.clear();
    } else if (config.maxInstances && activeSet && activeSet.size >= config.maxInstances) {
      const oldestId = activeSet.values().next().value;
      if (oldestId !== undefined) {
        howl.stop(oldestId);
        activeSet.delete(oldestId);
      }
    }

    if (isLoaded) howl.volume(effectiveVol);
    const instanceId = howl.play();
    if (!isLoaded && instanceId !== null && instanceId !== undefined) howl.volume(effectiveVol, instanceId);
    if (rate !== 1) {
      howl.rate(rate, instanceId);
    }
    if (options.loop !== undefined && instanceId !== null && instanceId !== undefined) {
      howl.loop(Boolean(options.loop), instanceId);
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
    this._stopCustomFade(soundId); // I-2: інакше інтервал фейду далі мутує гучність зупиненого звуку
    const howl = this._howls.get(soundId);
    if (howl) {
      howl.stop();
    }
    this._activeInstances.get(soundId)?.clear();
    AudioSynth.stop(soundId);

    if (soundId === SOUND_IDS.BUNKER_AMBIENT) {
      this._ambientWanted = false;
      this._stopAmbientDrone();
    }
  }

  /**
   * Зупиняє всі активні звуки.
   */
  stopAll() {
    this._ambientWanted = false;
    if (this._customFadeIntervals) { // I-2: гасимо всі активні фейди
      for (const id of this._customFadeIntervals.values()) clearInterval(id);
      this._customFadeIntervals.clear();
    }
    if (typeof window !== 'undefined' && window.Howler) {
      window.Howler.stop();
    }
    for (const set of this._activeInstances.values()) {
      set.clear();
    }
    AudioSynth.stopAll();
    this._stopAmbientDrone();
  }

  /**
   * Запускає атмосферу бункера (зациклену). Ідемпотентно: повторний виклик нічого не дублює, тому можна кликати при кожному оновленні кімнати.
   * Якщо звук зараз вимкнено (mute / нульова гучність), атмосфера стартує, коли він з'явиться.
   */
  startAmbient() {
    if (this._ambientWanted) return;
    this._ambientWanted = true;
    this.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
  }

  stopAmbient() {
    if (!this._ambientWanted) return;
    this._ambientWanted = false;
    this.stop(SOUND_IDS.BUNKER_AMBIENT);
  }

  /**
   * Перевіряє, чи відтворюється зараз вказаний звук (зокрема ембієнт).
   */
  isPlaying(soundId) {
    if (soundId === SOUND_IDS.BUNKER_AMBIENT) {
      if (AudioSynth.isAmbientPlaying() || this._ambientDroneNodes) {
        return true;
      }
      const howl = this._howls.get(soundId);
      if (howl && howl.playing()) return true;
      // Якщо ембієнт запущений, але Howl ще вантажить аудіофайл (html5 audio стрімінг):
      return Boolean(this._ambientWanted);
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
      html5: Boolean(config.html5),
      preload: Boolean(config.preload),
      volume: this.getEffectiveVolume(config.id),
      onload: () => {
        this._missingAttempts.delete(config.id); // I-3: успішне завантаження скидає лічильник збоїв
        this._silentLoad.delete(config.id);
      },
      onend: (id) => {
        activeSet.delete(id);
      },
      // _ambientWanted змінюють лише явні startAmbient()/stopAmbient()/stop()/stopAll(): Howler шле onstop асинхронно
      // і після власного howl.stop() усередині play() (interrupt), тож скидання тут блокувало б відновлення після unmute
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
        const wasSilent = this._silentLoad.delete(config.id); // помилка передзавантаження при старті не повинна грати звук
        if (!this._missingFiles.has(config.id)) {
          this._markMissing(config.id);
          const effVol = this.getEffectiveVolume(config.id);
          if (!wasSilent && effVol > 0.001) {
            this._playSynthFallback(config, effVol, 1, config.loop);
          }
        }
      },
    });

    this._howls.set(config.id, howl);
    return howl;
  }

  // ===========================================================================
  // Процедурний Web Audio API Синтезатор (Делегування до AudioSynth)
  // ===========================================================================

  // I-3: облік звуків, чий файл не вдалося завантажити (перехід на синтез-фоллбек з можливістю повтору)
  _markMissing(soundId) {
    this._missingFiles.add(soundId);
    this._missingAttempts.set(soundId, (this._missingAttempts.get(soundId) || 0) + 1);
    this._missingSince.set(soundId, Date.now());
  }

  _clearMissing(soundId) {
    this._missingFiles.delete(soundId);
    this._missingSince.delete(soundId);
    // Невдалий Howl лишається в стані 'unloaded' назавжди: прибираємо його, щоб наступний play() створив свіжий
    const stale = this._howls.get(soundId);
    this._howls.delete(soundId);
    this._activeInstances.get(soundId)?.clear();
    try { stale?.unload?.(); } catch (_) {}
  }

  /** true, якщо файл звуку вважається відсутнім; протухлий запис (вікно повтору минуло) знімається і дозволяє нову спробу. */
  _isMissing(soundId) {
    if (!this._missingFiles.has(soundId)) return false;
    if ((this._missingAttempts.get(soundId) || 0) >= this._missingMaxAttempts) return true;
    const since = this._missingSince.get(soundId) || 0;
    if (Date.now() - since >= this._missingRetryMs) {
      this._clearMissing(soundId);
      return false;
    }
    return true;
  }

  /** Мережа повернулась: даємо ще одну спробу всім звукам, що не вичерпали ліміт збоїв. */
  _retryMissing() {
    for (const soundId of [...this._missingFiles]) {
      if ((this._missingAttempts.get(soundId) || 0) < this._missingMaxAttempts) {
        this._clearMissing(soundId);
      }
    }
  }

  _getAudioContext() {
    const ctx = AudioSynth.getContext();
    this._audioCtx = ctx;
    return ctx;
  }

  _playSynthFallback(config, effectiveVol, rate = 1, loop = undefined) {
    const type = config.synthType || 'click';
    if (type === 'drone' || config.id === SOUND_IDS.BUNKER_AMBIENT) {
      this._startAmbientDrone(effectiveVol);
      return;
    }

    AudioSynth.play(config.id || type, {
      volume: effectiveVol,
      rate,
      loop: loop !== undefined ? Boolean(loop) : Boolean(config.loop),
    });
  }

  // Ідемпотентний старт: якщо дрон уже грає, лише оновлюємо гучність. Раніше це був toggle, і повторний play() вимикав звук
  _startAmbientDrone(effectiveVol, rampDuration = 0.6) {
    if (AudioSynth.isAmbientPlaying()) {
      AudioSynth.setAmbientVolume(effectiveVol, rampDuration * 1000);
      return;
    }

    AudioSynth.startAmbient({ volume: effectiveVol, rampDuration });
    if (AudioSynth.isAmbientPlaying()) {
      this._ambientDroneNodes = { active: true };
      this._notifyListeners();
    }
  }

  _stopAmbientDrone() {
    if (!AudioSynth.isAmbientPlaying() && !this._ambientDroneNodes) return;
    this._ambientDroneNodes = null;
    AudioSynth.stopAmbient(0.25);
    this._notifyListeners();
  }

  // ===========================================================================
  // Браузерні життєві цикли (Autoplay Unlock, Visibility, Делеговані UI-хуки)
  // ===========================================================================

  _setupUnlockListeners() {
    const unlock = () => {
      AudioSynth.unlock();
      if (this._audioCtx && this._audioCtx.state === 'suspended') {
        this._audioCtx.resume().catch(() => {});
      }
      if (window.Howler && window.Howler.ctx && window.Howler.ctx.state === 'suspended') {
        window.Howler.ctx.resume().catch(() => {});
      }
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('click', unlock, true);
    };

    this._listen(window, 'pointerdown', unlock, true);
    this._listen(window, 'keydown', unlock, true);
    this._listen(window, 'click', unlock, true);
  }

  /**
   * Власний плавний фейд гучності для звуку (працює надійно і для Web Audio, і для HTML5 Audio без багів Howler черги).
   * @param {string} soundId
   * @param {number} fromVol
   * @param {number} toVol
   * @param {number} durationMs
   * @param {Function} [onComplete]
   */
  _fadeAudio(soundId, fromVol, toVol, durationMs = 350, onComplete) {
    const howl = this._howls.get(soundId);
    if (!howl) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // Скасовуємо будь-який активний інтервал фейду для цього звуку
    if (this._customFadeIntervals && this._customFadeIntervals.has(soundId)) {
      clearInterval(this._customFadeIntervals.get(soundId));
      this._customFadeIntervals.delete(soundId);
    }
    if (!this._customFadeIntervals) {
      this._customFadeIntervals = new Map();
    }

    const startTime = performance.now();
    const initialVol = toVol > fromVol && fromVol === 0 ? Math.min(toVol, Math.max(0.02, toVol * 0.1)) : fromVol;
    howl.volume(initialVol);

    const intervalId = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const current = fromVol + (toVol - fromVol) * progress;

      howl.volume(current);

      if (progress >= 1) {
        clearInterval(intervalId);
        if (this._customFadeIntervals) this._customFadeIntervals.delete(soundId);
        howl.volume(toVol);
        if (typeof onComplete === 'function') onComplete();
      }
    }, 25);

    this._customFadeIntervals.set(soundId, intervalId);
  }

  _stopCustomFade(soundId) {
    if (this._customFadeIntervals && this._customFadeIntervals.has(soundId)) {
      clearInterval(this._customFadeIntervals.get(soundId));
      this._customFadeIntervals.delete(soundId);
    }
  }

  _setupVisibilityListener() {
    const FADE_DURATION_MS = 350;

    this._listen(document, 'visibilitychange', () => {
      if (this._settings.backgroundAmbient) return;

      if (document.hidden) {
        this._stopCustomFade(SOUND_IDS.BUNKER_AMBIENT);
        if (this._ambientFadeTimeout) {
          clearTimeout(this._ambientFadeTimeout);
          this._ambientFadeTimeout = null;
        }

        const isDrone = Boolean(AudioSynth.isAmbientPlaying() || this._ambientDroneNodes);
        const ambientHowl = this._howls.get(SOUND_IDS.BUNKER_AMBIENT);
        const isHowl = Boolean(ambientHowl && ambientHowl.playing());

        if (isDrone || isHowl || this._ambientWanted) {
          this._wasAmbientPlayingBeforeHide = true;
          this._wasDroneBeforeHide = isDrone;
        }

        if (isDrone) {
          AudioSynth.setAmbientVolume(0.0001, FADE_DURATION_MS);
          this._ambientFadeTimeout = setTimeout(() => {
            this._ambientFadeTimeout = null;
            if (document.hidden && !this._settings.backgroundAmbient) {
              this._stopAmbientDrone();
            }
          }, FADE_DURATION_MS);
        }

        if (isHowl) {
          // Плавно затухаємо до 0, і лише після досягнення 0 ставимо на паузу
          const startVol = ambientHowl.volume();
          this._fadeAudio(SOUND_IDS.BUNKER_AMBIENT, startVol, 0, FADE_DURATION_MS, () => {
            if (document.hidden && !this._settings.backgroundAmbient) {
              ambientHowl.pause();
            }
          });
        }
      } else {
        this._stopCustomFade(SOUND_IDS.BUNKER_AMBIENT);
        if (this._ambientFadeTimeout) {
          clearTimeout(this._ambientFadeTimeout);
          this._ambientFadeTimeout = null;
        }

        const shouldResume = this._wasAmbientPlayingBeforeHide || this._ambientWanted;
        const wasDrone = this._wasDroneBeforeHide;
        this._wasAmbientPlayingBeforeHide = false;
        this._wasDroneBeforeHide = false;

        if (!shouldResume || this._settings.muted) return;

        const effVol = this.getEffectiveVolume(SOUND_IDS.BUNKER_AMBIENT);
        if (effVol <= 0.001) return;

        const ambientHowl = this._howls.get(SOUND_IDS.BUNKER_AMBIENT);
        if (ambientHowl && !this._isMissing(SOUND_IDS.BUNKER_AMBIENT) && !wasDrone) {
          if (Array.isArray(ambientHowl._queue)) {
            ambientHowl._queue = [];
          }

          const currentVol = ambientHowl.playing() ? ambientHowl.volume() : 0;
          if (!ambientHowl.playing()) {
            ambientHowl.volume(0);
            ambientHowl.play();
          }
          // Плавно нарощуємо гучність від поточної до повної
          this._fadeAudio(SOUND_IDS.BUNKER_AMBIENT, currentVol, effVol, FADE_DURATION_MS);
        } else if (AudioSynth.isAmbientPlaying() || this._ambientDroneNodes) {
          AudioSynth.setAmbientVolume(effVol, FADE_DURATION_MS);
        } else if (shouldResume) {
          this._startAmbientDrone(effVol, FADE_DURATION_MS / 1000);
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

    this._listen(
      document,
      'pointerover',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        const lockEl = e.target.closest?.('.char-lock');
        if (lockEl && lockEl !== lastHoveredLock) {
          lastHoveredLock = lockEl;
          // Якщо замок зараз очікує підтвердження (.is-confirming) або діалог підтвердження відкритий — не брязкати повторно
          if (!lockEl.classList.contains('is-confirming') && !document.getElementById('custom-confirm-root')) {
            this.play(SOUND_IDS.LOCK_HOVER);
          }
        } else if (!lockEl) {
          lastHoveredLock = null;
        }
      },
      { passive: true }
    );

    const CLICKABLE_SELECTOR = [
      'button',
      'a[href]',
      'a.header-nav-link',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="switch"]',
    ].join(', ');
    const NO_CLICK_SOUND_SELECTOR = [
      '.char-lock',
      '[data-test-sound]',
      '[data-no-click-sound]',
      'input[type="range"]',
      '.bunker-slider',
      '[disabled]',
      '[aria-disabled="true"]',
    ].join(', ');

    this._listen(
      document,
      'click',
      (e) => {
        if (this._globalClicksDisabled) return;
        if (typeof document !== 'undefined' && (document.body?.dataset.noClickSound !== undefined || document.body?.classList.contains('no-click-sound'))) return;
        const el = e.target;
        if (!(el instanceof Element)) return;
        if (el.closest(NO_CLICK_SOUND_SELECTOR)) return;

        let clickable = el.closest(CLICKABLE_SELECTOR);
        if (!clickable) {
          try {
            if (window.getComputedStyle(el).cursor === 'pointer') clickable = el;
          } catch (_) {}
        }
        if (!clickable) return;

        this.play(SOUND_IDS.UI_CLICK);
      },
      true
    );
  }

  /**
   * Тимчасово вимикає автоматичне відтворення звуку UI-кліку на всіх клікабельних елементах
   * (корисно для сторінок налаштувань, аудіо-лабораторії та інженерного дебагінгу).
   */
  disableGlobalClicks() {
    this._globalClicksDisabled = true;
  }

  /**
   * Вмикає назад автоматичне відтворення звуку UI-кліку.
   */
  enableGlobalClicks() {
    this._globalClicksDisabled = false;
  }

  /**
   * Чи увімкнені глобальні UI-кліки.
   * @returns {boolean}
   */
  isGlobalClicksEnabled() {
    return !this._globalClicksDisabled;
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
