export const TOUR_STORAGE_KEY = 'tb_pe_tour_v1';

// Декларативний список кроків онбординг-туру редактора паків.
// Щоб додати нову підказку, достатньо додати ще один об'єкт у масив.
export const PACK_EDITOR_TOUR_STEPS = [
  {
    id: 'meta',
    target: '#pe-meta-block',
    title: 'Назва та опис пака',
    text: 'Почніть із назви та короткого опису сценарію вашого пака — гравці бачитимуть їх при виборі пака.',
    placement: 'bottom'
  },
  {
    id: 'ranges',
    target: '#pe-ranges-block',
    title: 'Глобальні налаштування генерації',
    text: 'Тут задаються базові діапазони віку та зросту, в межах яких гра випадково генерує параметри персонажів.',
    placement: 'bottom'
  },
  {
    id: 'categories',
    target: '.pe-char-sidebar',
    title: 'Категорії та статистика',
    text: 'У цьому меню ви можете перемикатися між категоріями, бачити кількість доданих карток у кожній та загальну статистику пака.',
    placement: 'right',
    mobileView: 'categories'
  },
  {
    id: 'search',
    target: '.pe-toolbar__search',
    title: 'Пошук та фільтри',
    text: 'Це пошук: тут ви можете знайти потрібну картку за назвою чи описом, а через кнопку налаштувань — шукати по всіх категоріях або за особливими властивостями.',
    placement: 'bottom',
    mobileView: 'cards'
  },
  {
    id: 'save-status',
    target: '#pe-save-status',
    title: 'Статус збереження',
    text: 'Індикатор показує стан автозбереження локальної чернетки, щоб ви не втратили незбережені зміни під час редагування.',
    placement: 'bottom',
    mobileView: 'cards'
  },
  {
    id: 'llm',
    target: '.pe-toolbar__llm-group',
    title: 'Режим LLM та ШІ-промпт',
    text: 'Перемикач «Режим LLM» відкриває кнопку копіювання готового ШІ-промпту для генерації карток і переводить редагування в суцільний текст.',
    placement: 'bottom',
    mobileView: 'cards',
    demoAction: 'enable-llm'
  },
  {
    id: 'cards-list',
    target: '.pe-char-list-col',
    title: 'Список карток',
    text: 'Тут відображаються додані картки: у візуальному режимі їх можна сортувати, редагувати кліком і масово видаляти, а в Режимі LLM — редагувати текстом або перетягнути сюди готовий .txt чи .json файл.',
    placement: 'right',
    mobileView: 'cards',
    demoAction: 'preview-list-llm'
  },
  {
    id: 'cards-form',
    target: '.pe-char-form-col .pe-side-form:not([hidden])',
    title: 'Форма додавання картки',
    text: 'У цій формі створюються та редагуються картки поточної категорії — заповніть поля й натисніть «Додати».',
    placement: 'left',
    mobileView: 'cards',
    demoAction: 'visual-form'
  },
  {
    id: 'stages',
    target: '#pe-stages-block',
    title: 'Стадії',
    text: 'У цьому блоці налаштовуються спільні стадії для всього пака (стаж, рівень хобі, ступінь хвороби), а також є окремий перемикач режиму LLM.',
    placement: 'top',
    demoAction: 'visual-form'
  },
  {
    id: 'actions',
    target: '.pe-actions-block',
    title: 'Збереження та дії з паком',
    text: 'Тут розташовані кнопки збереження пака в базу, скасування незбережених змін, повного очищення форми та виходу до списку паків.',
    placement: 'top'
  }
];
