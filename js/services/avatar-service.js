import { supabase } from './supabase.js';

// ===== Аватарки гравців =====
// Файл → Supabase Storage (бакет avatars, папка {userId}/), посилання на нього → users.avatar_url.
// Схема БД і політики — у supabase-avatars.sql. Тут: стиснення картинки, завантаження/видалення і кеш посилань за id гравця.

const BUCKET = 'avatars';
const PUBLIC_PATH = `/storage/v1/object/public/${BUCKET}/`;
const OUTPUT_SIZE = 256;               // аватарка зберігається квадратом 256×256
const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // вихідний файл, який гравець вибирає (стискається ще до відправки)

// userId -> url | null (null = у гравця немає аватарки). Відсутній ключ = ще не запитували.
const cache = new Map();

// Показуємо лише картинки з власного бакета (на випадок, якщо в БД опинилося щось стороннє)
export function isSafeAvatarUrl(url) {
  return typeof url === 'string' && url.startsWith('https://') && url.includes(PUBLIC_PATH);
}

export function hasCachedAvatar(userId) {
  return cache.has(userId);
}

export function getCachedAvatar(userId) {
  return cache.get(userId) || null;
}

// Підтягує аватарки для списку гравців ОДНИМ запитом (лише тих, яких ще немає в кеші).
// Повертає кількість щойно завантажених id — викликач за потреби перемальовує інтерфейс. Ніколи не кидає помилку.
export async function fetchAvatars(userIds) {
  const missing = [...new Set((userIds || []).filter(id => id && !cache.has(id)))];
  if (!missing.length) return 0;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, avatar_url')
      .in('id', missing);
    if (error) throw error;

    missing.forEach(id => cache.set(id, null));
    (data || []).forEach(row => {
      if (isSafeAvatarUrl(row.avatar_url)) cache.set(row.id, row.avatar_url);
    });
    return missing.length;
  } catch (err) {
    // Не кешуємо помилку — наступна спроба спробує ще раз; інтерфейс тим часом показує літери
    console.error('Не вдалося завантажити аватарки:', err);
    return 0;
  }
}

// ===== Підготовка картинки =====

async function loadImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch (e) { /* падаємо на запасний варіант нижче */ }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Не вдалося прочитати зображення')); };
    img.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Центральна квадратна обрізка → 256×256 → webp (або jpeg, якщо браузер не вміє webp).
// Перекодування прибирає метадані (EXIF, геолокацію) і будь-який «зайвий» вміст файла.
async function processImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Оберіть файл із зображенням');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Файл завеликий (максимум 10 МБ)');

  const source = await loadImage(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  if (!width || !height) throw new Error('Не вдалося прочитати зображення');

  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10121a'; // фон під прозорі PNG/GIF
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  if (typeof source.close === 'function') source.close();

  let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
    ext = 'jpg';
  }
  if (!blob) throw new Error('Не вдалося обробити зображення');
  return { blob, ext };
}

// ===== Завантаження і видалення =====

function pathFromUrl(url) {
  if (!isSafeAvatarUrl(url)) return null;
  const rest = url.split(PUBLIC_PATH)[1];
  return rest ? decodeURIComponent(rest) : null;
}

// Видалення старого файла — «найкращі зусилля»: збій не повинен ламати успішну заміну аватарки
async function removeFileByUrl(url, exceptPath) {
  const path = pathFromUrl(url);
  if (!path || path === exceptPath) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch (err) {
    console.error('Не вдалося видалити стару аватарку зі сховища:', err);
  }
}

async function getStoredUrl(userId) {
  const { data } = await supabase.from('users').select('avatar_url').eq('id', userId).maybeSingle();
  return data?.avatar_url || null;
}

// Стискає вибраний файл, вантажить у Storage, записує посилання в users і лише потім прибирає попередній файл.
// Повертає нову адресу. Кидає Error з текстом, придатним для показу гравцю.
export async function uploadAvatar(userId, file) {
  const { blob, ext } = await processImage(file);
  const previousUrl = await getStoredUrl(userId);

  // Ім'я файла щоразу нове — інакше браузери показували б стару картинку зі свого кешу
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type,
    cacheControl: '31536000',
    upsert: false
  });
  if (uploadError) throw new Error('Не вдалося завантажити файл. Спробуйте ще раз');

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  // update, а не upsert: рядок гравця в users уже існує, а нового ми тут створювати не хочемо.
  // select('id') дає змогу помітити випадок, коли політика RLS мовчки не дозволила запис (0 рядків без помилки)
  const { data: updated, error: dbError } = await supabase.from('users').update({ avatar_url: url }).eq('id', userId).select('id');
  if (dbError || !updated?.length) {
    await supabase.storage.from(BUCKET).remove([path]); // не лишаємо «осиротілий» файл
    console.error('Не вдалося зберегти посилання на аватарку:', dbError);
    throw new Error('Не вдалося зберегти аватарку. Спробуйте ще раз');
  }

  await removeFileByUrl(previousUrl, path);
  cache.set(userId, url);
  return url;
}

export async function removeAvatar(userId) {
  const previousUrl = await getStoredUrl(userId);

  const { data: updated, error } = await supabase.from('users').update({ avatar_url: null }).eq('id', userId).select('id');
  if (error || !updated?.length) {
    console.error('Не вдалося видалити аватарку:', error);
    throw new Error('Не вдалося видалити аватарку. Спробуйте ще раз');
  }

  await removeFileByUrl(previousUrl);
  cache.set(userId, null);
}
