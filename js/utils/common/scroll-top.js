// Одноразовий запит «після відмальовування наступної сторінки піднятися нагору».
// Потрібен там, де браузер сам відновив би старий скрол (наприклад, кнопка «Назад» зі сторінок футера:
// гравець клікнув по футеру внизу, а повертатися має на початок попередньої сторінки). Роутер (js/app.js)
// після рендеру викликає consumeScrollTopRequest(). Запит діє кілька секунд, щоб не «спрацювати» пізніше випадково.

let pendingUntil = 0;

export function requestScrollTopOnNextRoute(ttlMs = 3000) {
  pendingUntil = Date.now() + ttlMs;
}

export function consumeScrollTopRequest() {
  const active = Date.now() < pendingUntil;
  pendingUntil = 0;
  return active;
}

// Миттєво (не плавно), навіть якщо в CSS десь увімкнено scroll-behavior: smooth
export function scrollToTopNow() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}