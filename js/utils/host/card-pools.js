import { supabase } from '../../services/supabase.js';
import { DEFAULT_PACK_ID } from '../../services/packs-store.js';
import { getGameConfig } from '../../config/config-manager.js';
import { applyDefaultFallback, buildRequirements, buildMinimalRequirements } from '../pack-fallback.js';

// ===== Пули карток паків (pack_cards) =====
// Формат пулу: { bunker: { [category]: [{ value, meta }] }, character: {...}, config }.
// rawCache — стан модуля: сирі (без фолбеку) пули за id пака. Дефолтний пак вантажиться один раз за сесію;
// особисті — лише при першому зверненні, а на старті гри перечитуються свіжими (автор міг відредагувати пак).

const PAGE_SIZE = 1000; // ліміт рядків за один запит Supabase за замовчуванням
const MAX_PAGES = 20;

const rawCache = new Map();

const isDefaultPack = packId => !packId || packId === DEFAULT_PACK_ID;

async function fetchRawPools(packId) {
  const { data: pack, error: packError } = await supabase
    .from('packs').select('id, config').eq('id', packId).single();
  if (packError || !pack) throw new Error('Не вдалося завантажити конфігурацію пака');

  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('pack_cards')
      .select('pool_type, category, value, meta')
      .eq('pack_id', packId)
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) throw new Error('Не вдалося завантажити картки пака');
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  const pools = { bunker: {}, character: {}, config: pack.config || {} };
  rows.forEach(row => {
    const bucket = pools[row.pool_type];
    if (!bucket) return;
    if (!bucket[row.category]) bucket[row.category] = [];
    bucket[row.category].push({ value: row.value, meta: row.meta || {} });
  });
  return pools;
}

async function getRawPools(packId, { fresh = false } = {}) {
  if (!fresh && rawCache.has(packId)) return rawCache.get(packId);
  const pools = await fetchRawPools(packId);
  rawCache.set(packId, pools);
  return pools;
}

// Пули для дій ведучого посеред гри (перерол характеристик, зміна бункера тощо).
// packId — rooms.selected_pack_id; null/дефолтний → дефолтний пак. Для особистого пака порожні категорії
// добираються з дефолтного (мінімум по одній картці), щоб перерол не видавав «Немає даних».
// Якщо особистий пак не вдалося прочитати (наприклад, ведучим став не його автор), мовчки працюємо на дефолтному.
export async function loadPools(packId = null) {
  const defaults = await getRawPools(DEFAULT_PACK_ID);
  if (isDefaultPack(packId)) return defaults;

  try {
    const own = await getRawPools(packId);
    return applyDefaultFallback(own, defaults, buildMinimalRequirements()).pools;
  } catch (err) {
    console.warn('Особистий пак недоступний, використовується базовий:', err);
    return defaults;
  }
}

// Пули для старту гри на playersCount гравців. Повертає { pools, added }, де added — що саме було
// добрано з дефолтного пака (див. pack-fallback.js) — стартує навіть мінімальний особистий пак.
// На відміну від loadPools, помилку читання особистого пака НЕ ховаємо: ведучий має знати, що гра піде не за його паком.
export async function loadGamePools(packId, playersCount) {
  const defaults = await getRawPools(DEFAULT_PACK_ID);
  if (isDefaultPack(packId)) return { pools: defaults, added: [] };

  let own;
  try {
    own = await getRawPools(packId, { fresh: true });
  } catch (err) {
    console.error('Не вдалося завантажити обраний пак:', err);
    throw new Error('Не вдалося завантажити картки обраного пака');
  }

  const bc = await getGameConfig();
  return applyDefaultFallback(own, defaults, buildRequirements(playersCount, bc));
}

// Стадії (стаж професії, ступінь хвороби, рівень хобі) для випадаючих списків панелі
export async function getStageOptions(packId = null) {
  const pools = await loadPools(packId);
  const stages = pools.config?.default_stages || {};
  return {
    profession: stages.profession || [],
    hobby: stages.hobby || [],
    health: stages.health || []
  };
}
