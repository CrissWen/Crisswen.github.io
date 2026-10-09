import { supabase } from '../../services/supabase.js';
import { getStageNames } from '../experience.js';

// ===== Пул карток пака (pack_cards) =====
// poolCache — стан модуля: пул вантажиться один раз за сесію, далі віддається з кешу.

let poolCache = null;

export async function loadPools() {
  if (poolCache) return poolCache;

  const { data: pack, error: packError } = await supabase
    .from('packs').select('id, config').eq('title', 'default').single();
  if (packError || !pack) throw new Error('Не вдалося завантажити конфігурацію пака');

  const { data: rows, error: rowsError } = await supabase
    .from('pack_cards').select('pool_type, category, value, meta').eq('pack_id', pack.id);
  if (rowsError || !rows) throw new Error('Не вдалося завантажити картки пака');

  const pools = { bunker: {}, character: {}, config: pack.config || {} };
  rows.forEach(row => {
    const bucket = pools[row.pool_type];
    if (!bucket) return;
    if (!bucket[row.category]) bucket[row.category] = [];
    bucket[row.category].push({ value: row.value, meta: row.meta || {} });
  });

  poolCache = pools;
  return pools;
}

// Стадії (стаж професії, ступінь хвороби, рівень хобі) для випадаючих списків панелі
export async function getStageOptions() {
  const pools = await loadPools();
  const stages = pools.config?.default_stages || {};
  // У випадаючі списки йдуть лише назви: професія/хобі можуть бути масивом об'єктів { name, up_to_months } або старим масивом рядків
  return {
    profession: getStageNames(stages.profession),
    hobby: getStageNames(stages.hobby),
    health: getStageNames(stages.health)
  };
}
