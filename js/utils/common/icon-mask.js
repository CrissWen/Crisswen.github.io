// Іконка з SVG-файлу, пофарбована в поточний колір тексту (currentColor) — так само, як інші іконки проєкту
// (mask-image замість <img>, щоб файл не мав власного кольору й підхоплював тему, hover і фокус).
// Шляхи беріть з js/constants/icons.js. Стилі `.ui-icon` — у css/footer.css.

import { esc } from './escape-html.js';

export function maskIcon(path, { size = 16, className = '' } = {}) {
  if (!path) return '';
  const url = esc(path);
  const cls = className ? ` ${esc(className)}` : '';
  return `<span class="ui-icon${cls}" style="--icon-size:${Number(size) || 16}px;-webkit-mask-image:url('${url}');mask-image:url('${url}');" aria-hidden="true"></span>`;
}
