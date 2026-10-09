import { esc } from '../../utils/escape-html.js';
import { CATACLYSM_LIMITS, STAGE_KEYS } from '../payload.js';
import { TITLE_MAX, DESC_MAX, STAGE_FIELDS, CATACLYSM_LIST_PLACEHOLDER } from './helpers.js';

const TEXTAREA_PLACEHOLDER = 'Введіть характеристики стовпчиком. Кожна нова характеристика — з нового рядка (клавіша Enter)';

function stageFieldsHtml() {
  const stagesHtml = STAGE_FIELDS.map(({ key, label }) => `
    <div class="pe-field">
      <label class="pe-label" for="pe-stage-${key}">${esc(label)}</label>
      <textarea id="pe-stage-${key}" class="pe-input pe-stage" data-stage="${key}" rows="6" spellcheck="false" placeholder="Одна стадія/варіант на рядок"></textarea>
    </div>`).join('');
    
  return stagesHtml;
}

function rangesFieldsHtml() {
  const ageHtml = `
    <div class="pe-field">
      <label class="pe-label" for="pe-range-ageMin">Мін. вік</label>
      <input id="pe-range-ageMin" class="pe-input" type="number" data-range="ageMin" min="1" max="120" step="1">
    </div>
    <div class="pe-field">
      <label class="pe-label" for="pe-range-ageMax">Макс. вік</label>
      <input id="pe-range-ageMax" class="pe-input" type="number" data-range="ageMax" min="1" max="120" step="1">
    </div>
  `;
  const heightHtml = `
    <div class="pe-field">
      <label class="pe-label" for="pe-range-heightMin">Мін. зріст</label>
      <input id="pe-range-heightMin" class="pe-input" type="number" data-range="heightMin" min="50" max="300" step="1">
    </div>
    <div class="pe-field">
      <label class="pe-label" for="pe-range-heightMax">Макс. зріст</label>
      <input id="pe-range-heightMax" class="pe-input" type="number" data-range="heightMax" min="50" max="300" step="1">
    </div>
  `;
  return ageHtml + heightHtml;
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
    : '<button type="button" class="pk-btn pk-btn--ghost" data-action="clear">Очистити все</button>';

  const buttons = isEdit
    ? `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="reset">Скасувати зміни</button>
      ${clearButton}
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit">Відмінити та вийти</button>`
    : `
      <button type="button" class="pk-btn pk-btn--primary" data-action="save">${saveLabel}</button>
      <button type="button" class="pk-btn pk-btn--ghost" data-action="clear">Очистити все</button>
      <button type="button" class="pk-btn pk-btn--danger" data-action="exit">Вийти</button>`;

  // is-loading знімається, коли завантажено конфіг дефолтного пака (і сам пак у режимі редагування)
  return `
    <section id="pe-root" class="pack-editor layout-large-centered is-loading">
      <div class="block">
        <div class="block-head"><h2>${isEdit ? 'Редагування пака' : 'Створення пака'}</h2></div>
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

      <div class="block pe-char-block">
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
            <h2 class="pe-char-title" id="pe-cat-title">Стать</h2>
          </div>

          <div class="pe-toolbar">
            <div class="pe-toolbar__row">
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
            <div class="pe-search__meta">
              <span id="pe-search-count" aria-live="polite"></span>
            </div>
            <div id="pe-search-results" class="pe-cata-list pe-search-results" role="group" aria-label="Результати пошуку" hidden></div>
          </div>

          <div class="pe-char-columns">
            <div class="pe-char-list-col">
              <div class="pe-field">
                <textarea id="pe-cards" class="pe-input pe-cards" placeholder="${esc(TEXTAREA_PLACEHOLDER)}" spellcheck="false"></textarea>
                <div id="pe-cata-list" class="pe-cata-list" role="group" aria-label="Додані картки" hidden></div>
                <div class="pe-list-meta">
                  
                  <span id="pe-lines-count" class="pe-counter">Рядків: 0</span>
                </div>
              </div>
            </div>

            <div class="pe-char-form-col">
              <!-- Форма катаклізму -->
              <div id="pe-cata" class="pe-cata pe-side-form" hidden>
                <h3 id="pe-cata-mode" class="pe-cata__title">Новий катаклізм</h3>
                <p class="pe-hint">Заповніть поля та натисніть "Додати".</p>
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
                    <label class="pe-label" for="pe-cata-stay">Час (міс.)</label>
                    <input id="pe-cata-stay" class="pe-input" type="text" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="Напр.: 6">
                  </div>
                  <div class="pe-field">
                    <label class="pe-label" for="pe-cata-pop">Популяція</label>
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
      </div>

      <div class="block">
        <div class="block-head"><h2>Стадії</h2></div>
        <div class="block-body pe-body">
          <p class="pe-hint">
            Стадії діють на весь пак: для кожної професії, хобі та хвороби гра випадково обирає одне зі значень.
            Одне значення — один рядок.
          </p>
          <div class="pe-stages" id="pe-stages">${stageFieldsHtml()}</div>
        </div>
      </div>

      <div class="block pe-actions-block">
        <div class="block-body pe-actions" id="pe-actions">${buttons}</div>
      </div>
    </section>
  `;
}

