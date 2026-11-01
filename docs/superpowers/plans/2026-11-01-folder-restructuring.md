# Folder Restructuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реструктуризувати скупчення файлів у `tests/`, `js/utils/`, `js/pages/` та `js/game-modules/`, згрупувавши їх за функціональними доменами, та оновити всі шляхи імпортів без зміни бізнес-логіки.

**Architecture:** Зберігаємо чисту модульну структуру ES-модулів. Файли тестів переносяться в `tests/{audio,pack-editor,auth-profile,game,ui}`, утиліти — в `js/utils/{auth,game,roulette,common}`, тестові сторінки — в `js/pages/dev/`, а редюсер — в `js/game-modules/state/`. Всі відносні імпорти оновлюються за єдиним правилом.

**Tech Stack:** Vanilla JavaScript (ES modules), Node.js native test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-01-folder-restructuring-design.md`

## Global Constraints
- Жодних змін бізнес-логіки коду чи тестових тверджень (asserts).
- Усі тести (51 suite/test) мають проходити зеленими через `node --test "tests/**/*.test.mjs"`.
- Кореневі HTML файли залишаються в корені проєкту.

## Review Focus
- Помилки 404/ERR_MODULE_NOT_FOUND через невірну глибину відносних шляхів (`../` замість `../../`).
- Імпорти між самими утилітами всередині `js/utils/`.
- Імпорти утиліт з `js/pages/`, `js/game-modules/`, `js/ui/` та `js/pack-editor/`.
- Тестові шляхи до `helpers/fake-supabase.mjs` та `audio-lab.html`.
- Теги `<script>` у `survival-test.html`.

---

### Task 1: Reorganize Tests Directory (`tests/`)

**Files:**
- Create directories:
  - `tests/audio/`
  - `tests/pack-editor/`
  - `tests/auth-profile/`
  - `tests/game/`
  - `tests/ui/`
- Move files:
  - to `tests/audio/`: `ambient-preview.test.mjs`, `analyze-audio.test.mjs`, `audio-fade-cleanup.test.mjs`, `audio-instance-cleanup.test.mjs`, `audio-lab-layout.test.mjs`, `audio-lifecycle.test.mjs`, `audio-missing-retry.test.mjs`, `audio-synth.test.mjs`, `sound-balance.test.mjs`, `sound-manager-fallback.test.mjs`
  - to `tests/pack-editor/`: `pack-editor-history.test.mjs`, `pack-editor-lifecycle.test.mjs`, `pack-editor-parser.test.mjs`, `pack-editor-reconcile.test.mjs`
  - to `tests/auth-profile/`: `auth-form.test.mjs`, `auth-validation.test.mjs`, `avatar-broken-url.test.mjs`, `avatar-cropper-lifecycle.test.mjs`, `avatar-security.test.mjs`, `image-file.test.mjs`, `initials.test.mjs`, `profile-async-guard.test.mjs`, `profile-cleanup.test.mjs`
  - to `tests/game/`: `bunker-transition-skip.test.mjs`, `char-lock-and-cas.test.mjs`, `close-after-finish.test.mjs`, `offline-replay-reveal.test.mjs`, `replay-schema.test.mjs`, `room-update-reducer.test.mjs`, `timer-stale-autostop.test.mjs`, `vote-race.test.mjs`
  - to `tests/ui/`: `cataclysm-spin-visuals.test.mjs`, `clone.test.mjs`, `custom-select-a11y.test.mjs`, `no-duplicate-esc.test.mjs`, `roulette-overlay-lifecycle.test.mjs`, `roulette-ribbon.test.mjs`
- Modify: All moved test files (update relative imports to `../../js/...`, `../helpers/fake-supabase.mjs`, and relative paths to fixtures/html).

- [ ] **Step 1: Move test files into their subdirectories**
- [ ] **Step 2: Update import paths in moved test files (depth + 1 for `../js` -> `../../js` and `./helpers` -> `../helpers`)**
- [ ] **Step 3: Run all tests to verify**
Run: `node --test "tests/**/*.test.mjs"`
Expected: PASS 51 tests
- [ ] **Step 4: Commit**
`git add tests/`
`git commit -m "refactor(tests): group test files into domain subdirectories"`

---

### Task 2: Move Sandbox Pages and State Reducer

**Files:**
- Create directories:
  - `js/pages/dev/`
  - `js/game-modules/state/`
- Move files:
  - `js/pages/survival-test.js` -> `js/pages/dev/survival-test.js`
  - `js/pages/survival-test-header.js` -> `js/pages/dev/survival-test-header.js`
  - `js/pages/survival-roulette.js` -> `js/pages/dev/survival-roulette.js`
  - `js/game-modules/room-update-reducer.js` -> `js/game-modules/state/room-update-reducer.js`
- Modify:
  - `survival-test.html` (update script src to `js/pages/dev/...`)
  - `js/pages/dev/survival-test.js` & `survival-test-header.js` (update relative imports)
  - `js/pages/game.js` (update import of `room-update-reducer.js`)
  - `tests/game/room-update-reducer.test.mjs` (update import of `room-update-reducer.js`)

- [ ] **Step 1: Move dev pages and reducer into their target directories**
- [ ] **Step 2: Update script tags in survival-test.html and imports in js/pages/dev, js/pages/game.js, and tests/game/room-update-reducer.test.mjs**
- [ ] **Step 3: Run all tests to verify**
Run: `node --test "tests/**/*.test.mjs"`
Expected: PASS 51 tests
- [ ] **Step 4: Commit**
`git add js/pages/ survival-test.html js/game-modules/ tests/game/room-update-reducer.test.mjs`
`git commit -m "refactor(pages,state): organize dev pages and state reducer"`

---

### Task 3: Reorganize Utility Modules (`js/utils/`)

**Files:**
- Create directories:
  - `js/utils/auth/`
  - `js/utils/game/`
  - `js/utils/roulette/`
  - `js/utils/common/`
- Move files:
  - to `auth/`: `auth-validation.js`, `avatar.js`, `image-file.js`, `initial.js`, `security.js`, `experience.js`
  - to `roulette/`: `cataclysm-detector.js`, `cataclysm-spin.js`, `roulette-config.js`, `roulette-ribbon.js`
  - to `game/`: `board-view-model.js`, `game-generator.js`, `host-actions.js`, `last-session.js`, `log-writer.js`, `pack-fallback.js`, `player-parser.js`, `start-game.js`, `time-sync.js`
  - to `common/`: `clone.js`, `escape-html.js`, `random.js`, `sfx.js`, `theme-manager.js`
- Modify:
  - Internal relative imports inside moved util files.
  - References across `js/pages/*`, `js/game-modules/*`, `js/pack-editor/*`, `js/services/*`, `js/ui/*`, `js/app.js`.
  - Imports in `tests/**/*.test.mjs`.

- [ ] **Step 1: Move util files into their target subdirectories**
- [ ] **Step 2: Update internal imports inside moved util files**
- [ ] **Step 3: Update external imports in js/ across pages, services, game-modules, ui, pack-editor**
- [ ] **Step 4: Update import paths in tests/**
- [ ] **Step 5: Run all tests to verify**
Run: `node --test "tests/**/*.test.mjs"`
Expected: PASS 51 tests
- [ ] **Step 6: Commit**
`git add js/ tests/`
`git commit -m "refactor(utils): organize utils into domain subdirectories"`

---

### Task 4: Full Repository Audit & Verification

- [ ] **Step 1: Run comprehensive tests**
Run: `node --test "tests/**/*.test.mjs"`
Expected: PASS 51 tests
- [ ] **Step 2: Run static import path validator script to ensure 0 broken imports across entire repository**
- [ ] **Step 3: Verify git status is clean and all tests succeed**

