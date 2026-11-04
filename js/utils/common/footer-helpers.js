// Чисті функції для футера (без DOM, тому легко тестуються): цитата дня, формат дати, копірайт
// і умова показу кнопки «Нагору».

// Номер дня в році (1..366) за ЛОКАЛЬНОЮ датою. Рахуємо через UTC від локальних року/місяця/дня,
// щоб перехід на літній/зимовий час не збивав результат.
export function getDayOfYear(date = new Date()) {
  const y = date.getFullYear();
  const startOfYear = Date.UTC(y, 0, 0);
  const today = Date.UTC(y, date.getMonth(), date.getDate());
  return Math.round((today - startOfYear) / 86400000);
}

// Цитата дня з масиву. У високосний 366-й день (або якщо масив коротший за рік) береться залишок
// від ділення, тому нічого не ламається. Порожній або відсутній масив -> fallback.
export function pickDailyQuote(quotes, date = new Date(), fallback = '') {
  if (!Array.isArray(quotes) || quotes.length === 0) return fallback;
  const index = (getDayOfYear(date) - 1) % quotes.length;
  const quote = quotes[index];
  return typeof quote === 'string' && quote.trim() ? quote : fallback;
}

// '2026-11-04' -> '04.11.2026'. Якщо формат інший — повертає рядок як є, щоб не ховати помилку в конфігу.
export function formatUpdateDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? '').trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(isoDate ?? '');
}

// '© 2026 Команда' або '© 2026–2027 Команда', коли рік уже пішов далі за стартовий.
export function formatCopyright({ startYear, teamName }, now = new Date()) {
  const current = now.getFullYear();
  const years = current > startYear ? `${startYear}–${current}` : `${startYear}`;
  return `© ${years} ${teamName}`;
}

// Чи показувати «Нагору»: сторінка має достатньо довжини для скролу, і прогорнуто не менше threshold
// від доступної прокрутки (scrollHeight − viewportHeight), тому 40% працює однаково на довгих і коротких сторінках.
export function shouldShowBackToTop({ scrollY, scrollHeight, viewportHeight, threshold = 0.4, minScrollable = 240 }) {
  const scrollable = scrollHeight - viewportHeight;
  if (!(scrollable >= minScrollable)) return false;
  return scrollY / scrollable >= threshold;
}
