// Чиста логіка форми авторизації без залежностей (щоб тестувати без Supabase).

export const USERNAME_MAX_LENGTH = 12;
// Літери (латиниця й українська), цифри, «_» та «-». Явні діапазони замість \w/i-прапорця,
// щоб не пускати екзотичні символи, які регістронезалежний Unicode-режим підтягує до \w.
const STRICT_USERNAME_RE = /^[A-Za-z0-9_\-а-яіїєґА-ЯІЇЄҐ]{1,12}$/u;

/** Помилка з готовим для користувача повідомленням (на відміну від сирих помилок мережі/SDK). */
export class AuthUiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthUiError';
  }
}

/**
 * Перевіряє нікнейм. Повертає текст помилки або null.
 * strict=true (реєстрація): лише дозволені символи. strict=false (вхід): не чіпаємо старі акаунти
 * з іменами, зареєстрованими до введення правил, відсікаємо лише те, що ламає фейкову пошту (@, пробіли).
 */
export function validateUsername(name, { strict = true } = {}) {
  if (typeof name !== 'string' || !name) return "Будь ласка, введіть ім'я!";
  if ([...name].length > USERNAME_MAX_LENGTH) return `Ім'я не повинно перевищувати ${USERNAME_MAX_LENGTH} символів!`;
  if (/[@\s]/u.test(name)) return "Ім'я не може містити пробіли або символ @";
  if (strict && !STRICT_USERNAME_RE.test(name)) return "Ім'я може містити лише літери, цифри, «_» та «-»";
  return null;
}

/** Supabase Auth працює з email, тому для входу за нікнеймом використовуємо фейкову пошту. */
export function buildFakeEmail(username) {
  return `${username}@bunker.local`;
}

function isNetworkError(e, status, msg) {
  if (e.name === 'AuthRetryableFetchError') return true;
  if (e instanceof TypeError && /fetch|network|load failed/i.test(msg)) return true;
  return /failed to fetch|network ?error|networkerror|load failed/i.test(msg) && !status;
}

/**
 * Перетворює помилку Supabase/мережі на зрозуміле повідомлення. Не видає будь-який збій
 * за «ім'я зайняте» чи «невірний пароль»: це заплутувало користувачів і ховало справжню причину.
 */
export function mapAuthError(err, mode = 'login') {
  const e = err && typeof err === 'object' ? err : { message: String(err ?? '') };
  const status = Number(e.status) || 0;
  const code = String(e.code || '');
  const msg = String(e.message || '');

  if (isNetworkError(e, status, msg)) {
    return "Немає з'єднання з мережею. Перевірте інтернет і спробуйте ще раз.";
  }
  if (status === 429 || /rate.?limit/i.test(code) || /rate limit/i.test(msg)) {
    return 'Забагато спроб. Спробуйте за кілька хвилин.';
  }

  if (mode === 'register') {
    if (code === 'user_already_exists' || code === 'email_exists'
      || /already (registered|exists)|duplicate|unique/i.test(msg)
      || /database error saving new user/i.test(msg)) { // тригер/таблиця з UNIQUE на username повертає саме це
      return "Це ім'я вже зайняте";
    }
    if (code === 'weak_password' || (/password/i.test(msg) && /least|short|weak|characters|known/i.test(msg))) {
      return 'Пароль надто слабкий або короткий (мінімум 6 символів)';
    }
    if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid email|email address .*invalid/i.test(msg)) {
      return "Ім'я містить недопустимі символи";
    }
    return 'Не вдалося створити акаунт. Спробуйте пізніше.';
  }

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg) || (status === 400 && !code)) {
    return "Невірне ім'я або пароль";
  }
  return 'Не вдалося увійти. Спробуйте пізніше.';
}
