import { CHANGELOG } from './changelog-config.js';

// ===== Дані футера =====
// Усе, що треба міняти руками (назва команди, посилання), лежить у цьому файлі; версія й дата — у js/config/changelog-config.js.
// Розмітку й логіку футера дивіться в js/ui/site-footer.js, цитати дня — у js/config/footer-quotes.js.
//
// Пункт із href: null — «заглушка»: виглядає клікабельним (hover, фокус), але нікуди не веде.
// Щоб підключити реальну сторінку чи форму, просто впишіть адресу в href:
//   - 'https://...'  -> відкриється в новій вкладці
//   - '#/rules'      -> внутрішній маршрут (його треба буде додати в routes у js/app.js)

export const FOOTER_CONFIG = {
  gameName: 'БУНКЕР',

  // Версія та дата беруться з ПЕРШОГО (найновішого) запису js/config/changelog-config.js — нову версію дописуйте там
  version: CHANGELOG[0]?.version ?? '', // з першого (найновішого) запису js/config/changelog-config.js
  updatedAt: CHANGELOG[0]?.date ?? '',  // дата того ж запису (РРРР-ММ-ДД)

  // Копірайт: «© 2026 Назва команди» (з наступного року сам стане «© 2026–2027 ...»)
  teamName: 'TrueBunker',
  startYear: 2026,

  // Кнопка «Нагору»: з'являється, коли прогорнуто showAfter від довжини сторінки (0.4 = 40%).
  // minScrollable — мінімум пікселів, які взагалі є куди скролити (на коротких сторінках кнопки немає).
  backToTop: { showAfter: 0.4, minScrollable: 240 },
};

// Посилання на Google-форми. Порожній рядок = форму ще не підключено (пункт працює як заглушка).
export const FORM_LINKS = {
  bugReport: 'https://docs.google.com/forms/d/e/1FAIpQLSeXlQsM2OoM3A37-Ih9fZED3F6x8XUOmXuF18P5esbkw9RTIA/viewform', // форма «Знайшли баг?»
  ideas: 'https://docs.google.com/forms/d/e/1FAIpQLSeLJVFEwbOvXfpoeuVfv057J2IS_k37BusqWFK8nF7THoKt9A/viewform',     // форма «Є ідея?»
};

// Колонки футера. icon — ключ з FOOTER_ICONS у js/constants/icons.js (необов'язково).
export const FOOTER_COLUMNS = [
  {
    id: 'game',
    title: 'Гра',
    items: [
      { id: 'rules', label: 'Правила', href: null },
      { id: 'changelog', label: 'Що нового', href: '#/changelog' },
    ],
  },
  {
    id: 'help',
    title: 'Допомога',
    items: [
      { id: 'faq', label: 'ЧаПи', icon: 'help', href: '#/faq' },
      { id: 'bug', label: 'Знайшли баг?', icon: 'bug', href: FORM_LINKS.bugReport || null },
      { id: 'idea', label: 'Є ідея?', icon: 'idea', href: FORM_LINKS.ideas || null },
    ],
  },
  {
    id: 'project',
    title: 'Проєкт',
    items: [
      { id: 'credits', label: 'Автори', href: '#/credits' },
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
