/**
 * Форми «Знайшли баг?» та «Є ідея?» для футера сайту БУНКЕР + передача відповідей у Google Таблицю.
 *
 * Як користуватись (один раз):
 *  1. Створіть порожню Google Таблицю (це буде «база» багів і пропозицій).
 *  2. У ній: Розширення -> Apps Script. Вставте сюди весь цей файл і збережіть.
 *  3. Виберіть функцію setupFeedbackForms і натисніть «Запустити». Надайте дозволи.
 *  4. Подивіться «Журнал виконання»: там будуть два посилання на форми. Їх треба вписати
 *     у js/config/footer-config.js -> FORM_LINKS (bugReport і ideas).
 *
 * Що робить скрипт:
 *  - створює дві Google Форми (баг і пропозиція);
 *  - створює в таблиці аркуші «Баги» та «Пропозиції» з колонками Дата / Проблема / Категорія / Посилання;
 *  - на кожне надсилання форми додає рядок у потрібний аркуш; посилання веде на відповідь у формі.
 *
 * Важливо: посилання на окрему відповідь відкривається лише тим, хто має доступ РЕДАКТОРА до форми.
 * Тому додайте членів команди як редакторів обох форм (Форма -> Налаштування доступу).
 * Сама таблиця може бути відкрита «усім, хто має посилання» (лише перегляд).
 *
 * Повторний запуск setupFeedbackForms нічого не дублює: вже створені форми пропускаються.
 */

const FEEDBACK_CONFIG = {
  bug: {
    key: 'FORM_ID_BUG',
    sheet: 'Баги',
    handler: 'onBugSubmit',
    title: 'БУНКЕР: повідомити про баг',
    description: 'Опишіть, що пішло не так. Чим детальніше, тим швидше ми це виправимо.',
    problemTitle: 'Що сталося?',
    categoryTitle: 'Де саме?',
    categories: ['Інтерфейс', 'Ігровий процес', 'Профіль', 'Редактор паків', 'Звук', 'Теми', 'Інше'],
    extra: [
      { title: 'Як відтворити баг?', help: 'Кроки, після яких він з\'являється (необов\'язково)', required: false },
      { title: 'Браузер і пристрій', help: 'Наприклад: Chrome, телефон (необов\'язково)', required: false },
    ],
  },
  idea: {
    key: 'FORM_ID_IDEA',
    sheet: 'Пропозиції',
    handler: 'onIdeaSubmit',
    title: 'БУНКЕР: запропонувати ідею',
    description: 'Розкажіть, що б ви додали або змінили в грі.',
    problemTitle: 'Ваша ідея',
    categoryTitle: 'До чого вона?',
    categories: ['Ігровий процес', 'Нові картки', 'Інтерфейс', 'Теми', 'Звук', 'Інше'],
    extra: [
      { title: 'Навіщо це гравцям?', help: 'Яку проблему вирішує ідея (необов\'язково)', required: false },
    ],
  },
};

const SHEET_HEADERS = ['Дата', 'Проблема', 'Категорія', 'Посилання на відповідь', 'Вирішено'];
const RESOLVED_COL = 5; // колонка з галочкою «Вирішено»

function setupFeedbackForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Запустіть скрипт із таблиці: Розширення -> Apps Script.');
  const props = PropertiesService.getScriptProperties();

  Object.keys(FEEDBACK_CONFIG).forEach(function (name) {
    const cfg = FEEDBACK_CONFIG[name];

    // Аркуш із потрібними заголовками
    let sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) sheet = ss.insertSheet(cfg.sheet);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidth(2, 420);
      sheet.setColumnWidth(4, 260);
    }

    // Форма (створюємо лише якщо її ще немає)
    let form = null;
    const savedId = props.getProperty(cfg.key);
    if (savedId) {
      try { form = FormApp.openById(savedId); } catch (e) { form = null; }
    }
    if (!form) {
      form = FormApp.create(cfg.title);
      form.setDescription(cfg.description);
      form.setCollectEmail(false);
      form.addParagraphTextItem().setTitle(cfg.problemTitle).setRequired(true);
      form.addListItem().setTitle(cfg.categoryTitle).setChoiceValues(cfg.categories).setRequired(true);
      cfg.extra.forEach(function (f) {
        form.addParagraphTextItem().setTitle(f.title).setHelpText(f.help).setRequired(f.required);
      });
      props.setProperty(cfg.key, form.getId());
    }

    // Тригер на надсилання (без дублів)
    const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === cfg.handler;
    });
    if (!hasTrigger) {
      ScriptApp.newTrigger(cfg.handler).forForm(form).onFormSubmit().create();
    }

    Logger.log('%s: форма для сайту -> %s', cfg.sheet, form.getPublishedUrl());
    Logger.log('%s: редагування форми -> %s', cfg.sheet, form.getEditUrl());
  });
}

function onBugSubmit(e) { appendFeedbackRow_(e, FEEDBACK_CONFIG.bug); }
function onIdeaSubmit(e) { appendFeedbackRow_(e, FEEDBACK_CONFIG.idea); }

function appendFeedbackRow_(e, cfg) {
  const form = e.source;
  const response = e.response;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.sheet) || ss.insertSheet(cfg.sheet);

  let problem = '';
  let category = '';
  response.getItemResponses().forEach(function (ir) {
    const title = ir.getItem().getTitle();
    if (title === cfg.problemTitle) problem = String(ir.getResponse());
    if (title === cfg.categoryTitle) category = String(ir.getResponse());
  });

  // У таблиці «Проблема» коротка (повний текст — у відповіді за посиланням)
  const short = problem.length > 300 ? problem.slice(0, 297) + '...' : problem;
  const link = 'https://docs.google.com/forms/d/' + form.getId() + '/edit#response=' + response.getId();

  // Блокування, щоб два одночасні надсилання не плутали номер рядка для галочки
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow([
      response.getTimestamp(),
      safeCell_(short),
      safeCell_(category),
      link,
    ]);
    sheet.getRange(sheet.getLastRow(), RESOLVED_COL).insertCheckboxes();
  } finally {
    lock.releaseLock();
  }
}

// ===== Виконані задачі: галочка «Вирішено» ховає рядок =====

function isFeedbackSheet_(name) {
  return Object.keys(FEEDBACK_CONFIG).some(function (k) { return FEEDBACK_CONFIG[k].sheet === name; });
}

// Простий тригер: спрацьовує сам, коли в таблиці щось змінюють. Галочка -> рядок ховається.
function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (!isFeedbackSheet_(sheet.getName())) return;
  if (range.getColumn() !== RESOLVED_COL || range.getRow() < 2) return;
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  if (e.value === 'TRUE') sheet.hideRows(range.getRow());
}

// Меню «Бункер» у таблиці: повернути прихований рядок або знову сховати всі вирішені
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Бункер')
    .addItem('Показати вирішені', 'showResolvedRows')
    .addItem('Сховати вирішені', 'hideResolvedRows')
    .addToUi();
}

function showResolvedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(FEEDBACK_CONFIG).forEach(function (k) {
    const sheet = ss.getSheetByName(FEEDBACK_CONFIG[k].sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.showRows(2, sheet.getLastRow() - 1);
  });
}

function hideResolvedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(FEEDBACK_CONFIG).forEach(function (k) {
    const sheet = ss.getSheetByName(FEEDBACK_CONFIG[k].sheet);
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getRange(2, RESOLVED_COL, sheet.getLastRow() - 1, 1).getValues();
    values.forEach(function (row, i) {
      if (row[0] === true) sheet.hideRows(i + 2);
    });
  });
}

// Запустіть ОДИН раз після оновлення скрипта: додає колонку «Вирішено» і галочки до вже наявних рядків
function upgradeFeedbackSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(FEEDBACK_CONFIG).forEach(function (k) {
    const sheet = ss.getSheetByName(FEEDBACK_CONFIG[k].sheet);
    if (!sheet) return;
    sheet.getRange(1, RESOLVED_COL).setValue('Вирішено').setFontWeight('bold');
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, RESOLVED_COL, sheet.getLastRow() - 1, 1).insertCheckboxes();
    }
  });
}

// Захист від формул: текст, що починається з = + - @, Таблиця інакше сприйме як формулу
function safeCell_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}
