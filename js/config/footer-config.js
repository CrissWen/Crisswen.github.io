// ===== Дані футера =====
// Усе, що треба міняти руками (версія, дата, назва команди, посилання), лежить у цьому файлі.
// Розмітку й логіку футера дивіться в js/ui/site-footer.js, цитати дня — у js/config/footer-quotes.js.
//
// Пункт із href: null — «заглушка»: виглядає клікабельним (hover, фокус), але нікуди не веде.
// Щоб підключити реальну сторінку чи форму, просто впишіть адресу в href:
//   - 'https://...'  -> відкриється в новій вкладці
//   - '#/rules'      -> внутрішній маршрут (його треба буде додати в routes у js/app.js)

export const FOOTER_CONFIG = {
  gameName: 'БУНКЕР',

  // Версія та дата останнього оновлення (дата — РРРР-ММ-ДД, у футері показується як ДД.ММ.РРРР)
  version: '1.0.1',
  updatedAt: '2026-11-04',

  // Копірайт: «© 2026 Назва команди» (з наступного року сам стане «© 2026–2027 ...»)
  teamName: 'Назва команди',
  startYear: 2026-2027,

  // Кнопка «Нагору»: з'являється, коли прогорнуто showAfter від довжини сторінки (0.4 = 40%).
  // minScrollable — мінімум пікселів, які взагалі є куди скролити (на коротких сторінках кнопки немає).
  backToTop: { showAfter: 0.4, minScrollable: 240 },
};

// Посилання на Google-форми. Порожній рядок = форму ще не підключено (пункт працює як заглушка).
export const FORM_LINKS = {
  bugReport: '', // форма «Знайшли баг?»
  ideas: '',     // форма «Є ідея?»
};

// Колонки футера. icon — ключ з ICONS у js/ui/site-footer.js (необов'язково).
export const FOOTER_COLUMNS = [
  {
    id: 'game',
    title: 'Гра',
    items: [
      { id: 'rules', label: 'Правила', href: null },
      { id: 'changelog', label: 'Що нового', href: null },
    ],
  },
  {
    id: 'help',
    title: 'Допомога',
    items: [
      { id: 'faq', label: 'ЧаПи', icon: 'help', href: null },
      { id: 'bug', label: 'Знайшли баг?', icon: 'bug', href: FORM_LINKS.bugReport || null },
      { id: 'idea', label: 'Є ідея?', icon: 'idea', href: FORM_LINKS.ideas || null },
    ],
  },
  {
    id: 'project',
    title: 'Проєкт',
    items: [
      { id: 'credits', label: 'Кредітс', href: null },
      { id: 'support', label: 'Підтримати', icon: 'heart', href: null },
      { id: 'rate', label: 'Оцінити проєкт', icon: 'star', href: null },
    ],
  },
];

// Нижній рядок (поруч із копірайтом)
export const FOOTER_LEGAL = [
  { id: 'privacy', label: 'Конфіденційність', href: null },
  { id: 'terms', label: 'Умови', href: null },
];
