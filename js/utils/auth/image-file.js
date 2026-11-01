// ===== Утиліти для роботи з файлами зображень (аватарки, кропер) =====

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/pjpeg'
]);

/**
 * Перевіряє, чи файл є підтримуваним форматом зображення (JPEG, PNG, WebP)
 * @param {File|Blob|{type?: string, name?: string}} file
 * @returns {boolean}
 */
export function isAllowedImageFormat(file) {
  if (!file) return false;
  if (file.type && ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) return true;
  if (file.name && /\.(jpe?g|png|webp)$/i.test(file.name)) return true;
  return false;
}

/**
 * Завантажує картинку у пам'ять як ImageBitmap або HTMLImageElement.
 * Якщо вказано maxDimension (наприклад, 1920 для кропера аватарок), автоматично зменшує гігантські фото
 * з камери смартфона (наприклад, 48MP 8000x6000), захищаючи від переповнення пам'яті Canvas на мобільних.
 * @param {File|Blob} file
 * @param {{ maxDimension?: number|null }} options
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function loadImage(file, { maxDimension = null } = {}) {
  if (typeof window !== 'undefined' && window.createImageBitmap) {
    try {
      const bmp = await window.createImageBitmap(file);
      if (maxDimension && (bmp.width > maxDimension || bmp.height > maxDimension)) {
        const ratio = Math.min(maxDimension / bmp.width, maxDimension / bmp.height);
        const w = Math.round(bmp.width * ratio);
        const h = Math.round(bmp.height * ratio);
        const resized = await window.createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
        bmp.close();
        return resized;
      }
      return bmp;
    } catch {
      /* падаємо на запасний Image-варіант нижче */
    }
  }

  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      return reject(new Error('Image constructor is not supported in this environment'));
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Не вдалося відкрити файл зображення'));
    };
    img.src = objectUrl;
  });
}

