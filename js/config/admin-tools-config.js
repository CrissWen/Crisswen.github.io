// Реєстр інструментів адмін-панелі (модальне вікно, що відкривається клавішею ~, див. js/ui/admin-panel.js).
// Щоб додати новий інструмент, достатньо ще одного запису в ADMIN_TOOLS: панель відмалює його сама.
//
// Поля інструмента:
//   id          унікальний ідентифікатор (латиниця, kebab-case)
//   title       назва картки
//   description короткий опис під назвою
//   icon        шлях до SVG-іконки (малюється через maskIcon, тож бере колір теми)
//   group       id групи з ADMIN_TOOL_GROUPS; невідома група потрапляє в «Інше»
//   href        сторінка, що відкривається; посилання, а не кнопка
//   openIn      '_blank' (нова вкладка, за замовчуванням) або '_self'
//   action      замість href: назва дії для кнопки (як data-footer-action у футері); обробник додається в admin-panel.js
//
// Нова вкладка потрібна тому, що гра працює через Realtime: перехід у тій самій вкладці розірвав би сесію.
// Увага: панель лише зручність, а не захист. Кожна сторінка зберігає власний Admin Gate, а справжній захист забезпечує RLS.

export const ADMIN_TOOL_GROUPS = Object.freeze([
  { id: 'debug', title: 'Відладчики' },
]);

export const ADMIN_TOOLS = Object.freeze([
  {
    id: 'audio-lab',
    title: 'Аудіо-лабораторія',
    description: 'A/B калібрування синтезатора, осцилограф і спектр',
    icon: 'icons/audio/music.svg',
    group: 'debug',
    href: 'audio-lab.html',
    openIn: '_blank',
  },
  {
    id: 'icon-curator',
    title: 'Куратор іконок',
    description: 'Куратор і нормалізатор іконок катаклізмів',
    icon: 'icons/catastrophe/hazard.svg',
    group: 'debug',
    href: 'cataclysm-icon-curator.html',
    openIn: '_blank',
  },
]);

// Група для інструментів, чия group не знайдена в ADMIN_TOOL_GROUPS
export const FALLBACK_GROUP = Object.freeze({ id: 'other', title: 'Інше' });
