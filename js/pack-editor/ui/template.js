import { esc } from '../../utils/common/escape-html.js';
import { CATACLYSM_LIMITS, STAGE_KEYS } from '../payload.js';
import { TITLE_MAX, DESC_MAX, STAGE_FIELDS, RANGE_FIELDS, CATACLYSM_LIST_PLACEHOLDER } from './helpers.js';

const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';

const STAGE_DEL_BTN_HTML = `
  <button type="button" class="pe-stage-del" tabindex="-1" title="Видалити стадію" aria-label="Видалити стадію">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>`;

export function stageRowHtml(key, entry) {
  const isTime = ['profession', 'hobby'].includes(key);
  const isAge = ['age_categories', 'gender'].includes(key);
  const name = typeof entry === 'object' ? entry.name : entry;
  const isNew = !name;
  const newClass = isNew ? ' pe-stage-row--new' : '';

  if (isTime) {
    const total = entry?.up_to_months || 0;
    const y = Math.floor(total / 12);
    const m = total % 12;
    return `
      <div class="pe-stage-row pe-stage-row--card${newClass}">
        <div class="pe-stage-handle pe-stage-handle--card" title="Перетягніть для зміни порядку" aria-label="Перетягнути"></div>
        <input type="text" class="pe-input pe-stage-name" value="${esc(name || '')}" placeholder="${isNew ? 'Нова стадія...' : 'Назва'}">
        <div class="pe-stage-time-group">
          <div class="pe-stage-time-row pe-stage-from-wrap">
            <span class="pe-stage-text">від</span>
            <div class="pe-time-field is-disabled">
              <input type="number" class="pe-time-val" data-type="min-y" value="0" disabled inputmode="numeric">
              <span class="pe-time-unit">р</span>
              <input type="number" class="pe-time-val" data-type="min-m" value="0" disabled inputmode="numeric">
              <span class="pe-time-unit">м</span>
            </div>
          </div>
          <div class="pe-stage-time-row pe-stage-to-wrap">
            <span class="pe-stage-text pe-stage-to-text">до</span>
            <div class="pe-time-field">
              <input type="number" class="pe-time-val" data-type="y" value="${y}" min="0" inputmode="numeric">
              <span class="pe-time-unit">р</span>
              <input type="number" class="pe-time-val" data-type="m" value="${m}" min="0" max="11" inputmode="numeric">
              <span class="pe-time-unit">м</span>
            </div>
            <span class="pe-stage-text pe-stage-more-text" style="display:none;">і більше</span>
          </div>
        </div>
        ${STAGE_DEL_BTN_HTML}
      </div>
    `;
  }

  if (isAge) {
    const y = entry?.up_to_age !== undefined && entry.up_to_age !== null
      ? entry.up_to_age
      : (entry?.up_to_months !== undefined && entry.up_to_months !== null ? Math.floor(entry.up_to_months / 12) : 0);
    return `
      <div class="pe-stage-row pe-stage-row--card${newClass}">
        <div class="pe-stage-handle pe-stage-handle--card" title="Перетягніть для зміни порядку" aria-label="Перетягнути"></div>
        <input type="text" class="pe-input pe-stage-name" value="${esc(name || '')}" placeholder="${isNew ? 'Нова стадія...' : 'Назва'}">
        <div class="pe-stage-time-group">
          <div class="pe-stage-time-row pe-stage-from-wrap">
            <span class="pe-stage-text">від</span>
            <div class="pe-time-field is-disabled">
              <input type="number" class="pe-time-val" data-type="min-y" value="0" disabled inputmode="numeric">
              <span class="pe-time-unit">р</span>
            </div>
          </div>
          <div class="pe-stage-time-row pe-stage-to-wrap">
            <span class="pe-stage-text pe-stage-to-text">до</span>
            <div class="pe-time-field">
              <input type="number" class="pe-time-val" data-type="y" value="${y}" min="0" inputmode="numeric">
              <span class="pe-time-unit">р</span>
            </div>
            <span class="pe-stage-text pe-stage-more-text" style="display:none;">і більше</span>
          </div>
        </div>
        ${STAGE_DEL_BTN_HTML}
      </div>
    `;
  }

  return `
    <div class="pe-stage-row pe-stage-row--simple${newClass}">
      <span class="pe-stage-handle pe-stage-handle--simple" title="Перетягніть для зміни порядку" aria-label="Перетягнути">⋮⋮</span>
      <input type="text" class="pe-input pe-stage-name" value="${esc(name || '')}" placeholder="${isNew ? 'Нове значення...' : 'Назва'}">
      ${STAGE_DEL_BTN_HTML}
    </div>
  `;
}

function stageFieldsHtml() {
  return STAGE_FIELDS.map(({ key, label }, idx) => `
    <div class="pe-stage-group${idx === 0 ? ' is-active-mobile' : ''}" data-stage-group="${key}">
      <div class="pe-stage-group-head">
        <label class="pe-label">${esc(label)}</label>
        <button type="button" class="pk-btn pk-btn--ghost pe-stage-copy-btn" data-stage-copy="${key}" title="Скопіювати промпт для LLM" aria-label="Скопіювати промпт для LLM">
          <svg class="pe-stage-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
      <div class="pe-stage-list pe-input" data-stage-list="${key}"></div>
      <textarea class="pe-input pe-stage-textarea" data-stage-ta="${key}" placeholder="Введіть стадії..." hidden></textarea>
      <p class="pe-stage-note">Порожній рядок унизу призначений для додавання нового запису</p>
    </div>`).join('');
}

function rangesFieldsHtml() {
  return RANGE_FIELDS.map(({ key, label, min, max }) => `
    <div class="pe-field">
      <label class="pe-label" for="pe-range-${key}">${esc(label)}</label>
      <div class="pe-stepper">
        <button type="button" class="pe-stepper__btn pe-stepper__btn--minus" data-step="down" tabindex="-1" aria-label="Зменшити">−</button>
        <input id="pe-range-${key}" class="pe-input pe-stepper__input" type="number" data-range="${key}" min="${min}" max="${max}" step="1">
        <div class="pe-stepper__controls">
          <button type="button" class="pe-stepper__btn pe-stepper__btn--up" data-step="up" tabindex="-1" aria-label="Збільшити">
            <svg class="pe-stepper__chevron" viewBox="0 0 12 8" aria-hidden="true"><polyline points="2 6 6 2 10 6"></polyline></svg>
          </button>
          <button type="button" class="pe-stepper__btn pe-stepper__btn--down" data-step="down" tabindex="-1" aria-label="Зменшити">
            <svg class="pe-stepper__chevron" viewBox="0 0 12 8" aria-hidden="true"><polyline points="2 2 6 6 10 2"></polyline></svg>
          </button>
        </div>
        <button type="button" class="pe-stepper__btn pe-stepper__btn--plus" data-step="up" tabindex="-1" aria-label="Збільшити">+</button>
      </div>
    </div>`).join('');
}

// Розмітка всієї сторінки. isEdit — редагування існуючого пака, isDefaultEdit — редагування базового пака (лише адмін)
export function packEditorTemplate({ isEdit, isDefaultEdit }) {
  let saveLabel;
  if (isDefaultEdit) saveLabel = 'Оновити базовий пак';
  else if (isEdit) saveLabel = 'Оновити особистий пак';
  else saveLabel = 'Створити особистий пак';

  // У базовому паку кнопки "Очистити все" немає: його не можна залишити порожнім (на ньому базується гра)
  const clearButton = isDefaultEdit
    ? ''
    : '<button type="button" class="pk-btn pk-btn--ghost" data-action="clear" data-tip="Повністю очистити форму та всі картки" title="Повністю очистити форму та всі картки">Очистити все</button>';

  const buttons = isEdit
    ? `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save" data-tip="Зберегти всі зміни пака в базу даних (Ctrl+Shift+S)" title="Зберегти всі зміни пака в базу даних (Ctrl+Shift+S)">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="reset" data-tip="Повернути пак до початкового стану з бази (скасувати всі незбережені зміни)" title="Повернути пак до початкового стану з бази (скасувати всі незбережені зміни)">Скасувати зміни</button>
      ${clearButton}
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit" data-tip="Закрити редактор та повернутися до списку паків без збереження змін" title="Закрити редактор та повернутися до списку паків без збереження змін">Відмінити та вийти</button>`
    : `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save" data-tip="Зберегти новий пак у базу даних (Ctrl+Shift+S)" title="Зберегти новий пак у базу даних (Ctrl+Shift+S)">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="clear" data-tip="Повністю очистити форму та всі картки" title="Повністю очистити форму та всі картки">Очистити все</button>
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit" data-tip="Закрити редактор та повернутися до списку паків" title="Закрити редактор та повернутися до списку паків">Вийти</button>`;

  // is-loading знімається, коли завантажено конфіг дефолтного пака (і сам пак у режимі редагування)
  return `
    <section id="pe-root" class="pack-editor layout-large-centered is-loading">
      <div class="block">
        <div class="block-head pe-head">
          <h2>${isEdit ? 'Редагування пака' : 'Створення пака'}</h2>
        </div>
        <dialog id="pe-draft-modal" class="pe-draft-modal" closedby="any" aria-labelledby="pe-draft-modal-title">
          <div class="pe-draft-modal__card">
            <div class="pe-draft-modal__header">
              <div class="pe-draft-modal__titles">
                <h3 id="pe-draft-modal-title" class="pe-draft-modal__title">
                  <svg class="pe-draft-modal__title-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  <span>Знайдено незбережені зміни</span>
                </h3>
                <p class="pe-draft-modal__time">Локальна чернетка від <strong id="pe-draft-modal-time"></strong></p>
              </div>
              <button type="button" class="pe-draft-modal__close" data-draft-modal-action="dismiss" aria-label="Закрити">✕</button>
            </div>
            <div class="pe-draft-modal__body">
              <p id="pe-draft-modal-desc" class="pe-draft-modal__desc"></p>
              <div id="pe-draft-modal-details" class="pe-draft-modal__details" hidden></div>
            </div>
            <div class="pe-draft-modal__actions">
              <button type="button" class="pk-btn pk-btn--primary pe-draft-modal__btn-restore" data-draft-modal-action="restore">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                  <path d="M3 21v-5h5"/>
                </svg>
                <span id="pe-draft-modal-restore-label">Відновити зміни</span>
              </button>
              <button type="button" class="pk-btn pk-btn--ghost pe-draft-modal__btn-discard" data-draft-modal-action="discard">Відхилити чернетку</button>
            </div>
          </div>
        </dialog>
        <div id="pe-draft-banner" class="pe-draft-banner" role="status" hidden></div>
        <div class="block-body pe-body">
          <div class="pe-field">
            <label class="pe-label" for="pe-title">Назва пака <span class="pe-required" title="Обов'язкове поле">*</span></label>
            <input id="pe-title" class="pe-input" type="text" maxlength="${TITLE_MAX}" autocomplete="off" placeholder="Наприклад: Постапокаліпсис">
            <p id="pe-title-error" class="pe-error" role="alert" hidden></p>
          </div>
          <div class="pe-field">
            <label class="pe-label" for="pe-desc">Опис</label>
            <textarea id="pe-desc" class="pe-input pe-desc" rows="3" maxlength="${DESC_MAX}" placeholder="Коротко про те, для якого сценарію цей пак"></textarea>
            <span id="pe-desc-counter" class="pe-counter">0/${DESC_MAX}</span>
          </div>
        </div>
      </div>

      <div class="block">
        <div class="block-head"><h2>Глобальні налаштування генерації</h2></div>
        <div class="block-body pe-body">
          <p class="pe-hint">
            Діапазони, в межах яких гра випадково визначає вік і зріст персонажів. Якщо в картці статі/раси
            вказано власний вік (наприклад, "Без віку" у Кіборга) — цей діапазон для нього ігнорується.
          </p>
          <div class="pe-stages" id="pe-ranges">${rangesFieldsHtml()}</div>
        </div>
      </div>

      <div class="block pe-char-block" data-mobile-view="categories">
        <div class="pe-char-sidebar">
          <div class="pe-char-sidebar-inner">
            <div class="pe-char-sidebar__header">
              <h3 class="pe-char-sidebar__title">Категорії та статистика</h3>
              <p id="pe-summary-total" class="pe-summary__total"></p>
            </div>
            <div id="pe-chips" class="pe-char-menu"></div>
          </div>
        </div>

        <div class="pe-char-main">
          <div class="pe-char-header">
            <div class="pe-char-breadcrumbs">Характеристики / <span id="pe-cat-breadcrumb">Стать</span></div>
            <div class="pe-char-title-row">
              <h2 class="pe-char-title" id="pe-cat-title">Стать</h2>
              <i id="pe-cat-warn" class="pe-warn" role="button" tabindex="0" aria-label="Попередження про нестачу карток" hidden></i>
            </div>
          </div>

          <div class="pe-toolbar">
            <div class="pe-toolbar__row" id="pe-toolbar-default">
              <div class="pe-field pe-search pe-toolbar__search">
                <div class="pe-search__box">
                  <svg class="pe-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                  <input id="pe-search" class="pe-input pe-search__input" type="text" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Пошук...">
                  <div class="pe-search__inside">
                    <button type="button" id="pe-search-clear" class="pe-search__clear" aria-label="Очистити пошук" title="Очистити (Esc)" hidden>×</button>
                    <label class="pe-check pe-check--inline" title="Шукати в усіх категоріях">
                      <input type="checkbox" id="pe-search-all" class="pe-check__input" aria-label="В усіх категоріях">
                      <span class="pe-check__box" aria-hidden="true"></span>
                      <span class="pe-check__text" aria-hidden="true"><span class="pe-check__full">В усіх категоріях</span><span class="pe-check__short">В усіх</span></span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="pe-toolbar__opts">
                <span id="pe-save-status" class="pe-save-status" data-status="saved" aria-live="polite">Збережено</span>
                <div class="pe-toolbar__llm-group">
                  <label class="pe-check" title="Режим LLM (робота з чистим текстом)">
                    <input type="checkbox" id="pe-llm-mode" class="pe-check__input">
                    <span class="pe-check__box" aria-hidden="true"></span>
                    <span class="pe-check__text">Режим LLM</span>
                  </label>
                  <span class="pe-llm-slot" id="pe-llm-slot">
                    <button type="button" id="pe-llm-copy" class="pk-btn pk-btn--ghost pe-llm-copy-btn" title="Скопіювати промпт для LLM" aria-label="Скопіювати промпт для LLM">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                  </span>
                </div>
              </div>
            </div>

            <div class="pe-search__meta" id="pe-search-meta-box">
              <span id="pe-search-count" aria-live="polite"></span>
            </div>
            <div id="pe-search-results" class="pe-cata-list pe-search-results" role="group" aria-label="Результати пошуку" hidden></div>
          </div>

          <div class="pe-char-columns">
            <div class="pe-char-list-col">
              <div class="pe-field">
                <textarea id="pe-cards" class="pe-input pe-cards" placeholder="${esc(TEXTAREA_PLACEHOLDER)}" spellcheck="false"></textarea>
                <div class="pe-cata-list-wrap" id="pe-cata-list-wrap" hidden>
                  <div class="pe-cata-list-header" id="pe-cata-list-header" role="toolbar" aria-label="Панель інструментів списку карток">
                    <div class="pe-history-btns pe-listbox-history" role="group" aria-label="Історія змін" title="Історія дій (Ctrl+Z / Ctrl+Y)">
                      <button type="button" id="pe-undo" class="pe-listbox-history-btn" data-history="undo" title="Відмінити (Ctrl+Z)" aria-label="Відмінити" disabled>↩</button>
                      <button type="button" id="pe-redo" class="pe-listbox-history-btn" data-history="redo" title="Повторити (Ctrl+Y)" aria-label="Повторити" disabled>↪</button>
                    </div>
                    <div class="pe-sort-wrap" id="pe-sort-wrap">
                      <button type="button" id="pe-sort-btn" class="pe-sort-btn" title="Сортування списку" aria-label="Сортування списку" aria-expanded="false" aria-haspopup="menu">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3 6h18M6 12h12m-9 6h6"/>
                        </svg>
                      </button>
                      <div id="pe-sort-menu" class="pe-sort-menu" role="menu" hidden>
                        <button type="button" class="pe-sort-menu__item is-active" role="menuitem" data-sort-dir="none">
                          <span class="pe-sort-menu__check">✓</span>
                          <span>За замовчуванням</span>
                        </button>
                        <button type="button" class="pe-sort-menu__item" role="menuitem" data-sort-dir="asc">
                          <span class="pe-sort-menu__check"></span>
                          <span>Сортувати в порядку Від "А" до "Я"</span>
                        </button>
                        <button type="button" class="pe-sort-menu__item" role="menuitem" data-sort-dir="desc">
                          <span class="pe-sort-menu__check"></span>
                          <span>Сортувати в порядку Від "Я" до "А"</span>
                        </button>
                      </div>
                    </div>
                    <button type="button" id="pe-bulk-delete-btn" class="pe-bulk-delete-btn" title="Режим вибору карток (X або Esc для виходу)" aria-label="Режим вибору карток">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                    </button>
                    <button type="button" id="pe-mobile-add-btn" class="pe-mobile-add-btn" title="Додати нову картку" aria-label="Додати нову картку">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <span>Додати</span>
                    </button>
                  </div>
                  <div id="pe-cata-list" class="pe-cata-list" role="group" aria-label="Додані картки"></div>
                  <!-- Плаваюча панель дій (Floating Pill) режиму вибору -->
                  <div class="pe-delete-toolbar pe-delete-floating-bar" id="pe-delete-toolbar" hidden>
                    <button type="button" id="pe-delete-cancel-btn" class="pe-delete-pill-btn pe-delete-pill-btn--cancel" title="Скасувати вибір (X або Esc)" aria-label="Скасувати вибір">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      <span>Скасувати</span>
                    </button>
                    <span id="pe-delete-count" class="pe-delete-toolbar__count" hidden></span>
                    <button type="button" id="pe-delete-select-all-btn" class="pe-delete-pill-btn pe-delete-pill-btn--ghost">
                      Вибрати всі
                    </button>
                    <div class="pe-delete-floating-divider" aria-hidden="true"></div>
                    <button type="button" id="pe-delete-submit-btn" class="pe-delete-pill-btn pe-delete-pill-btn--danger" disabled>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      <span>Видалити (0)</span>
                    </button>
                  </div>
                </div>
                <div class="pe-list-meta">
                  <span id="pe-lines-count" class="pe-counter">Рядків: 0</span>
                </div>
              </div>
            </div>

            <div class="pe-char-form-col">
              <div id="pe-delete-overlay" class="pe-delete-overlay" hidden>
                <div class="pe-hazard-sticker">
                  <div class="pe-hazard-sticker__icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <h4 class="pe-hazard-sticker__title">РЕЖИМ ВИБОРУ</h4>
                  <p class="pe-hazard-sticker__desc">Редагування карток заблоковано під час вибору для видалення</p>
                  <ul class="pe-hazard-sticker__steps">
                    <li>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                      <span>Клікайте по картках для вибору</span>
                    </li>
                    <li>
                      <div class="pe-hazard-sticker__keys">
                        <kbd class="pe-hazard-sticker__key">X</kbd>
                        <kbd class="pe-hazard-sticker__key">Esc</kbd>
                      </div>
                      <span>вийти з режиму вибору</span>
                    </li>
                  </ul>
                  <button type="button" id="pe-hazard-exit-btn" class="pk-btn pk-btn--ghost pe-hazard-sticker__btn">Вийти з вибору</button>
                </div>
              </div>
              <!-- Форма катаклізму -->
              <div id="pe-cata" class="pe-cata pe-side-form" hidden>
                <div class="pe-side-form__head">
                  <h3 id="pe-cata-mode" class="pe-cata__title">Новий катаклізм</h3>
                  <p class="pe-hint">Заповніть поля та натисніть "Додати".</p>
                </div>
                <div class="pe-field">
                  <label class="pe-label" for="pe-cata-name">Назва катаклізму <span class="pe-required" title="Обов'язкове поле">*</span></label>
                  <textarea id="pe-cata-name" class="pe-input pe-desc pe-input--name" rows="3" maxlength="${CATACLYSM_LIMITS.nameMax}" placeholder="Напр.: Повстання штучного інтелекту"></textarea>
                </div>
                <div class="pe-field">
                  <label class="pe-label" for="pe-cata-desc">Опис</label>
                  <textarea id="pe-cata-desc" class="pe-input pe-desc" rows="3" maxlength="${CATACLYSM_LIMITS.descMax}" placeholder="Напр.: Штучний інтелект захопив керування мережами..."></textarea>
                </div>
                <div class="pe-cata__grid">
                  <div class="pe-field">
                    <label class="pe-label" for="pe-cata-timer">Таймер (хв)</label>
                    <input id="pe-cata-timer" class="pe-input" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="Напр.: 30">
                  </div>
                  <div class="pe-field">
                    <label class="pe-label" for="pe-cata-stay">Час знаходження (міс.) <span class="pe-required" title="Обов'язкове поле">*</span></label>
                    <input id="pe-cata-stay" class="pe-input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Напр.: 6">
                  </div>
                  <div class="pe-field">
                    <label class="pe-label" for="pe-cata-pop">Популяція <span class="pe-required" title="Обов'язкове поле">*</span></label>
                    <input id="pe-cata-pop" class="pe-input" type="text" inputmode="numeric" maxlength="15" autocomplete="off" placeholder="Напр.: 5000">
                  </div>
                </div>
                <p id="pe-cata-error" class="pe-error" role="alert" hidden></p>
                <div class="pe-cata__actions">
  <button type="button" class="pk-btn pk-btn--primary" data-cata-action="submit">Додати</button>
  <button type="button" class="pk-btn pk-btn--ghost" data-cata-action="cancel" hidden>Скасувати</button>
  <button type="button" class="pk-btn pk-btn--danger" data-cata-action="delete" hidden>Видалити</button>
</div>
              </div>

              <!-- Форма для динамічних категорій -->
              <div id="pe-dynamic-form" class="pe-cata pe-side-form" hidden>
                <div class="pe-side-form__head">
                  <h3 class="pe-side-form__title">НОВА КАРТКА</h3>
                  <p class="pe-side-form__subtitle" id="pe-dyn-category-label">Створення у категорію</p>
                </div>
                <div class="pe-field" id="pe-dyn-name-wrap">
                  <label class="pe-label" for="pe-dyn-name">Назва <span class="pe-required" title="Обов'язкове поле">*</span></label>
                  <input id="pe-dyn-name" class="pe-input" type="text" autocomplete="off" placeholder="Введіть назву">
                </div>
                <div id="pe-dyn-fields" class="pe-dyn-fields"></div>
                <p id="pe-dyn-error" class="pe-error" role="alert" hidden></p>
                <div class="pe-cata__actions">
  <button type="button" class="pk-btn pk-btn--primary" data-dyn-action="submit">Додати</button>
  <button type="button" class="pk-btn pk-btn--ghost" data-dyn-action="cancel" hidden>Скасувати</button>
  <button type="button" class="pk-btn pk-btn--danger" data-dyn-action="delete" hidden>Видалити</button>
</div>
              </div>
            </div>
          </div>
        </div>
        <!-- Мобільна плаваюча кнопка повернення (FAB) -->
        <button type="button" class="pe-fab-back" id="pe-fab-back" title="Повернутися до списку категорій" aria-label="Повернутися до списку категорій">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          <span id="pe-fab-back-text">Категорії</span>
        </button>
      </div>

      <div class="block">
        <div class="block-head pe-stages-head">
          <h2>Стадії</h2>
          <label class="pe-check" title="Режим LLM (робота з чистим текстом)">
            <input type="checkbox" id="pe-stages-llm" class="pe-check__input">
            <span class="pe-check__box" aria-hidden="true"></span>
            <span class="pe-check__text">Режим LLM</span>
          </label>
        </div>
        <div class="block-body pe-body">
          <p class="pe-hint">
            Стадії діють на весь пак: для кожної професії, хобі та хвороби гра випадково обирає одне зі значень.
            Одне значення — один рядок.
          </p>
          <div class="pe-stages-nav" id="pe-stages-nav" role="tablist" aria-label="Вибір стадії для мобільних">
            ${STAGE_FIELDS.map(({ key, shortLabel, label }, idx) => `
              <button type="button" class="pe-stages-nav-btn${idx === 0 ? ' is-active' : ''}" data-stage-tab="${key}" role="tab" aria-selected="${idx === 0 ? 'true' : 'false'}" title="${esc(label)}">
                ${esc(shortLabel || label)}
              </button>
            `).join('')}
          </div>
          <div class="pe-stages" id="pe-stages">${stageFieldsHtml()}</div>
        </div>
      </div>

      <div class="block pe-actions-block">
        <div class="block-body pe-actions" id="pe-actions">${buttons}</div>
      </div>
    </section>
  `;
}

