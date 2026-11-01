import { isAllowedImageFormat, loadImage } from '../utils/image-file.js';
import { supabase, supabaseUrl } from './supabase.js';

// ===== Аватарки гравців =====
// Файл → Supabase Storage (бакет avatars, папка {userId}/), посилання на нього → users.avatar_url.
// Схема БД і політики — у supabase-avatars.sql. Тут: стиснення картинки, завантаження/видалення і кеш посилань за id гравця.

const BUCKET = 'avatars';
const PUBLIC_PATH = `/storage/v1/object/public/${BUCKET}/`;
const OUTPUT_SIZE = 256;               // аватарка зберігається квадратом 256×256
const MAX_SOURCE_BYTES = 30 * 1024 * 1024; // вихідний файл, який гравець вибирає (до 30 МБ, оптимізується на клієнті)

// Постійний кеш аватарок у localStorage (Stale-While-Revalidate).
// Картинка малюється з кешу миттєво (0 мс), але якщо з моменту останньої звірки минуло більше STALE_AFTER_MS,
// у фоні тихо робиться запит до БД для перевірки заміни з іншого пристрою.
const AVATAR_STORAGE_KEY = 'bunker_avatars_cache_v1';
const STALE_AFTER_MS     = 10 * 60 * 1000; // 10 хвилин свіжості (протягом цього часу до БД не звертаємось)
const TTL_AVATAR_MS      = 7 * 24 * 60 * 60 * 1000; // 7 днів для зберігання в localStorage
const TTL_NULL_MS        = 2 * 60 * 60 * 1000;      // 2 години для гравців без аватарки
const MAX_PERSISTED_ITEMS = 150;

// userId -> { url: string | null, ts: number }
const cache = new Map();

const SUPABASE_ORIGIN = new URL(supabaseUrl).origin;
const DOT_SEGMENT_RE = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|\?|#|$)/i;

// Показуємо лише картинки з власного бакета нашого Supabase-інстансу (на випадок, якщо в БД опинилося щось стороннє).
// Перевіряємо саме origin, а не підрядок: інакше https://evil.com/storage/v1/object/public/avatars/x.png змусив би
// усіх гравців слати запити на чужий сервер. Якщо передано userId — файл має лежати у його власній папці.
export function isSafeAvatarUrl(url, userId) {
  if (typeof url !== 'string' || DOT_SEGMENT_RE.test(url)) return false;
  let parsed;
  try { parsed = new URL(url); } catch (e) { return false; }
  if (parsed.protocol !== 'https:' || parsed.origin !== SUPABASE_ORIGIN) return false;
  if (parsed.username || parsed.password) return false;
  if (!parsed.pathname.startsWith(PUBLIC_PATH)) return false;
  let rest;
  try { rest = decodeURIComponent(parsed.pathname.slice(PUBLIC_PATH.length)); } catch (e) { return false; }
  const segments = rest.split('/');
  if (segments.length < 2 || segments.some(s => !s)) return false;
  if (userId && segments[0] !== userId) return false;
  return true;
}

function loadPersistentCache() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(AVATAR_STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const now = Date.now();
    for (const [userId, item] of Object.entries(parsed)) {
      if (!userId || !item || typeof item !== 'object') continue;
      const { url, ts } = item;
      const maxAge = url ? TTL_AVATAR_MS : TTL_NULL_MS;
      if (typeof ts === 'number' && (now - ts < maxAge)) {
        if (url === null || isSafeAvatarUrl(url, userId)) {
          cache.set(userId, { url, ts });
        }
      }
    }
  } catch (err) {
    console.warn('Не вдалося завантажити кеш аватарок:', err);
  }
}

function savePersistentCache() {
  try {
    if (typeof localStorage === 'undefined') return;
    const entries = [...cache.entries()]
      .sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0))
      .slice(0, MAX_PERSISTED_ITEMS);

    const obj = {};
    for (const [userId, item] of entries) {
      obj[userId] = item;
    }
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn('Не вдалося зберегти кеш аватарок:', err);
  }
}

// Завантажуємо збережений кеш одразу при старті модуля
loadPersistentCache();

function setInCache(userId, url) {
  cache.set(userId, { url: url || null, ts: Date.now() });
}

// Після невдалого запиту (немає прав, мережа) кілька секунд не пробуємо знову: інакше кожне оновлення кімнати
// чи перехід між сторінками слало б новий запит і засипало консоль однаковими помилками.
const RETRY_AFTER_MS = 60 * 1000;
let lastFailureAt = 0;

export function hasCachedAvatar(userId) {
  return cache.has(userId);
}

export function isAvatarStale(userId) {
  const item = cache.get(userId);
  if (!item) return true;
  return Date.now() - (item.ts || 0) > STALE_AFTER_MS;
}

export function getCachedAvatar(userId) {
  const item = cache.get(userId);
  return item ? (item.url || null) : null;
}

// Слухачі оновлення аватарок (UI компоненти: хедер, профіль тощо)
const avatarListeners = new Set();

export function onAvatarChange(callback) {
  if (typeof callback === 'function') avatarListeners.add(callback);
  return () => avatarListeners.delete(callback);
}

function notifyAvatarListeners(url, userId) {
  avatarListeners.forEach(fn => {
    try { fn(url, userId); } catch (e) { console.error('Помилка слухача аватарки:', e); }
  });
}

// Синхронізація між вкладками одного пристрою в реальному часі
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === AVATAR_STORAGE_KEY) {
      loadPersistentCache();
    }
  });
}

// ===== Supabase Realtime: відстеження оновлення аватарки з іншого пристрою =====
let activeAvatarChannel = null;
let activeAvatarUserId = null;

export function subscribeToUserAvatar(userId) {
  if (!userId) return () => {};
  if (activeAvatarUserId === userId && activeAvatarChannel) {
    return () => unsubscribeUserAvatar();
  }

  unsubscribeUserAvatar();
  activeAvatarUserId = userId;

  try {
    activeAvatarChannel = supabase
      .channel(`user-avatar-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`
      }, (payload) => {
        const nextUrl = payload?.new?.avatar_url;
        const safeUrl = isSafeAvatarUrl(nextUrl, userId) ? nextUrl : null;
        setInCache(userId, safeUrl);
        savePersistentCache();
        notifyAvatarListeners(safeUrl, userId);
      })
      .subscribe();
  } catch (err) {
    console.warn('Не вдалося підписатися на Realtime аватарок:', err);
  }

  return () => unsubscribeUserAvatar();
}

export function unsubscribeUserAvatar() {
  if (activeAvatarChannel) {
    try { supabase.removeChannel(activeAvatarChannel); } catch (e) {}
    activeAvatarChannel = null;
    activeAvatarUserId = null;
  }
}

// Підтягує аватарки для списку гравців ОДНИМ запитом.
// За замовчуванням запитує тільки тих, кого немає в кеші або чий запис застарів (> 10 хв).
// Якщо force=true — обов'язково перевіряє в БД навіть за наявності свіжого кешу.
// Повертає кількість змінених/нових id — викликач за потреби перемальовує інтерфейс.
export async function fetchAvatars(userIds, { force = false } = {}) {
  const missing = [...new Set((userIds || []).filter(id => {
    if (!id) return false;
    if (force) return true;
    if (!cache.has(id)) return true;
    return isAvatarStale(id);
  }))];

  if (!missing.length) return 0;
  if (Date.now() - lastFailureAt < RETRY_AFTER_MS) return 0;

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, avatar_url')
      .in('id', missing);
    if (error) throw error;

    lastFailureAt = 0;
    let changedCount = 0;
    const returnedMap = new Map();
    (data || []).forEach(row => {
      returnedMap.set(row.id, isSafeAvatarUrl(row.avatar_url, row.id) ? row.avatar_url : null);
    });

    missing.forEach(id => {
      const prevUrl = getCachedAvatar(id);
      const nextUrl = returnedMap.get(id) || null;
      if (prevUrl !== nextUrl) {
        changedCount++;
        notifyAvatarListeners(nextUrl, id);
      }
      setInCache(id, nextUrl);
    });

    savePersistentCache();
    return changedCount;
  } catch (err) {
    // Помилку не кешуємо як «аватарки немає», але наступна спроба — не раніше ніж через хвилину; інтерфейс тим часом показує кеш
    lastFailureAt = Date.now();
    console.error('Не вдалося завантажити аватарки:', err);
    return 0;
  }
}

// ===== Підготовка картинки =====


function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Центральна квадратна обрізка → 256×256 → webp (або jpeg, якщо браузер не вміє webp).
// Перекодування прибирає метадані (EXIF, геолокацію) і будь-який «зайвий» вміст файла.
async function processImage(file) {
  if (!isAllowedImageFormat(file)) throw new Error('Дозволені лише формати JPEG, PNG, WebP');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Файл завеликий (максимум 30 МБ)');

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
export async function uploadAvatar(userId, fileOrBlob) {
  let blob, ext;
  if (fileOrBlob instanceof Blob && !(fileOrBlob instanceof File) && (fileOrBlob.type === 'image/webp' || fileOrBlob.type === 'image/jpeg')) {
    blob = fileOrBlob;
    ext = fileOrBlob.type === 'image/webp' ? 'webp' : 'jpg';
  } else {
    const res = await processImage(fileOrBlob);
    blob = res.blob;
    ext = res.ext;
  }
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
  setInCache(userId, url);
  savePersistentCache();
  notifyAvatarListeners(url, userId);
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
  setInCache(userId, null);
  savePersistentCache();
  notifyAvatarListeners(null, userId);
}
