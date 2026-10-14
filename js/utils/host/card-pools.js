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
// Де в players_state лежить картка гравця і яке поле містить її назву (збігається з pack_cards.value)
const PLAYER_CARD_FIELDS = {
  profession: { field: 'professions', titleKey: 'title' },
  hobby:      { field: 'hobbies',     titleKey: 'title' },
  health:     { field: 'health',      titleKey: 'disease' }
};

// player — запис гравця з players_state (або null/undefined, напр. «Для всіх»: тоді лише стандартні стадії).
// Список стадій індивідуальний: default_stages + meta.stages ЛИШЕ тієї картки, якою зараз володіє гравець
// (changeExperience/changeDiseaseSeverity змінюють саме першу картку слота, тому дивимось на неї).
export async function getStageOptions(player = null) {
  const pools = await loadPools();
  const stages = pools.config?.default_stages || {};
  // У випадаючі списки йдуть лише назви: стадії можуть бути масивом об'єктів { name, up_to_months } або старим масивом рядків (getStageNames)
  const build = (key) => {
    const names = [...getStageNames(stages[key])];
    const { field, titleKey } = PLAYER_CARD_FIELDS[key];
    const owned = player?.[field];
    const current = Array.isArray(owned) ? owned.find(c => c && !c.isEmpty) : (owned && !owned.isEmpty ? owned : null);
    const title = current?.[titleKey];
    if (title) {
      const poolCard = (pools.character?.[key] || []).find(c => c.value === title);
      names.push(...getStageNames(poolCard?.meta?.stages));
    }
    return [...new Set(names)]; // без дублікатів, стандартні їдуть першими
  };
  return {
    profession: build('profession'),
    hobby: build('hobby'),
    health: build('health')
  };
}
