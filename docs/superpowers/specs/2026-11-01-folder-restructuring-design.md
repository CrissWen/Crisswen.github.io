# Folder Restructuring Design Document

**Date:** 2026-11-01  
**Author:** AI Assistant & User  
**Status:** In Review  

---

## 1. Intent & The "Why"
У зв'язку з активним розвитком проєкту TrueBunker виникло перевантаження кореневих папок:
- У `tests/` накопичилося 37 файлів безпосередньо у папці.
- У `js/utils/` — 24 файли поруч із підпапкою `host/`.
- У `js/pages/` тестові пісочниці (`survival-test*`) перемішані з робочими сторінками гри.
- У `js/game-modules/` файл `room-update-reducer.js` лежить окремо від існуючих піддиректорій.

Мета: розкласти файли по логічних піддиректоріях, оновити всі шляхи (імпорти/експорти, шляхи до хелперів і конфігів у тестах, `<script>` теги), не змінюючи логіку роботи коду.

---

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  1. Розподілити 37 тестів у 5 тематичних підпапок: `tests/audio/`, `tests/pack-editor/`, `tests/auth-profile/`, `tests/game/`, `tests/ui/`.
  2. Розподілити 24 утиліти у 4 тематичні підпапки: `js/utils/auth/`, `js/utils/game/`, `js/utils/roulette/`, `js/utils/common/` (папка `js/utils/host/` залишається).
  3. Перемістити `js/pages/survival-*` до `js/pages/dev/`.
  4. Перемістити `js/game-modules/room-update-reducer.js` до `js/game-modules/state/`.
  5. Оновити всі відносні шляхи в проєкті так, щоб усі 51 тестовий набір (`node --test "tests/**/*.test.mjs"`) виконувались успішно.
- **Non-Goals:**
  - Переписування або рефакторинг логіки функцій чи тестів.
  - Переміщення кореневих HTML файлів (`index.html`, `survival-test.html`, `audio-lab.html`, `cataclysm-icon-curator.html`) з кореня, щоб не ламати відкриття через локальні сервери/URL.
- **Anti-Goals:**
  - Зламані відносні імпорти чи помилки 404 у браузері під час запуску гри чи пісочниць.

---

## 3. Approaches Considered & Selected
- **Підхід 1 (Обраний):** Комплексне групування найбільш захаращених зон (`tests/`, `js/utils/`, `js/pages/dev/`, `js/game-modules/state/`). Забезпечує чисте дерево і легку навігацію.
- **Підхід 2:** Тільки `tests/` і `js/utils/`. Відхилено, оскільки залишає пісочниці та редуктори невідсортованими.
- **Підхід 3:** Повний монолітний реорганізм за фічами. Відхилено як занадто ризикований для командного репозиторію.

---

## 4. Target Directory Structure & Move Map

### 4.1. `tests/`
| Цільова папка | Файли тестів |
|---|---|
| `tests/audio/` | `ambient-preview.test.mjs`, `analyze-audio.test.mjs`, `audio-fade-cleanup.test.mjs`, `audio-instance-cleanup.test.mjs`, `audio-lab-layout.test.mjs`, `audio-lifecycle.test.mjs`, `audio-missing-retry.test.mjs`, `audio-synth.test.mjs`, `sound-balance.test.mjs`, `sound-manager-fallback.test.mjs` |
| `tests/pack-editor/` | `pack-editor-history.test.mjs`, `pack-editor-lifecycle.test.mjs`, `pack-editor-parser.test.mjs`, `pack-editor-reconcile.test.mjs` |
| `tests/auth-profile/` | `auth-form.test.mjs`, `auth-validation.test.mjs`, `avatar-broken-url.test.mjs`, `avatar-cropper-lifecycle.test.mjs`, `avatar-security.test.mjs`, `image-file.test.mjs`, `initials.test.mjs`, `profile-async-guard.test.mjs`, `profile-cleanup.test.mjs` |
| `tests/game/` | `bunker-transition-skip.test.mjs`, `char-lock-and-cas.test.mjs`, `close-after-finish.test.mjs`, `offline-replay-reveal.test.mjs`, `replay-schema.test.mjs`, `room-update-reducer.test.mjs`, `timer-stale-autostop.test.mjs`, `vote-race.test.mjs` |
| `tests/ui/` | `cataclysm-spin-visuals.test.mjs`, `clone.test.mjs`, `custom-select-a11y.test.mjs`, `no-duplicate-esc.test.mjs`, `roulette-overlay-lifecycle.test.mjs`, `roulette-ribbon.test.mjs` |
| `tests/helpers/` | залишається без змін (`fake-supabase.mjs`) |

### 4.2. `js/utils/`
| Цільова папка | Файли утиліт |
|---|---|
| `js/utils/auth/` | `auth-validation.js`, `avatar.js`, `image-file.js`, `initial.js`, `security.js`, `experience.js` |
| `js/utils/game/` | `board-view-model.js`, `game-generator.js`, `host-actions.js`, `last-session.js`, `log-writer.js`, `pack-fallback.js`, `player-parser.js`, `start-game.js`, `time-sync.js` |
| `js/utils/roulette/` | `cataclysm-detector.js`, `cataclysm-spin.js`, `roulette-config.js`, `roulette-ribbon.js` |
| `js/utils/common/` | `clone.js`, `escape-html.js`, `random.js`, `sfx.js`, `theme-manager.js` |
| `js/utils/host/` | залишається без змін (10 файлів дій хоста) |

### 4.3. `js/pages/` та `js/game-modules/`
| Цільова папка | Файли |
|---|---|
| `js/pages/survival/` | `survival-test.js`, `survival-test-header.js`, `survival-roulette.js` |
| `js/game-modules/state/` | `room-update-reducer.js` |

---

## 5. Verification Strategy
1. **Automated verification:**  
   Виконання команди `node --test "tests/**/*.test.mjs"`. Усі 51 тест мають виконуватися без жодної помилки імпорту чи шляху.
2. **Path checking:**  
   Перевірка відсутності битих посилань у `survival-test.html`, `index.html` та залежних модулях.

