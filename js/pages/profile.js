import { getCachedUserHistory, fetchUserGameHistory, checkRoomExists, fetchRoomDataForExport } from '../services/game-history-service.js';
import { exportGameReplay, readReplayFile, launchOfflineReplay } from '../services/replay-service.js';
import { showGlobalToast } from '../game-modules/overlays/global-toast.js';
import { supabase } from '../services/supabase.js';
import { THEMES, getCurrentTheme, setTheme, onThemeChange } from '../utils/theme-manager.js';
import { fetchAvatars, getCachedAvatar, hasCachedAvatar, isAvatarStale, uploadAvatar, removeAvatar, onAvatarChange } from '../services/avatar-service.js';
import { setAvatarEl, applyAvatarLetterPadding } from '../utils/avatar.js';
import { openAvatarCropper } from '../ui/avatar-cropper-modal.js';
import { esc } from '../utils/security.js';
import { soundManager, AUDIO_CHANNELS, SOUND_IDS } from '../services/sound-manager.js';
import { initRangeSliders, setRangeSliderValue } from '../ui/range-slider.js';
import { ICONS } from '../constants/icons.js';

export function renderProfile() {
    const settings = soundManager.getSettings();

    const masterPct = Math.round(settings.masterVolume * 100);
    const sfxPct = Math.round(settings.sfxVolume * 100);
    const uiPct = Math.round(settings.uiVolume * 100);
    const musicPct = Math.round(settings.musicVolume * 100);
    const isMuted = Boolean(settings.muted);
    const isBackgroundAmbient = Boolean(settings.backgroundAmbient);
    const isAmbientPlaying = soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT);
    const themeCardsHtml = THEMES.map(t => `
      <label class="theme-card" for="theme-radio-${esc(t.value)}">
        <input
          type="radio"
          name="bunker-theme"
          id="theme-radio-${esc(t.value)}"
          value="${esc(t.value)}"
          class="theme-radio-input"
        >
        <div class="theme-card-body">
          <div class="theme-card-info">
            <span class="theme-card-name">${esc(t.name || t.label)}</span>
            ${t.tag ? `<span class="theme-card-tag">${esc(t.tag)}</span>` : ''}
          </div>
          <div class="theme-palette-swatch" aria-hidden="true">
            ${(t.palette || []).map(c => `<span class="theme-dot" style="background-color: ${esc(c)};"></span>`).join('')}
          </div>
        </div>
        <span class="theme-card-check" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </span>
      </label>
    `).join('');

    return `
    <section class="block layout-small-centered profile-block">
      <div class="block-head">
        <h2>Мій профіль</h2>
      </div>
      <nav class="profile-tabs" role="tablist" aria-label="Розділи профілю">
        <button type="button" role="tab" class="profile-tab" id="profile-tab-profile" data-tab="profile" aria-controls="profile-panel-profile">Профіль</button>
        <button type="button" role="tab" class="profile-tab" id="profile-tab-themes" data-tab="themes" aria-controls="profile-panel-themes">Теми</button>
        <button type="button" role="tab" class="profile-tab" id="profile-tab-audio" data-tab="audio" aria-controls="profile-panel-audio">Звук</button>
        <button type="button" role="tab" class="profile-tab" id="profile-tab-history" data-tab="history" aria-controls="profile-panel-history">Історія ігор</button>
      </nav>
      <div class="block-body">
      <div class="profile-panel" id="profile-panel-profile" role="tabpanel" aria-labelledby="profile-tab-profile">
        <div class="profile-identity-layout">
          <div class="profile-avatar-row">
            <!-- Велика аватарка = кнопка: при наведенні з'являється рамка з олівцем, клік відкриває вибір файла -->
            <button type="button" id="avatar-change-btn" class="profile-avatar-edit" aria-label="Змінити аватарку" title="Змінити аватарку">
              <span id="profile-page-avatar" class="profile-avatar">?</span>
              <span class="profile-avatar-overlay" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </span>
            </button>
            <div class="profile-avatar-actions">
              <button type="button" id="avatar-remove-btn" class="avatar-action avatar-action--danger" style="display: none;">Видалити</button>
              <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden>
            </div>
            <div>
              <p style="margin: 0; font-size: 13px; color: var(--text-mute);">Ім'я гравця</p>
              <p id="profile-page-name" style="margin: 0; font-size: 18px; font-weight: 600; color: var(--text);">Завантаження...</p>
              <p id="avatar-status" role="status" aria-live="polite" style="margin: 6px 0 0; font-size: 12px; min-height: 16px; color: var(--text-mute);"></p>
            </div>
          </div>


          <div class="profile-quick-stats">
            <div class="stat-grid">
              <div class="stat-tile" title="Зіграно ігор"><span class="stat-tile__label">Зіграно</span><span class="stat-tile__value" data-stat="games_played">—</span></div>
              <div class="stat-tile" title="Кількість перемог"><span class="stat-tile__label">Перемог</span><span class="stat-tile__value" data-stat="games_won">—</span></div>
              <div class="stat-tile" title="Відсоток перемог"><span class="stat-tile__label">% перемог</span><span class="stat-tile__value" data-stat="win_rate">—</span></div>
              <div class="stat-tile" title="Дата реєстрації"><span class="stat-tile__label">Реєстрація</span><span class="stat-tile__value" data-stat="created_at" id="profile-created-at">—</span></div>
            </div>
          </div>
        </div>

        <hr style="width: 100%; border: none; border-top: 1px solid var(--metal-lt); margin: 0;">
        
        <button id="profile-logout-btn" class="menu-btn menu-btn--danger">
          Вийти з акаунта
        </button>
      </div>

      <div class="profile-panel" id="profile-panel-themes" role="tabpanel" aria-labelledby="profile-tab-themes" hidden>
        <div class="profile-tab-header">
          <span class="profile-tab-title">Тема оформлення інтерфейсу</span>
        </div>
        <fieldset class="theme-picker-group">
          <div class="theme-picker-grid" role="radiogroup" aria-label="Вибір теми інтерфейсу">
            ${themeCardsHtml}
          </div>
        </fieldset>
      </div>

      <div class="profile-panel" id="profile-panel-audio" role="tabpanel" aria-labelledby="profile-tab-audio" hidden>
        <div class="profile-tab-header history-toolbar">
          <span class="profile-tab-title">Мікшер гучності</span>
          <div class="history-toolbar__actions">
            <button
              type="button"
              class="bunker-mute-btn ${isMuted ? 'is-muted' : ''}"
              id="profile-audio-mute-btn"
              aria-label="${isMuted ? 'Увімкнути звук' : 'Вимкнути звук'}"
              title="${isMuted ? 'Звук вимкнено (клік — увімкнути)' : 'Вимкнути весь звук'}"
            >
              <img class="bunker-mute-btn__icon bunker-mute-btn__icon--on" src="${esc(ICONS.VOLUME_ON)}" alt="" aria-hidden="true">
              <img class="bunker-mute-btn__icon bunker-mute-btn__icon--off" src="${esc(ICONS.VOLUME_OFF)}" alt="" aria-hidden="true">
            </button>
          </div>
        </div>

        <div class="audio-mixer-list ${isMuted ? 'is-muted' : ''}" id="profile-audio-mixer-list">
          <!-- Master -->
          <div class="audio-mixer-card audio-mixer-card--master">
            <div class="audio-mixer-card__top">
              <div class="audio-mixer-card__head">
                <span class="audio-mixer-card__icon" aria-hidden="true">
                  <img src="${esc(ICONS.VOLUME_ON)}" alt="">
                </span>
                <div class="audio-mixer-card__info">
                  <span class="audio-mixer-card__title">Загальна гучність</span>
                  <span class="audio-mixer-card__sub">Головний рівень усієї аудіосистеми</span>
                </div>
              </div>
              <div class="audio-mixer-card__actions">
                <span class="audio-mixer-card__val" id="audio-val-master">${isMuted ? 'MUTE' : `${masterPct}%`}</span>
              </div>
            </div>
            <input
              type="range"
              class="bunker-slider"
              id="audio-slider-master"
              data-channel="${AUDIO_CHANNELS.MASTER}"
              min="0"
              max="100"
              step="1"
              value="${masterPct}"
              aria-label="Загальна гучність"
            >
          </div>

          <!-- SFX -->
          <div class="audio-mixer-card">
            <div class="audio-mixer-card__top">
              <div class="audio-mixer-card__head">
                <span class="audio-mixer-card__icon" aria-hidden="true">
                  <img src="${esc(ICONS.AUDIO_SFX)}" alt="">
                </span>
                <div class="audio-mixer-card__info">
                  <span class="audio-mixer-card__title">Ігрові ефекти</span>
                  <span class="audio-mixer-card__sub">Рулетки, кубик, розкриття карток, таймер і сирени</span>
                </div>
              </div>
              <div class="audio-mixer-card__actions">
                <span class="audio-mixer-card__val" id="audio-val-sfx">${sfxPct}%</span>
                <button
                  type="button"
                  class="audio-test-icon-btn"
                  data-test-sound="${SOUND_IDS.DICE_ROLL}"
                  title="Прослухати кидок кубика"
                  aria-label="Прослухати ігровий ефект"
                >
                  <img src="${esc(ICONS.AUDIO_PLAY)}" alt="">
                </button>
              </div>
            </div>
            <input
              type="range"
              class="bunker-slider"
              id="audio-slider-sfx"
              data-channel="${AUDIO_CHANNELS.SFX}"
              min="0"
              max="100"
              step="1"
              value="${sfxPct}"
              aria-label="Гучність ігрових ефектів"
            >
          </div>

          <!-- UI -->
          <div class="audio-mixer-card">
            <div class="audio-mixer-card__top">
              <div class="audio-mixer-card__head">
                <span class="audio-mixer-card__icon" aria-hidden="true">
                  <img src="${esc(ICONS.AUDIO_UI)}" alt="">
                </span>
                <div class="audio-mixer-card__info">
                  <span class="audio-mixer-card__title">Інтерфейс</span>
                  <span class="audio-mixer-card__sub">Наведення на замки, кнопки та перемикачі</span>
                </div>
              </div>
              <div class="audio-mixer-card__actions">
                <span class="audio-mixer-card__val" id="audio-val-ui">${uiPct}%</span>
                <button
                  type="button"
                  class="audio-test-icon-btn"
                  data-test-sound="${SOUND_IDS.UI_CLICK}"
                  title="Прослухати клік кнопки"
                  aria-label="Прослухати звук інтерфейсу"
                >
                  <img src="${esc(ICONS.AUDIO_PLAY)}" alt="">
                </button>
              </div>
            </div>
            <input
              type="range"
              class="bunker-slider"
              id="audio-slider-ui"
              data-channel="${AUDIO_CHANNELS.UI}"
              min="0"
              max="100"
              step="1"
              value="${uiPct}"
              aria-label="Гучність звуків інтерфейсу"
            >
          </div>

          <!-- Music / Ambient -->
          <div class="audio-mixer-card">
            <div class="audio-mixer-card__top">
              <div class="audio-mixer-card__head">
                <span class="audio-mixer-card__icon" aria-hidden="true">
                  <img src="${esc(ICONS.AUDIO_MUSIC)}" alt="">
                </span>
                <div class="audio-mixer-card__info">
                  <span class="audio-mixer-card__title">Атмосфера та музика</span>
                  <span class="audio-mixer-card__sub">Фоновий гул вентиляції та ембієнт бункера</span>
                </div>
              </div>
              <div class="audio-mixer-card__actions">
                <span class="audio-mixer-card__val" id="audio-val-music">${musicPct}%</span>
                <button
                  type="button"
                  class="audio-test-icon-btn ${isAmbientPlaying ? 'is-playing' : ''}"
                  id="profile-audio-ambient-btn"
                  data-test-sound="${SOUND_IDS.BUNKER_AMBIENT}"
                  title="${isAmbientPlaying ? 'Зупинити ембієнт (автозупинка через 15 с)' : 'Прослухати атмосферу бункера'}"
                  aria-label="Перевірити фоновий ембієнт"
                >
                  <img class="audio-test-icon-btn__play" src="${esc(ICONS.AUDIO_PLAY)}" alt="">
                  <img class="audio-test-icon-btn__stop" src="${esc(ICONS.AUDIO_STOP)}" alt="">
                </button>
              </div>
            </div>
            <input
              type="range"
              class="bunker-slider"
              id="audio-slider-music"
              data-channel="${AUDIO_CHANNELS.MUSIC}"
              min="0"
              max="100"
              step="1"
              value="${musicPct}"
              aria-label="Гучність фонової музики"
            >
          </div>

          <!-- Перемикач атмосфери у фоні -->
          <div class="audio-option-card">
            <label class="audio-option-label" for="profile-audio-bg-ambient">
              <span class="audio-option-text">
                <span class="audio-option-title">Грати атмосферу бункера у фоні</span>
                <span class="audio-option-sub">Не ставити ембієнт на паузу при переході на іншу вкладку чи згортанні браузера</span>
              </span>
              <input
                type="checkbox"
                class="audio-toggle-checkbox"
                id="profile-audio-bg-ambient"
                ${isBackgroundAmbient ? 'checked' : ''}
              >
              <span class="audio-toggle-track" aria-hidden="true">
                <span class="audio-toggle-thumb"></span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div class="profile-panel" id="profile-panel-history" role="tabpanel" aria-labelledby="profile-tab-history" hidden>
        <div class="profile-tab-header history-toolbar">
          <span class="profile-tab-title">Збережені партії</span>
          <div class="history-toolbar__actions">
            <input type="file" id="history-file-input" accept=".bunker" hidden>
            <button type="button" class="history-toolbar__btn" id="history-open-file-btn" title="Завантажити та переглянути локальний файл гри">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>Відкрити .bunker</span>
            </button>
          </div>
        </div>
        <div id="profile-history-content">
          <div class="profile-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
            <p class="profile-empty__title">Ігор поки немає</p>
            <p class="profile-empty__text">Тут з'явиться список ваших останніх 5 завершених ігор.</p>
          </div>
        </div>
      </div>
      </div>
    </section>
  `;
}

// ===== Вкладки профілю =====
// Активна вкладка запам'ятовується на час вкладки браузера (sessionStorage), а не в URL: зміна hash перемалювала би
// всю сторінку через роутер і скидала би стан.
const TAB_STORAGE_KEY = 'bunker-profile-tab';
const TAB_NAMES = ['profile', 'themes', 'audio', 'history'];


const STATS_STORAGE_PREFIX = 'bunker_user_stats:';

function getCachedStats(userId) {
  if (!userId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STATS_STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveCachedStats(userId, stats) {
  if (!userId || !stats || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${STATS_STORAGE_PREFIX}${userId}`, JSON.stringify(stats));
  } catch (_) {}
}

let currentTabSelector = null;
let unsubscribeProfileAudio = null;
let unsubscribeProfileTheme = null;
const AMBIENT_PREVIEW_DURATION_MS = 15000;
let ambientPreviewTimer = null;

function setAmbientBtnState(isPlaying) {
  const ambientBtn = document.getElementById('profile-audio-ambient-btn');
  if (!ambientBtn) return;
  ambientBtn.classList.toggle('is-playing', isPlaying);
  ambientBtn.title = isPlaying
    ? 'Зупинити ембієнт (автозупинка через 15 с)'
    : 'Прослухати атмосферу бункера';
  ambientBtn.setAttribute('aria-label', isPlaying ? 'Зупинити ембієнт' : 'Перевірити фоновий ембієнт');
}

export function stopAmbientPreview() {
  if (ambientPreviewTimer) {
    clearTimeout(ambientPreviewTimer);
    ambientPreviewTimer = null;
  }
  if (soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT)) {
    soundManager.stop(SOUND_IDS.BUNKER_AMBIENT);
  }
  setAmbientBtnState(false);
}

export function selectProfileTab(name = 'profile', focus = false) {
  if (typeof currentTabSelector === 'function') {
    currentTabSelector(name, focus);
  }
}

export function cleanupProfile() {
  currentTabSelector = null;
  stopAmbientPreview();
  if (typeof unsubscribeProfileAudio === 'function') {
    unsubscribeProfileAudio();
    unsubscribeProfileAudio = null;
  }
  if (typeof unsubscribeProfileTheme === 'function') {
    unsubscribeProfileTheme();
    unsubscribeProfileTheme = null;
  }
}

let historyLoaded = false;

function formatProfTitle(val) {
  if (!val) return 'Невідома професія';
  if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(p => {
          const title = p?.title || p?.value || 'Невідома';
          return p?.stage ? `${title} (${p.stage})` : title;
        }).join(', ');
      } else if (typeof parsed === 'object' && parsed !== null) {
        const title = parsed?.title || parsed?.value || 'Невідома';
        return parsed?.stage ? `${title} (${parsed.stage})` : title;
      }
    } catch (_) {}
  }
  return val;
}

function renderHistoryCards(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="profile-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        <p class="profile-empty__title">Ігор поки немає</p>
        <p class="profile-empty__text">Тут з'явиться список ваших останніх 5 завершених ігор.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="history-list">
      ${items.map(item => {
        const survived = !!item.survived;
        const statusBadge = survived
          ? '<span class="history-badge is-survived">ВИЖИВ</span>'
          : '<span class="history-badge is-kicked">ВИГНАНИЙ</span>';
        const cardClass = survived ? 'is-survived' : 'is-kicked';
        const dateObj = new Date(item.played_at);
        const dateFormatted = !isNaN(dateObj.getTime())
          ? `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()}`
          : '';
        const cataclysm = item.cataclysm_title || 'Катаклізм';
        const prof = formatProfTitle(item.profession_title);
        const code = (item.room_code || '').toUpperCase();

        return `
          <div class="history-card ${cardClass}" data-room="${esc(code)}">
            <div class="history-card__meta">
              <div class="history-card__tags">
                ${statusBadge}
                <span class="history-card__code">КОД: ${esc(code)}</span>
              </div>
              <span class="history-card__date">${esc(dateFormatted)}</span>
            </div>
            <div class="history-card__main">
              <div class="history-card__info">
                <h4 class="history-card__cataclysm">${esc(cataclysm)}</h4>
                <p class="history-card__prof">Професія: <strong>${esc(prof)}</strong></p>
              </div>
              <div class="history-card__actions">
                <button type="button" class="history-btn history-btn--primary" data-action="view-game" data-room="${esc(code)}">
                  <span>Переглянути</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button type="button" class="history-btn history-btn--secondary" data-action="export-game" data-room="${esc(code)}" title="Зберегти локальний файл реплею (.bunker)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Зберегти</span>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

async function loadHistoryTab(userId) {
  if (!userId) return;
  const container = document.getElementById('profile-history-content');
  if (!container) return;

  const cached = getCachedUserHistory(userId);
  if (cached && cached.length > 0) {
    renderHistoryCards(container, cached);
  }

  const items = await fetchUserGameHistory(userId);
  historyLoaded = true;
  renderHistoryCards(container, items);
}

function bindHistoryEvents(container) {
  const fileInput = document.getElementById('history-file-input');
  const openBtn = document.getElementById('history-open-file-btn');

  if (openBtn && fileInput) {
    openBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const roomData = await readReplayFile(file);
        launchOfflineReplay(roomData);
      } catch (err) {
        showGlobalToast(err.message || 'Помилка відкриття файлу реплею');
      }
    });
  }

  container.addEventListener('click', async (e) => {
    const viewBtn = e.target.closest('[data-action="view-game"]');
    if (viewBtn) {
      const roomCode = viewBtn.dataset.room;
      viewBtn.disabled = true;
      const origText = viewBtn.textContent;
      viewBtn.textContent = 'Перевірка...';
      const exists = await checkRoomExists(roomCode);
      if (exists) {
        window.location.hash = `#/game?room=${roomCode}`;
      } else {
        viewBtn.disabled = true;
        viewBtn.textContent = 'Заархівовано';
        showGlobalToast('Кімнату вже видалено з бази або заархівовано');
      }
      return;
    }

    const exportBtn = e.target.closest('[data-action="export-game"]');
    if (exportBtn) {
      const roomCode = exportBtn.dataset.room;
      exportBtn.disabled = true;
      const origHtml = exportBtn.innerHTML;
      exportBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        <span>Завантаження...</span>
      `;
      try {
        const roomData = await fetchRoomDataForExport(roomCode);
        if (!roomData) throw new Error('Кімнату вже видалено з бази даних');
        exportGameReplay(roomData);
        exportBtn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Збережено</span>
        `;
        setTimeout(() => {
          exportBtn.disabled = false;
          exportBtn.innerHTML = origHtml;
        }, 2000);
      } catch (err) {
        showGlobalToast(err.message || 'Не вдалося експортувати гру');
        exportBtn.disabled = false;
        exportBtn.innerHTML = origHtml;
      }
      return;
    }
  });
}

function bindAudioEvents() {
  const panel = document.getElementById('profile-panel-audio');
  if (!panel) return;

  const muteBtn = document.getElementById('profile-audio-mute-btn');
  const ambientBtn = document.getElementById('profile-audio-ambient-btn');
  const mixerList = document.getElementById('profile-audio-mixer-list');
  const bgAmbientToggle = document.getElementById('profile-audio-bg-ambient');
  const channelSliders = panel.querySelectorAll('.bunker-slider[data-channel]');

  initRangeSliders(panel);

  // Перемикач відтворення атмосфери у фоні
  if (bgAmbientToggle) {
    bgAmbientToggle.addEventListener('change', () => {
      soundManager.setBackgroundAmbient(bgAmbientToggle.checked);
    });
  }

  // Повзунки головних каналів (Master, SFX, UI, Music)
  channelSliders.forEach(slider => {
    slider.addEventListener('input', () => {
      const ch = slider.dataset.channel;
      const pct = Number(slider.value) || 0;
      soundManager.setChannelVolume(ch, pct / 100);
    });
  });

  // SVG-кнопка Mute у профілі
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      soundManager.toggleMute();
    });
  }

  // Делегування кліків на кнопки прослуховування каналів
  panel.addEventListener('click', (e) => {
    const testBtn = e.target.closest('[data-test-sound]');
    if (!testBtn) return;
    const soundId = testBtn.dataset.testSound;
    if (!soundId) return;

    // Якщо звук вимкнено (Mute), автоматично розм'ючуємо при натисканні "Тест"
    if (soundManager.isMuted()) {
      soundManager.setMuted(false);
    }

    if (soundId === SOUND_IDS.BUNKER_AMBIENT) {
      if (ambientPreviewTimer || soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT)) {
        stopAmbientPreview();
      } else {
        soundManager.play(SOUND_IDS.BUNKER_AMBIENT, { bypassThrottle: true });
        setAmbientBtnState(true);

        ambientPreviewTimer = setTimeout(() => {
          stopAmbientPreview();
        }, AMBIENT_PREVIEW_DURATION_MS);
      }
      return;
    }

    soundManager.play(soundId, { bypassThrottle: true });
  });

  // Синхронізація стану UI, якщо гучність змінено через хедер або інший компонент
  if (typeof unsubscribeProfileAudio === 'function') {
    unsubscribeProfileAudio();
    unsubscribeProfileAudio = null;
  }
  if (typeof unsubscribeProfileTheme === 'function') {
    unsubscribeProfileTheme();
    unsubscribeProfileTheme = null;
  }
  unsubscribeProfileAudio = soundManager.subscribe((settings) => {
    const masterPct = Math.round(settings.masterVolume * 100);
    const sfxPct = Math.round(settings.sfxVolume * 100);
    const uiPct = Math.round(settings.uiVolume * 100);
    const musicPct = Math.round(settings.musicVolume * 100);
    const isMuted = Boolean(settings.muted);

    if (mixerList) {
      mixerList.classList.toggle('is-muted', isMuted);
    }

    const setChannelUI = (id, pct, isMaster = false) => {
      const slider = document.getElementById(`audio-slider-${id}`);
      const valEl = document.getElementById(`audio-val-${id}`);
      if (slider) setRangeSliderValue(slider, pct);
      if (valEl) valEl.textContent = isMaster && isMuted ? 'MUTE' : `${pct}%`;
    };

    setChannelUI('master', masterPct, true);
    setChannelUI('sfx', sfxPct);
    setChannelUI('ui', uiPct);
    setChannelUI('music', musicPct);

    if (muteBtn) {
      muteBtn.classList.toggle('is-muted', isMuted);
      muteBtn.setAttribute('aria-label', isMuted ? 'Увімкнути звук' : 'Вимкнути звук');
      muteBtn.title = isMuted ? 'Звук вимкнено (клік — увімкнути)' : 'Вимкнути весь звук';
    }

    if (ambientBtn) {
      const playing = Boolean(ambientPreviewTimer || soundManager.isPlaying(SOUND_IDS.BUNKER_AMBIENT));
      setAmbientBtnState(playing);
    }

    if (bgAmbientToggle) {
      bgAmbientToggle.checked = Boolean(settings.backgroundAmbient);
    }
  });
}

function setupProfileTabs(userId = null) {
    const tabs = [...document.querySelectorAll('.profile-tab')];
    if (!tabs.length) return;

    const select = (name, focus = false) => {
        if (name !== 'audio') {
            stopAmbientPreview();
        }
        tabs.forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1; // стрілками перемикаємо, Tab переходить у вміст панелі
            const panel = document.getElementById(tab.getAttribute('aria-controls'));
            if (panel) panel.hidden = !active;
            if (active && focus) tab.focus();
        });
        if (name === 'history' && userId) {
            loadHistoryTab(userId);
        }
        try {
            sessionStorage.setItem(TAB_STORAGE_KEY, name);
        } catch (e) { /* sessionStorage недоступний — просто не запам'ятовуємо вкладку */ }
    };

    currentTabSelector = select;

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab.dataset.tab));
        tab.addEventListener('keydown', (e) => {
            let target = null;
            if (e.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
            else if (e.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') target = tabs[0];
            else if (e.key === 'End') target = tabs[tabs.length - 1];
            if (!target) return;
            e.preventDefault();
            select(target.dataset.tab, true);
        });
    });

    let initial = 'profile';
    try {
        let saved = sessionStorage.getItem(TAB_STORAGE_KEY);
        if (saved === 'stats') saved = 'themes';
        if (TAB_NAMES.includes(saved)) initial = saved;
    } catch (e) { /* лишаємося на «Профілі» */ }
    select(initial);
}

export async function initProfile() {
    // Вкладки працюють одразу, без очікування сесії та запитів до БД
    // setupProfileTabs буде ініціалізовано з userId нижче

    const nameEl = document.getElementById('profile-page-name');
    const avatarEl = document.getElementById('profile-page-avatar');
    const logoutBtn = document.getElementById('profile-logout-btn');
    const themeCards = document.querySelectorAll('.theme-card');
    const themeRadios = document.querySelectorAll('input[name="bunker-theme"]');

    function updateSelectedCard(selectedVal) {
        themeCards.forEach(card => {
            const input = card.querySelector('input[name="bunker-theme"]');
            const isMatch = input && input.value === selectedVal;
            if (input) input.checked = isMatch;
            card.classList.toggle('theme-card--selected', isMatch);
        });
    }

    // Тему та звук можна перемкнути незалежно від сесії (хоча на цю сторінку і так не пускає неавторизованих —
    // перевірка нижче), тож ініціалізуємо одразу, до await supabase.auth.getSession()
    updateSelectedCard(getCurrentTheme());
    if (typeof unsubscribeProfileTheme === 'function') {
        unsubscribeProfileTheme();
    }
    unsubscribeProfileTheme = onThemeChange((newTheme) => {
        updateSelectedCard(newTheme);
    });
    bindAudioEvents();

    themeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                updateSelectedCard(radio.value);
                setTheme(radio.value);
            }
        });
    });

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.hash = '#/login';
        return;
    }

    const username = session.user?.user_metadata?.username || 'Гравець';
    nameEl.textContent = username;

    const firstLetter = username.charAt(0);
    const userId = session.user.id;

    // ===== Аватарка: ініціалізуємо і малюємо ОДРАЗУ, до будь-яких мережевих запитів =====
    const fileInput = document.getElementById('avatar-file-input');
    const changeBtn = document.getElementById('avatar-change-btn');
    const removeBtn = document.getElementById('avatar-remove-btn');
    const avatarStatus = document.getElementById('avatar-status');
    const headerAvatarEl = document.getElementById('header-user-avatar');

    let currentPaintedUrl = undefined;
    const paintAvatar = (url) => {
        if (currentPaintedUrl === url) return;
        currentPaintedUrl = url;
        setAvatarEl(avatarEl, firstLetter, url);
        setAvatarEl(headerAvatarEl, firstLetter, url);
        if (removeBtn) removeBtn.style.display = url ? '' : 'none';
    };
    const setAvatarStatus = (text, isError = false) => {
        avatarStatus.textContent = text;
        avatarStatus.style.color = isError ? 'var(--danger)' : 'var(--text-mute)';
    };
    const setAvatarBusy = (busy) => {
        changeBtn.disabled = busy;
        removeBtn.disabled = busy;
    };

    applyAvatarLetterPadding(avatarEl, firstLetter, 9); // Зсув більший під велику аватарку (96px)

    // 1. Малюємо аватарку одразу зі збереженого локального кешу (миттєво, 0 мс)
    paintAvatar(getCachedAvatar(userId));

    // 2. Якщо в кеші взагалі ще немає аватарки — підтягуємо (без force: true, оскільки активна Realtime-підписка)
    if (!hasCachedAvatar(userId)) {
        fetchAvatars([userId]);
    }

    // 3. Будь-які зміни (з Realtime або фонового запиту) оновлюють аватарку на екрані
    onAvatarChange((newUrl, changedUserId) => {
        if (changedUserId === userId) {
            paintAvatar(newUrl);
        }
    });

    historyLoaded = false;
    setupProfileTabs(userId);
    const historyContainer = document.getElementById('profile-history-content');
    if (historyContainer) bindHistoryEvents(historyContainer);

    const createdAtEl = document.getElementById('profile-created-at') || document.querySelector('[data-stat="created_at"]');
    const playedEl = document.querySelector('[data-stat="games_played"]');
    const wonEl = document.querySelector('[data-stat="games_won"]');
    const winRateEl = document.querySelector('[data-stat="win_rate"]');

    const renderStatsValues = (stats) => {
        if (!stats) return;
        const played = Number(stats.games_played) || 0;
        const won = Number(stats.games_won) || 0;
        if (playedEl) playedEl.textContent = played;
        if (wonEl) wonEl.textContent = won;
        if (winRateEl) {
            const rate = played > 0 ? Math.round((won / played) * 100) : 0;
            winRateEl.textContent = `${rate}%`;
        }
        const createdAt = stats.created_at || session.user?.created_at;
        if (createdAt && createdAtEl) {
            const d = new Date(createdAt);
            if (!isNaN(d.getTime())) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                const formatted = `${day}.${month}.${year}`;
                createdAtEl.textContent = formatted;
                createdAtEl.title = `Дата реєстрації: ${formatted}`;
            }
        }
    };

    // 1. Миттєво відображаємо з локального кешу (0 мс, без миготіння та очікування 0.5с)
    const initialCached = getCachedStats(userId);
    if (initialCached) {
        renderStatsValues(initialCached);
    } else if (session.user?.created_at) {
        renderStatsValues({ games_played: 0, games_won: 0, created_at: session.user.created_at });
    }

    // 2. Фонове оновлення з Supabase (Stale-While-Revalidate)
    try {
        let userStats = null;
        try {
            const { data, error } = await supabase
                .from('users')
                .select('created_at, games_played, games_won, avatar_url')
                .eq('id', userId)
                .maybeSingle();
            if (!error && data) {
                userStats = data;
            } else if (error) {
                // Якщо на games_played ще немає прав (403), довантажуємо хоча б created_at
                const { data: basic } = await supabase.from('users').select('created_at').eq('id', userId).maybeSingle();
                userStats = basic;
            }
        } catch (fetchErr) {
            const { data: basic } = await supabase.from('users').select('created_at').eq('id', userId).maybeSingle();
            userStats = basic;
        }

        if (userStats) {
            renderStatsValues(userStats);
            saveCachedStats(userId, userStats);
            if (userStats.avatar_url !== undefined) {
                paintAvatar(userStats.avatar_url);
            }
        }
    } catch (err) {
        console.warn('Не вдалося завантажити статистику користувача:', err);
    }



    changeBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = ''; // щоб повторний вибір того самого файла теж спрацював
        if (!file) return;

        let croppedBlob = null;
        try {
            croppedBlob = await openAvatarCropper(file);
        } catch (err) {
            setAvatarStatus(err.message || 'Не вдалося відкрити редактор фото', true);
            return;
        }

        // Якщо користувач скасував або закрив модалку без підтвердження
        if (!croppedBlob) {
            return;
        }

        setAvatarBusy(true);
        setAvatarStatus('Завантаження...');
        try {
            const url = await uploadAvatar(userId, croppedBlob);
            paintAvatar(url);
            setAvatarStatus('Аватарку оновлено');
        } catch (err) {
            setAvatarStatus(err.message || 'Не вдалося змінити аватарку', true);
        } finally {
            setAvatarBusy(false);
        }
    });

    removeBtn.addEventListener('click', async () => {
        setAvatarBusy(true);
        setAvatarStatus('');
        try {
            await removeAvatar(userId);
            paintAvatar(null);
            setAvatarStatus('Аватарку видалено');
        } catch (err) {
            setAvatarStatus(err.message || 'Не вдалося видалити аватарку', true);
        } finally {
            setAvatarBusy(false);
        }
    });

    logoutBtn.addEventListener('mouseover', () => logoutBtn.style.filter = 'brightness(1.1)');
    logoutBtn.addEventListener('mouseout', () => logoutBtn.style.filter = 'none');

    logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'Вихід...';
        try {
            await supabase.auth.signOut();
            window.location.hash = '#/login';
        } catch (err) {
            console.error('Помилка виходу:', err);
            logoutBtn.disabled = false;
            logoutBtn.textContent = 'Вийти з акаунта';
        }
    });
}
