import { esc } from '../../utils/escape-html.js';
import { oneLine } from '../parser.js';
import { cataMatches } from '../search.js';
import { highlightHtml } from './search.js';
import { $, CATA_FIELDS, CATA_NUMERIC, CATACLYSM_LIST_PLACEHOLDER } from './helpers.js';

// ----- Катаклізми: форма і список -----
export function readCataRaw() {
  const get = key => $(CATA_FIELDS[key]).value.trim();
  return { name: get('name'), desc: get('desc'), timer: get('timer'), stay: get('stay'), pop: get('pop') };
}

export const isCataErrorVisible = () => !$('pe-cata-error').hidden;

// Числові поля форми катаклізму приймають лише цифри (при вставці "50 000" → 50000); для решти полів нічого не робить
export function sanitizeCataNumericInput(target) {
  const key = CATA_NUMERIC.find(k => CATA_FIELDS[k] === target.id);
  if (!key) return;
  const cleaned = target.value.replace(/\D/g, '');
  if (cleaned !== target.value) target.value = cleaned;
}

export function showCataError(message, key) {
  const el = $('pe-cata-error');
  el.textContent = message || '';
  el.hidden = !message;
  Object.values(CATA_FIELDS).forEach(id => $(id).classList.remove('is-invalid'));
  if (message && key) {
    const field = $(CATA_FIELDS[key]);
    field.classList.add('is-invalid');
    field.focus();
  }
}

// Режим форми: item — катаклізм, що редагується (змінює заголовок, підпис кнопки і показує "Скасувати"/"Видалити"), null — додавання нового
export function paintCataMode(item) {
  $('pe-cata-mode').textContent = item ? `Редагування: "${oneLine(item.name)}"` : 'Новий катаклізм';
  document.querySelector('[data-cata-action="submit"]').textContent = item ? 'Зберегти зміни' : 'Додати';
  document.querySelector('[data-cata-action="cancel"]').hidden = !item;
  document.querySelector('[data-cata-action="delete"]').hidden = !item;
}

// Таймер лишається порожнім, щоб було видно підказку в полі; порожнє = 0 (без таймера)
export function clearCataFields() {
  Object.values(CATA_FIELDS).forEach(id => { $(id).value = ''; });
}

// values — { name, desc, timer, stay, pop } рядками
export function fillCataFields(values) {
  for (const key of Object.keys(CATA_FIELDS)) $(CATA_FIELDS[key]).value = values[key];
}

export const scrollCataFormIntoView = () => $('pe-cata').scrollIntoView({ behavior: 'smooth', block: 'start' });
export const scrollCataListToEnd = () => $('pe-cata-list').lastElementChild?.scrollIntoView({ block: 'start' });

// Список доданих катаклізмів — справжні рядки (кнопки .added-item-row), а не текст у textarea: підсвічування при наведенні,
// "протискання" й виділення обраного рядка робить CSS (packs.css), без вимірювань геометрії та JS-анімацій.
// view: { cataclysms, editIndex, newIndex, tokens }; tokens — слова пошуку, якщо список зараз фільтрується (інакше порожній масив).
export function renderCataList({ cataclysms, editIndex, newIndex, tokens, category = 'cataclysm' }) {
  const list = $('pe-cata-list');
  // Перемальовка замінює кнопки, тож клавіатурний фокус треба повернути на рядок з тим самим індексом
  const focusedIndex = document.activeElement?.closest?.('[data-cata-index]')?.dataset.cataIndex;

  if (!cataclysms.length) {
    list.innerHTML = `<p class="pe-cata-list__empty">${esc(category === 'cataclysm' ? CATACLYSM_LIST_PLACEHOLDER : 'Тут з\'являться додані картки для вибраної категорії. Заповніть форму нижче та натисніть \"Додати\". Щоб редагувати або видалити картку — натисніть на неї тут.')}</p>`;
    return;
  }

  // Пошук по катаклізмах фільтрує сам список; рядок, що зараз відкритий у формі, лишається видимим, навіть якщо не збігається
  const rows = cataclysms
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => !tokens.length || i === editIndex || cataMatches(c, tokens));
  if (!rows.length) {
    list.innerHTML = '<p class="pe-cata-list__empty">Нічого не знайдено за запитом</p>';
    return;
  }

  list.innerHTML = rows.map(({ c, i }) => {
    const selected = i === editIndex;
    const isNew = i === newIndex;
    const descHtml = (category !== 'cataclysm' && c.description) ? `<span style="opacity:0.7"> - ${highlightHtml(oneLine(c.description), tokens)}</span>` : '';
    return `
      <button type="button" class="added-item-row${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}" data-cata-index="${i}" aria-pressed="${selected}">
        <span class="added-item-row__name">${highlightHtml(oneLine(c.name), tokens)}${descHtml}</span>
        <span class="added-item-row__hint">${selected ? 'редагується' : 'редагувати'}</span>
      </button>`;
  }).join('');

  if (focusedIndex !== undefined) list.querySelector(`[data-cata-index="${focusedIndex}"]`)?.focus();
}

