/**
 * Сервіс для збереження та завантаження локальних файлів реплеїв (.bunker).
 * Забезпечує легке маскування (Base64 + XOR) та контрольну суму цілісності (FNV-1a),
 * щоб файл не можна було просто змінити у звичайному текстовому редакторі.
 */

const REPLAY_HEADER = 'TBRP1';
export const REPLAY_STORAGE_KEY = 'truebunker_offline_replay_payload_v1';
export const OFFLINE_REPLAY_HASH = '#/game?mode=offline_replay';

// ===== I-8: перевірка структури реплею =====
// XOR + FNV-1a з публічним ключем — це маскування, а не захист: хто знає схему, перерахує суму для підробленого JSON.
// Тому структура кімнати перевіряється окремо і при читанні файлу, і перед записом у sessionStorage.
const REPLAY_MAX_PLAYERS = 100;
const REPLAY_MAX_DEPTH = 24;
const REPLAY_MAX_JSON_LENGTH = 4_000_000; // sessionStorage ~5 МБ
const REPLAY_ROOM_CODE_RE = /^[\p{L}\p{N}_-]{1,32}$/u;
const REPLAY_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function findStructuralProblem(value, depth = 0) {
  if (depth > REPLAY_MAX_DEPTH) return 'надто глибока вкладеність даних';
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = findStructuralProblem(item, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (REPLAY_FORBIDDEN_KEYS.has(key)) return 'заборонені ключі в даних';
      const problem = findStructuralProblem(value[key], depth + 1);
      if (problem) return problem;
    }
  }
  return null;
}

/**
 * Перевіряє, що payload схожий на рядок таблиці rooms. Невідомі поля не відкидаємо (формат може розширюватись).
 * @param {unknown} payload
 * @returns {string|null} опис проблеми (без вмісту даних) або null, якщо структура коректна
 */
export function validateReplayPayload(payload) {
  if (!isPlainObject(payload)) return 'дані гри мають бути об’єктом';

  const structural = findStructuralProblem(payload);
  if (structural) return structural;

  const code = payload.room_code;
  if (code != null && (typeof code !== 'string' || !REPLAY_ROOM_CODE_RE.test(code))) return 'некоректний код кімнати';

  if (payload.status != null && (typeof payload.status !== 'string' || payload.status.length > 32)) {
    return 'некоректний статус кімнати';
  }

  const players = payload.players_state;
  if (!isPlainObject(players)) return 'відсутній або некоректний список гравців';
  const ids = Object.keys(players);
  if (ids.length > REPLAY_MAX_PLAYERS) return 'забагато гравців';
  for (const id of ids) {
    const player = players[id];
    if (!isPlainObject(player)) return 'некоректні дані гравця';
    if (player.name != null && (typeof player.name !== 'string' || player.name.length > 64)) return 'некоректне ім’я гравця';
    if (player.special_abilities != null && !Array.isArray(player.special_abilities)) return 'некоректні спецможливості гравця';
  }

  if (payload.bunker_state != null && !isPlainObject(payload.bunker_state)) return 'некоректний стан бункера';
  return null;
}

// Маска для обфускації (TrueBunker Replay Signature)
const MASK_KEY = [0x54, 0x72, 0x75, 0x65, 0x42, 0x75, 0x6e, 0x6b, 0x65, 0x72, 0x32, 0x36];

/**
 * 32-бітний хеш FNV-1a для перевірки цілісності вмісту.
 * @param {string} str
 * @returns {string} 8-значний hex-рядок
 */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Кодує об'єкт гри у захищений рядок файлу .bunker.
 * @param {object} payload - стан кімнати (roomData)
 * @returns {string}
 */
export function encodeReplayData(payload) {
  const container = {
    format: 'truebunker-replay',
    v: 1,
    savedAt: Date.now(),
    roomCode: payload.room_code || 'ROOM',
    payload
  };

  const jsonStr = JSON.stringify(container);
  const checksum = fnv1a(jsonStr);

  // Кодуємо UTF-8 в байти
  const utf8Bytes = new TextEncoder().encode(jsonStr);

  // XOR-маскування
  const masked = new Uint8Array(utf8Bytes.length);
  for (let i = 0; i < utf8Bytes.length; i++) {
    masked[i] = utf8Bytes[i] ^ MASK_KEY[i % MASK_KEY.length];
  }

  // Base64
  let binary = '';
  for (let i = 0; i < masked.length; i++) {
    binary += String.fromCharCode(masked[i]);
  }
  const base64 = btoa(binary);

  return `${REPLAY_HEADER}.${checksum}.${base64}`;
}

/**
 * Декодує та перевіряє цілісність файлу .bunker.
 * Кидає помилку, якщо файл пошкоджено або змінено.
 * @param {string} rawContent
 * @returns {object} розпакований roomData
 */
export function decodeReplayData(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('Файл запису порожній або має невірний тип');
  }

  const parts = rawContent.trim().split('.');
  if (parts.length !== 3 || parts[0] !== REPLAY_HEADER) {
    throw new Error('Невідомий або застарілий формат файлу гри');
  }

  const [_, expectedChecksum, base64] = parts;

  let binary;
  try {
    binary = atob(base64);
  } catch (e) {
    throw new Error('Файл запису пошкоджено (помилка Base64)');
  }

  const masked = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    masked[i] = binary.charCodeAt(i);
  }

  // Демаскування XOR
  const unmasked = new Uint8Array(masked.length);
  for (let i = 0; i < masked.length; i++) {
    unmasked[i] = masked[i] ^ MASK_KEY[i % MASK_KEY.length];
  }

  const jsonStr = new TextDecoder().decode(unmasked);
  const actualChecksum = fnv1a(jsonStr);

  if (actualChecksum !== expectedChecksum) {
    throw new Error('Файл запису пошкоджено або несанкціоновано змінено (невідповідність контрольної суми)');
  }

  let container;
  try {
    container = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Помилка структури даних у файлі запису');
  }

  if (container.format !== 'truebunker-replay' || !container.payload) {
    throw new Error('Файл не є дійсним записом гри TrueBunker');
  }

  const schemaError = validateReplayPayload(container.payload);
  if (schemaError) {
    throw new Error(`Файл запису має некоректну структуру: ${schemaError}`);
  }

  return container.payload;
}

/**
 * Завантажує стан гри у вигляді файлу на диск користувача.
 * @param {object} roomData
 */
export function exportGameReplay(roomData) {
  if (!roomData) throw new Error('Дані гри відсутні');

  const encoded = encodeReplayData(roomData);
  const blob = new Blob([encoded], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const roomCode = (roomData.room_code || 'GAME').toUpperCase();
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fileName = `bunker-replay-${roomCode}-${dateStr}.bunker`;

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Читає вибраний користувачем файл .bunker з диска.
 * @param {File} file
 * @returns {Promise<object>} roomData
 */
export async function readReplayFile(file) {
  if (!file) throw new Error('Файл не вибрано');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = decodeReplayData(e.target.result);
        resolve(payload);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Не вдалося прочитати файл з диска'));
    reader.readAsText(file);
  });
}

/**
 * Запускає режим офлайн-перегляду катки через sessionStorage.
 * @param {object} roomData
 */
export function launchOfflineReplay(roomData) {
  if (!roomData) throw new Error('Дані гри відсутні');

  const schemaError = validateReplayPayload(roomData);
  if (schemaError) {
    throw new Error(`Дані гри мають некоректну структуру: ${schemaError}`);
  }
  if (JSON.stringify(roomData).length > REPLAY_MAX_JSON_LENGTH) {
    throw new Error('Запис гри завеликий для перегляду в браузері');
  }

  // Гарантуємо статус закритої кімнати для режиму глядача
  const safeRoom = {
    ...roomData,
    status: 'closed'
  };

  try {
    sessionStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(safeRoom));
  } catch (err) {
    throw new Error('Не вдалося зберегти сесію перегляду у браузері');
  }

  window.location.hash = OFFLINE_REPLAY_HASH;
}

