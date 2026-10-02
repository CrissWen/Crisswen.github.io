import { supabase } from './supabase.js';
import { buildSavePayload, cardToLine, extraMetaOf, cataclysmFromRow } from '../utils/pack-payload.js';

// ===== Сховище паків (Supabase: таблиці packs, pack_cards, RPC save_personal_pack) =====
// Форма пака для сторінок: { id, title, description, authorName, isDefault, isOwn, cards, config }
//   isOwn — пак належить поточному користувачу (лише такі паки можна редагувати/видаляти; дефолтний — ніколи). Це лише зручність UI:
//   справжню перевірку авторства роблять RPC save_personal_pack / delete_personal_pack у БД (auth.uid()).
//   cards — { [category]: string[] } (лише в getPack): рядки у форматі редактора ("Професія - Можливість" тощо), config — packs.config (лише в getPack)
//   cataclysms — масив записів катаклізмів (форма в pack-payload.js: cataclysmFromRow), extraMeta — додаткова meta решти карток

export const DEFAULT_PACK_ID = '16ea0906-5874-4471-aa38-aef1513e82c6';
export const DEFAULT_PACK_LABEL = 'Базовий пак';

// Назва пака для інтерфейсу. Дефолтний у БД зветься 'default' (системна назва), тож для людей підписуємо його "Базовий пак".
// Порожній packId (кімната створена до міграції або пак видалено) теж означає дефолтний.
export function packDisplayName(packId, title) {
  if (!packId || packId === DEFAULT_PACK_ID) return DEFAULT_PACK_LABEL;
  return title || 'Особистий пак';
}

const PAGE_SIZE = 1000; // ліміт рядків за один запит Supabase за замовчуванням
const MAX_PAGES = 20;

async function currentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Ви не авторизовані');
  return user;
}

const usernameOf = user => user.user_metadata?.username || 'Гравець';

// 3.1: паки поточного користувача АБО дефолтний. Дефолтний завжди першим, далі за назвою.
export async function listPacks() {
  const user = await currentUser();

  const { data, error } = await supabase
    .from('packs')
    .select('id, title, description, author_id')
    .or(`author_id.eq.${user.id},id.eq.${DEFAULT_PACK_ID}`);
  if (error) throw new Error(error.message);

  return (data || [])
    .map(row => {
      const isDefault = row.id === DEFAULT_PACK_ID;
      const isOwn = !isDefault && row.author_id === user.id;
      return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        authorName: isDefault ? 'Система' : (isOwn ? usernameOf(user) : 'Невідомо'),
        isDefault,
        isOwn
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.title.localeCompare(b.title, 'uk'));
}

// Конфіг дефолтного пака — основа для config нового пака: рушій вимагає default_stages, age_range, height_range тощо
export async function getDefaultPackConfig() {
  const { data, error } = await supabase
    .from('packs').select('config').eq('id', DEFAULT_PACK_ID).single();
  if (error || !data) throw new Error('Не вдалося завантажити налаштування дефолтного пака');
  return data.config || {};
}

async function fetchAllCards(packId) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('pack_cards')
      .select('category, value, meta')
      .eq('pack_id', packId)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Повертає null, якщо пака немає, і { forbidden: true }, якщо він чужий (відкрити в редакторі можна лише власний)
export async function getPack(id) {
  const user = await currentUser();

  const { data, error } = await supabase
    .from('packs')
    .select('id, title, description, author_id, config')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const isDefault = data.id === DEFAULT_PACK_ID;
  if (!isDefault && data.author_id !== user.id) return { forbidden: true };

  const cards = {};
  const cataclysms = []; // катаклізми — окремі записи з полями (назва, опис, таймер, час перебування, популяція), а не рядки тексту
  const extraMeta = {}; // { [category]: { [value]: поля meta, яких немає в рядку редактора: custom_age, stages... } }
  if (!isDefault) {
    for (const row of await fetchAllCards(id)) {
      if (row.category === 'cataclysm') {
        cataclysms.push(cataclysmFromRow(row));
        continue;
      }
      // meta (можливість професії) згортаємо назад у рядок редактора,
      // а решту полів meta тримаємо окремо і повертаємо при збереженні (buildCardRows), інакше "Оновити пак" замінив б їх порожнім
      (cards[row.category] ||= []).push(cardToLine(row.category, row.value, row.meta));
      const extra = extraMetaOf(row.category, row.meta);
      if (extra) (extraMeta[row.category] ||= {})[row.value] = extra;
    }
  }

  return {
    id: data.id,
    title: data.title,
    description: data.description || '',
    authorName: isDefault ? 'Система' : usernameOf(user),
    isDefault,
    isOwn: !isDefault,
    cards,
    cataclysms,
    extraMeta,
    config: data.config || {}
  };
}

// 3.5: збирає payload і викликає RPC. Пак і всі картки зберігаються однією транзакцією на стороні БД.
// cards — рядки pack_cards: [{ pool_type, category, value, meta }]; повертає id збереженого пака.
export async function savePack({ id, title, description, config, cards }) {
  const user = await currentUser();
  const packId = id || crypto.randomUUID();
  if (packId === DEFAULT_PACK_ID) throw new Error('Дефолтний пак змінювати не можна');

  const payload = buildSavePayload({
    packId,
    authorId: user.id,
    title,
    description,
    config,
    cardRows: cards
  });

  const { error } = await supabase.rpc('save_personal_pack', payload);
  if (error) {
    if (error.code === 'PGRST202') {
      throw new Error('У базі немає функції save_personal_pack. Виконайте supabase/migrations/01_personal_packs_stage1.sql');
    }
    throw new Error(error.message); // текст помилки доступу (RAISE EXCEPTION у БД) показуємо як є
  }
  return packId;
}

// Видалення особистого пака — через RPC delete_personal_pack (SECURITY DEFINER): вона сама перевіряє, що auth.uid() — автор пака,
// і видаляє пак разом із картками. Прямий DELETE у таблицю блокувала RLS.
export async function deletePack(id) {
  if (id === DEFAULT_PACK_ID) throw new Error('Дефолтний пак видаляти не можна');

  const { error } = await supabase.rpc('delete_personal_pack', { p_pack_id: id });
  if (error) {
    if (error.code === 'PGRST202') {
      throw new Error('У базі немає функції delete_personal_pack. Виконайте SQL із ТЗ (частина 1.1)');
    }
    throw new Error(error.message);
  }
}

// Вибір пака гри в кімнаті очікування (лише ведучий). Пишемо тільки selected_pack_id: назву в selected_pack_title, перевірку
// власності та заборону зміни після старту робить тригер в БД (02_room_selected_pack_stage4.sql). Рівно цей UPDATE через
// Realtime миттєво доставляє новий пак усім гравцям кімнати.
export async function selectRoomPack(roomCode, packId) {
  const { data, error } = await supabase
    .from('rooms')
    .update({ selected_pack_id: packId })
    .eq('room_code', roomCode)
    .select('selected_pack_id');
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') {
      throw new Error('У базі немає поля selected_pack_id. Виконайте supabase/migrations/02_room_selected_pack_stage4.sql');
    }
    throw new Error(error.message);
  }
  // RLS може мовчки нічого не оновити (не ведучий) — це помилка, а не успіх
  if (!data || data.length === 0) throw new Error('Не вдалося змінити пак: немає доступу');
}
