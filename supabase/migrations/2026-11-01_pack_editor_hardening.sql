-- =============================================================================
-- МІГРАЦІЯ STAGE 2: ХАРДЕНІНГ РЕДАКТОРА ПАКІВ (I-8, E-C1)
-- Дата: 2026-11-01
-- Опис:
--   1. Додає серверну перевірку ліміту особистих паків (максимум 3 на автора)
--      безпосередньо в RPC `save_personal_pack` перед INSERT нового пака.
--   2. Додає базові обмеження довжини `title` (<= 100), `description` (<= 255)
--      та `card->>'value'` (<= 300) у `save_personal_pack` і `save_default_pack`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.save_personal_pack(
  p_pack_id uuid,
  p_author_id uuid,
  p_title text,
  p_description text,
  p_config jsonb,
  p_cards jsonb,
  p_delete_card_ids uuid[] DEFAULT '{}'::uuid[],
  p_expected_version integer DEFAULT NULL::integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_default_pack CONSTANT uuid := '16ea0906-5874-4471-aa38-aef1513e82c6';
  c_max_packs    CONSTANT int  := 3;
  c_max_cards    CONSTANT int  := 2000;
  v_uid          uuid := auth.uid();
  v_title        text := btrim(p_title);
  v_desc         text := btrim(COALESCE(p_description, ''));
  v_pack_id      uuid := p_pack_id;
  v_owner        uuid;
  v_version      int;
  v_updated_at   timestamptz;
  v_cards_count  int;
  v_packs_count  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Потрібна авторизація';
  END IF;
  IF p_author_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Не можна зберігати пак від імені іншого користувача';
  END IF;
  IF v_pack_id = c_default_pack THEN
    RAISE EXCEPTION 'Цей пак не можна змінювати';
  END IF;
  IF v_pack_id IS NULL THEN
    v_pack_id := gen_random_uuid();
  END IF;

  IF v_title IS NULL OR v_title = '' THEN
    RAISE EXCEPTION 'Назва пака не може бути порожньою';
  END IF;
  IF char_length(v_title) > 100 THEN
    RAISE EXCEPTION 'Назва пака не може перевищувати 100 символів';
  END IF;
  IF char_length(v_desc) > 255 THEN
    RAISE EXCEPTION 'Опис пака не може перевищувати 255 символів';
  END IF;
  IF lower(v_title) IN ('default', 'дефолт') THEN
    RAISE EXCEPTION 'Назва «default» зарезервована системою';
  END IF;

  IF p_cards IS NOT NULL AND jsonb_typeof(p_cards) <> 'array' THEN
    RAISE EXCEPTION 'p_cards має бути JSON-масивом';
  END IF;
  IF p_cards IS NOT NULL AND jsonb_array_length(p_cards) > c_max_cards THEN
    RAISE EXCEPTION 'Забагато карток (максимум %)', c_max_cards;
  END IF;

  -- Блокуємо рядок пака на час збереження: два одночасні збереження виконуються по черзі
  SELECT author_id, COALESCE(version, 1) INTO v_owner, v_version
  FROM packs WHERE id = v_pack_id FOR UPDATE;

  IF FOUND THEN
    IF v_owner IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Цей пак належить іншому автору';
    END IF;
    IF p_expected_version IS NOT NULL AND p_expected_version <> v_version THEN
      RAISE EXCEPTION 'VERSION_CONFLICT: Пак змінено на іншому пристрої (сервер: %, ваша версія: %)', v_version, p_expected_version;
    END IF;
    UPDATE packs
       SET title = v_title,
           description = v_desc,
           config = COALESCE(p_config, '{}'::jsonb),
           version = v_version + 1,
           updated_at = now()
     WHERE id = v_pack_id
     RETURNING version, updated_at INTO v_version, v_updated_at;
  ELSE
    -- Серверна перевірка ліміту особистих паків (I-8): максимум 3 паки на користувача
    PERFORM pg_advisory_xact_lock(hashtext('save_personal_pack_' || v_uid::text));
    SELECT count(*) INTO v_packs_count
      FROM packs
     WHERE author_id = v_uid
       AND id <> c_default_pack;

    IF v_packs_count >= c_max_packs THEN
      RAISE EXCEPTION 'Можна створити щонайбільше % особисті паки. Видаліть один із існуючих, щоб створити новий', c_max_packs;
    END IF;

    INSERT INTO packs (id, author_id, title, description, config, version, updated_at)
    VALUES (v_pack_id, v_uid, v_title, v_desc, COALESCE(p_config, '{}'::jsonb), 1, now())
    RETURNING version, updated_at INTO v_version, v_updated_at;
  END IF;

  -- Точкове видалення
  IF p_delete_card_ids IS NOT NULL AND array_length(p_delete_card_ids, 1) > 0 THEN
    DELETE FROM pack_cards WHERE pack_id = v_pack_id AND id = ANY(p_delete_card_ids);
  END IF;

  -- Точковий UPSERT
  IF p_cards IS NOT NULL AND jsonb_array_length(p_cards) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS card
      WHERE card->>'pool_type' IS NULL
         OR card->>'category'  IS NULL
         OR btrim(COALESCE(card->>'value', '')) = ''
         OR char_length(btrim(COALESCE(card->>'value', ''))) > 300
    ) THEN
      RAISE EXCEPTION 'Кожна картка мусить мати pool_type, category і непорожнє value (до 300 символів)';
    END IF;

    INSERT INTO pack_cards (id, pack_id, pool_type, category, value, meta)
    SELECT
      COALESCE((card->>'id')::uuid, gen_random_uuid()),
      v_pack_id,
      (card->>'pool_type')::pool_type_enum,
      (card->>'category')::card_category_enum,
      card->>'value',
      COALESCE(card->'meta', '{}'::jsonb)
    FROM jsonb_array_elements(p_cards) AS card
    ON CONFLICT (id) DO UPDATE
      SET value     = EXCLUDED.value,
          meta      = EXCLUDED.meta,
          category  = EXCLUDED.category,
          pool_type = EXCLUDED.pool_type
      WHERE pack_cards.pack_id = v_pack_id; -- чужу картку (id з іншого пака) перезаписати не можна
  END IF;

  SELECT count(*) INTO v_cards_count FROM pack_cards WHERE pack_id = v_pack_id;
  IF v_cards_count > c_max_cards THEN
    RAISE EXCEPTION 'Перевищено ліміт карток у паку: % (максимум %)', v_cards_count, c_max_cards;
  END IF;

  RETURN jsonb_build_object(
    'pack_id', v_pack_id,
    'version', v_version,
    'updated_at', v_updated_at,
    'cards_count', v_cards_count,
    'status', 'success'
  );
END;
$function$;

