// Екранування тексту перед вставкою в innerHTML (назви/описи паків вводять користувачі).
// Перенаправляє на централізований модуль security.js.
export { esc, unescapeApos, cleanControlChars, detectHtmlInjection, renderSafeNodes } from './security.js';
