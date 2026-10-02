import { ALL_PACK_CATEGORIES } from './pack-categories.js';

// ===== Парсинг масового вводу та збирання payload для RPC save_personal_pack =====
// Чисті функції без DOM і мережі.

// Дзеркало c_max_cards у RPC (supabase/migrations/01_personal_packs_stage1.sql)
export const MAX_PACK_CARDS = 2000;

// Розділювач — лише розрив рядка (\n); зайві пробіли по краях і порожні рядки відкидаються.
// \r від Windows-перенесень (\r\n) прибирає trim().
export function parseLines(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(line => line !== '');
}

// texts: { [category]: string } → масив рядків pack_cards: { pool_type, category, value, meta: {} }
// meta порожня: стадії задаються глобально для пака (packs.config.default_stages), а не для кожної картки.
export function buildCardRows(texts) {
  const rows = [];
  for (const { category, poolType } of ALL_PACK_CATEGORIES) {
    for (const value of parseLines(texts?.[category])) {
      rows.push({ pool_type: poolType, category, value, meta: {} });
    }
  }
  return rows;
}

// Імена полів збігаються з параметрами SQL-функції save_personal_pack
export function buildSavePayload({ packId, authorId, title, description, config, cardRows }) {
  return {
    p_pack_id: packId,
    p_author_id: authorId,
    p_title: title,
    p_description: description,
    p_config: config,
    p_cards: cardRows
  };
}
