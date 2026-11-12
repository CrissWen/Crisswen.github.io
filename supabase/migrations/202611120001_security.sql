-- Apply as postgres in Supabase SQL Editor, together with the matching frontend.
-- Transactional: any failure rolls back all changes. No room/card/history data is deleted.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bunker_private;
REVOKE ALL ON SCHEMA bunker_private FROM PUBLIC, anon, authenticated;
ALTER TABLE public.rooms ALTER COLUMN room_code TYPE text;
ALTER TABLE public.user_game_history ALTER COLUMN room_code TYPE text;
CREATE OR REPLACE FUNCTION public.delete_personal_pack(p_pack_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_pack_id = '16ea0906-5874-4471-aa38-aef1513e82c6' THEN
    RAISE EXCEPTION 'Системний пак не можна видалити';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM packs WHERE id = p_pack_id AND author_id = auth.uid()) THEN
    RAISE EXCEPTION 'Помилка доступу: ви не є автором цього пака';
  END IF;
  DELETE FROM packs WHERE id = p_pack_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_room_lifecycle()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog
AS $function$
BEGIN
  -- Переводимо в 'closed' через 12 годин від створення
  UPDATE public.rooms
  SET status = 'closed'
  WHERE 
    status != 'closed'
    AND created_at < NOW() - INTERVAL '12 hours';
  -- Повністю видаляємо через 24 години від створення
  DELETE FROM public.rooms
  WHERE 
    created_at < NOW() - INTERVAL '24 hours';
END;
$function$
;
CREATE OR REPLACE FUNCTION bunker_private.record_game_results_impl(p_room_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_room RECORD;
  v_player_id TEXT;
  v_player JSONB;
  v_survived BOOLEAN;
  v_profession TEXT;
  v_cataclysm TEXT;
  v_bunker_json JSONB;
  v_players_json JSONB;
  v_count INT := 0;
  v_errors JSONB := '[]'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_game_history WHERE UPPER(room_code) = UPPER(p_room_code)) THEN
    RETURN jsonb_build_object('success', true, 'already_recorded', true, 'recorded_players', 0);
  END IF;
  SELECT * INTO v_room FROM public.rooms WHERE UPPER(room_code) = UPPER(p_room_code) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found: ' || p_room_code);
  END IF;
  -- НОВЕ: статистика лише для завершеної гри
  IF v_room.status IS DISTINCT FROM 'finished' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game is not finished');
  END IF;
  v_bunker_json := to_jsonb(v_room.bunker_state);
  v_players_json := to_jsonb(v_room.players_state);
  v_cataclysm := COALESCE(
    v_bunker_json->'cataclysm'->>'text',
    v_bunker_json->'cataclysm'->>'name',
    v_bunker_json->>'cataclysm_title',
    v_bunker_json->>'cataclysm',
    'Катаклізм'
  );
  IF v_players_json IS NOT NULL AND jsonb_typeof(v_players_json) = 'object' THEN
    FOR v_player_id, v_player IN SELECT * FROM jsonb_each(v_players_json)
    LOOP
      IF jsonb_typeof(v_player) = 'object' THEN
        -- ЗМІНЕНО: пройшов, лише якщо не вигнаний І живий (is_alive не false)
        v_survived := NOT COALESCE((v_player->>'is_kicked')::boolean, false)
                      AND COALESCE((v_player->>'is_alive')::boolean, true);
        v_profession := NULL;
        IF jsonb_typeof(v_player->'professions') = 'array' THEN
          SELECT string_agg(
            CASE 
              WHEN (item->>'stage') IS NOT NULL AND TRIM(item->>'stage') <> '' 
                THEN COALESCE(item->>'title', item->>'value', 'Невідома') || ' (' || TRIM(item->>'stage') || ')'
              ELSE COALESCE(item->>'title', item->>'value', 'Невідома')
            END,
            ', '
          )
          INTO v_profession
          FROM jsonb_array_elements(v_player->'professions') AS item
          WHERE item IS NOT NULL;
        ELSIF jsonb_typeof(v_player->'professions') = 'object' THEN
          v_profession := COALESCE(v_player->'professions'->>'title', v_player->'professions'->>'value');
          IF (v_player->'professions'->>'stage') IS NOT NULL AND TRIM(v_player->'professions'->>'stage') <> '' THEN
            v_profession := v_profession || ' (' || TRIM(v_player->'professions'->>'stage') || ')';
          END IF;
        ELSIF jsonb_typeof(v_player->'profession') = 'array' THEN
          SELECT string_agg(
            CASE 
              WHEN (item->>'stage') IS NOT NULL AND TRIM(item->>'stage') <> '' 
                THEN COALESCE(item->>'title', item->>'value', 'Невідома') || ' (' || TRIM(item->>'stage') || ')'
              ELSE COALESCE(item->>'title', item->>'value', 'Невідома')
            END,
            ', '
          )
          INTO v_profession
          FROM jsonb_array_elements(v_player->'profession') AS item
          WHERE item IS NOT NULL;
        ELSIF jsonb_typeof(v_player->'profession') = 'object' THEN
          v_profession := COALESCE(v_player->'profession'->>'title', v_player->'profession'->>'value');
          IF (v_player->'profession'->>'stage') IS NOT NULL AND TRIM(v_player->'profession'->>'stage') <> '' THEN
            v_profession := v_profession || ' (' || TRIM(v_player->'profession'->>'stage') || ')';
          END IF;
        ELSE
          v_profession := COALESCE(v_player->>'professions', v_player->>'profession');
        END IF;
        IF v_profession IS NULL OR TRIM(v_profession) = '' THEN
          v_profession := 'Без професії';
        END IF;
        IF v_player_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          BEGIN
            INSERT INTO public.user_game_history (
              user_id, room_code, cataclysm_title, profession_title, survived, played_at
            ) VALUES (
              v_player_id::uuid, v_room.room_code, v_cataclysm, v_profession, v_survived, now()
            );
              UPDATE public.users
              SET 
                games_played = COALESCE(games_played, 0) + 1,
                games_won = CASE WHEN v_survived THEN COALESCE(games_won, 0) + 1 ELSE COALESCE(games_won, 0) END
              WHERE id = v_player_id::uuid;
              IF NOT FOUND THEN RAISE EXCEPTION 'Профіль учасника не знайдено'; END IF;
            v_count := v_count + 1;
          EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object('player', v_player_id, 'err', SQLERRM);
          END;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'room_code', p_room_code,
    'recorded_players', v_count,
    'cataclysm', v_cataclysm,
    'errors', v_errors
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rooms_bump_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.rooms_validate_selected_pack()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_default CONSTANT UUID := '16ea0906-5874-4471-aa38-aef1513e82c6';
  v_title   TEXT;
BEGIN
  -- NULL з'являється, коли обраний пак видалили (ON DELETE SET NULL) або клієнт явно передав NULL:
  -- повертаємо дефолтний. Це дозволено навіть для гри, що вже йде, щоб видалення пака не блокувалося.
  IF NEW.selected_pack_id IS NULL THEN
    NEW.selected_pack_id := c_default;
  ELSIF TG_OP = 'UPDATE' AND NEW.selected_pack_id IS DISTINCT FROM OLD.selected_pack_id THEN
    -- Змінити пак можна лише в кімнаті очікування: після роздачі карток пак уже використано
    IF COALESCE(OLD.bunker_state, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Пак не можна змінити після старту гри';
    END IF;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.selected_pack_id IS DISTINCT FROM OLD.selected_pack_id
     OR NEW.selected_pack_title IS NULL THEN
    SELECT title INTO v_title
    FROM packs
    WHERE id = NEW.selected_pack_id
      AND (id = c_default OR author_id = auth.uid());
    IF v_title IS NULL THEN
      RAISE EXCEPTION 'Пак не знайдено або він вам не належить';
    END IF;
    NEW.selected_pack_title := v_title;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_default_pack(p_pack_id uuid, p_title text, p_description text, p_config jsonb, p_cards jsonb, p_delete_card_ids uuid[] DEFAULT '{}'::uuid[], p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_default_pack CONSTANT uuid := '16ea0906-5874-4471-aa38-aef1513e82c6';
  c_max_cards    CONSTANT int  := 2000;
  v_uid        uuid := auth.uid();
  v_title      text := btrim(p_title);
  v_version    int;
  v_updated_at timestamptz;
  v_cards_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Потрібна авторизація';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admins WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Лише адміністратори можуть змінювати базовий пак';
  END IF;
  IF p_pack_id IS DISTINCT FROM c_default_pack THEN
    RAISE EXCEPTION 'Ця функція призначена лише для базового пака';
  END IF;
  IF v_title IS NULL OR v_title = '' THEN
    RAISE EXCEPTION 'Назва пака не може бути порожньою';
  END IF;
  IF char_length(v_title) > 100 OR char_length(coalesce(p_description, '')) > 255 THEN
    RAISE EXCEPTION 'Завелика назва або опис пака';
  END IF;
  IF p_config IS NOT NULL AND (jsonb_typeof(p_config) <> 'object' OR pg_column_size(p_config) > 65536) THEN
    RAISE EXCEPTION 'Некоректна або завелика конфігурація пака';
  END IF;
  IF pg_column_size(p_cards) > 2097152 THEN RAISE EXCEPTION 'Завеликий список карток'; END IF;
  IF p_cards IS NOT NULL AND jsonb_typeof(p_cards) <> 'array' THEN
    RAISE EXCEPTION 'p_cards має бути JSON-масивом';
  END IF;
  IF p_cards IS NOT NULL AND jsonb_array_length(p_cards) > c_max_cards THEN
    RAISE EXCEPTION 'Забагато карток (максимум %)', c_max_cards;
  END IF;
  SELECT COALESCE(version, 1) INTO v_version FROM packs WHERE id = c_default_pack FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Базовий пак не знайдено';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: Пак змінено на іншому пристрої (сервер: %, ваша версія: %)', v_version, p_expected_version;
  END IF;
  UPDATE packs
     SET title = v_title,
         description = p_description,
         config = COALESCE(p_config, '{}'::jsonb),
         version = v_version + 1,
         updated_at = now()
   WHERE id = c_default_pack
   RETURNING version, updated_at INTO v_version, v_updated_at;
  IF p_delete_card_ids IS NOT NULL AND array_length(p_delete_card_ids, 1) > 0 THEN
    DELETE FROM pack_cards WHERE pack_id = c_default_pack AND id = ANY(p_delete_card_ids);
  END IF;
  IF p_cards IS NOT NULL AND jsonb_array_length(p_cards) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_cards) AS card
      WHERE card->>'pool_type' IS NULL
         OR card->>'category'  IS NULL
         OR btrim(COALESCE(card->>'value', '')) = ''
         OR char_length(card->>'value') > 300
         OR (card ? 'meta' AND jsonb_typeof(card->'meta') <> 'object')
         OR pg_column_size(card->'meta') > 16384
    ) THEN
      RAISE EXCEPTION 'Кожна картка мусить мати pool_type, category і непорожнє value';
    END IF;
    INSERT INTO pack_cards (id, pack_id, pool_type, category, value, meta)
    SELECT
      COALESCE((card->>'id')::uuid, gen_random_uuid()),
      c_default_pack,
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
      WHERE pack_cards.pack_id = c_default_pack;
  END IF;
  SELECT count(*) INTO v_cards_count FROM pack_cards WHERE pack_id = c_default_pack;
  IF v_cards_count > c_max_cards THEN
    RAISE EXCEPTION 'Перевищено ліміт карток у паку: % (максимум %)', v_cards_count, c_max_cards;
  END IF;
  RETURN jsonb_build_object(
    'pack_id', c_default_pack,
    'version', v_version,
    'updated_at', v_updated_at,
    'cards_count', v_cards_count,
    'status', 'success'
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_personal_pack(p_pack_id uuid, p_author_id uuid, p_title text, p_description text, p_config jsonb, p_cards jsonb, p_delete_card_ids uuid[] DEFAULT '{}'::uuid[], p_expected_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  IF char_length(v_title) > 100 OR char_length(coalesce(p_description, '')) > 255 THEN
    RAISE EXCEPTION 'Завелика назва або опис пака';
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
  IF p_config IS NOT NULL AND (jsonb_typeof(p_config) <> 'object' OR pg_column_size(p_config) > 65536) THEN
    RAISE EXCEPTION 'Некоректна або завелика конфігурація пака';
  END IF;
  IF pg_column_size(p_cards) > 2097152 THEN RAISE EXCEPTION 'Завеликий список карток'; END IF;
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
         OR char_length(card->>'value') > 300
         OR (card ? 'meta' AND jsonb_typeof(card->'meta') <> 'object')
         OR pg_column_size(card->'meta') > 16384
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
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_personal_pack_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- оновлення існуючого пака (upsert) ліміт не зачіпає
  if exists (select 1 from packs where id = new.id) then return new; end if;
  if (select count(*) from packs
      where author_id = new.author_id
        and id <> '16ea0906-5874-4471-aa38-aef1513e82c6') >= 3 then
    raise exception 'Ви вже маєте 3 особисті паки — це максимум. Видаліть один із них, щоб створити новий.';
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.users (id, username, avatar_url, games_played)
  VALUES (
    NEW.id,
    -- Беремо ім'я з метаданих або генеруємо випадкове, якщо порожнє
    COALESCE(NEW.raw_user_meta_data->>'username', 'Player_' || substr(NEW.id::text, 1, 6)),
    NULL,
    0
  );
  RETURN NEW;
END;
$function$
;

-- Server-owned membership is independent of client-controlled players_state.
CREATE TABLE IF NOT EXISTS bunker_private.room_members (
  room_code text NOT NULL REFERENCES public.rooms(room_code) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_player boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  can_access boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_code, user_id)
);
ALTER TABLE bunker_private.room_members ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS bunker_private.recorded_results (
  room_code text PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bunker_private.recorded_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA bunker_private FROM PUBLIC, anon, authenticated;

-- Existing players may reconnect, but cannot receive statistics until they
-- personally authenticate in join_room. Never trust a legacy JSON roster as proof.
INSERT INTO bunker_private.room_members (room_code, user_id, is_player)
SELECT r.room_code, u.id, true
FROM public.rooms r
JOIN auth.users u ON coalesce(r.players_state, '{}'::jsonb) ? u.id::text
ON CONFLICT DO NOTHING;
INSERT INTO bunker_private.room_members (room_code, user_id, is_player)
SELECT room_code, host_id, true FROM public.rooms
ON CONFLICT (room_code, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_read_room_event(p_room text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM bunker_private.room_members
    WHERE room_code = p_room AND user_id = auth.uid() AND can_access
  );
$$;

-- A redacted object has the same shape needed by the renderer, but no secret
-- value, title, metadata, custom scale, or nested ability left in the response.
CREATE OR REPLACE FUNCTION bunker_private.visible_card(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE v_result jsonb; v_item jsonb;
BEGIN
  IF jsonb_typeof(p_value) = 'array' THEN
    v_result := '[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      v_result := v_result || jsonb_build_array(bunker_private.visible_card(v_item));
    END LOOP;
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_value) = 'object' AND p_value->'is_revealed' = 'true'::jsonb THEN
    RETURN p_value;
  END IF;
  RETURN '{"is_revealed":false}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_room_view(p_room text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_uid uuid := auth.uid();
  v_players jsonb := '{}'::jsonb; v_player jsonb; v_visible jsonb;
  v_id text; v_key text; v_value jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_read_room_event(p_room) THEN
    RAISE EXCEPTION 'Кімнату не знайдено або немає доступу' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'Кімнату не знайдено' USING ERRCODE = '42501'; END IF;
  FOR v_id, v_player IN SELECT * FROM jsonb_each(coalesce(r.players_state, '{}'::jsonb)) LOOP
    IF v_id = v_uid::text OR r.host_id = v_uid OR r.status = 'finished' THEN
      v_visible := v_player;
    ELSE
      v_visible := '{}'::jsonb;
      FOR v_key, v_value IN SELECT * FROM jsonb_each(v_player) LOOP
        IF v_key IN ('name', 'is_alive', 'is_kicked') THEN
          v_visible := v_visible || jsonb_build_object(v_key, v_value);
        ELSIF v_key IN ('gender', 'age', 'childfree', 'is_childfree', 'body',
          'professions', 'hobbies', 'health', 'traits', 'phobias', 'backpack',
          'large_inventory', 'extra_info', 'special_abilities', 'characteristics', 'abilities') THEN
          v_visible := v_visible || jsonb_build_object(v_key, bunker_private.visible_card(v_value));
        END IF;
      END LOOP;
    END IF;
    v_players := v_players || jsonb_build_object(v_id, v_visible);
  END LOOP;
  RETURN to_jsonb(r) || jsonb_build_object('players_state', v_players);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_rooms()
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('room_code', r.room_code, 'status', r.status,
    'bunker_state', CASE WHEN coalesce(r.bunker_state, '{}'::jsonb) = '{}'::jsonb
      THEN '{}'::jsonb ELSE '{"started":true}'::jsonb END)
  FROM public.rooms r JOIN bunker_private.room_members m USING (room_code)
  WHERE m.user_id = auth.uid() AND m.can_access AND m.is_player
    AND r.status NOT IN ('finished', 'closed')
  ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.join_room(p_room text, p_name text, p_max integer DEFAULT 15)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_uid uuid := auth.uid(); v_name text;
  v_member bunker_private.room_members%ROWTYPE; v_player boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Необхідна авторизація' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Кімнату не знайдено'; END IF;
  SELECT * INTO v_member FROM bunker_private.room_members WHERE room_code = p_room AND user_id = v_uid;
  IF FOUND AND NOT v_member.can_access THEN
    RAISE EXCEPTION 'Доступ до кімнати закрито' USING ERRCODE = '42501';
  END IF;
  IF r.status IN ('finished', 'closed') THEN
    IF v_member.user_id IS NOT NULL THEN RETURN; END IF;
    RAISE EXCEPTION 'Кімнату закрито' USING ERRCODE = '42501';
  END IF;
  v_player := coalesce(r.players_state, '{}'::jsonb) ? v_uid::text
    OR coalesce(r.bunker_state, '{}'::jsonb) = '{}'::jsonb;
  IF v_member.user_id IS NULL AND
     (SELECT count(*) FROM bunker_private.room_members WHERE room_code = p_room AND can_access) >= 100 THEN
    RAISE EXCEPTION 'Забагато учасників кімнати';
  END IF;
  IF v_player AND NOT (coalesce(r.players_state, '{}'::jsonb) ? v_uid::text) AND
     (SELECT count(*) FROM jsonb_object_keys(coalesce(r.players_state, '{}'::jsonb))) >= 15 THEN
    RAISE EXCEPTION 'Ця кімната вже переповнена (максимум 15 гравців)';
  END IF;
  -- Ignore p_name and p_max: identity and limits are server-owned.
  SELECT username INTO v_name FROM public.users WHERE id = v_uid;
  INSERT INTO bunker_private.room_members(room_code, user_id, is_player, verified)
    VALUES(p_room, v_uid, v_player, true)
    ON CONFLICT (room_code, user_id) DO UPDATE SET verified = true,
      is_player = bunker_private.room_members.is_player OR EXCLUDED.is_player;
  IF v_player AND NOT (coalesce(r.players_state, '{}'::jsonb) ? v_uid::text) THEN
    UPDATE public.rooms SET players_state = coalesce(players_state, '{}'::jsonb) ||
      jsonb_build_object(v_uid::text, jsonb_build_object('name', left(coalesce(v_name, 'Гравець'), 40)))
    WHERE room_code = p_room;
  END IF;
END;
$$;

-- Host mutations still use the existing CAS update API. Validate the fields
-- that must never be authoritative on the client, including the player roster.
CREATE OR REPLACE FUNCTION bunker_private.guard_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id text; v_count integer; v_min integer := 6;
BEGIN
  IF jsonb_typeof(coalesce(NEW.players_state, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(coalesce(NEW.bunker_state, '{}'::jsonb)) <> 'object'
     OR pg_column_size(NEW.players_state) > 1048576
     OR pg_column_size(NEW.bunker_state) > 1048576 THEN
    RAISE EXCEPTION 'Некоректний або завеликий стан кімнати';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.host_id IS DISTINCT FROM auth.uid() OR NEW.status <> 'lobby'
       OR coalesce(NEW.players_state, '{}'::jsonb) <> '{}'::jsonb
       OR coalesce(NEW.bunker_state, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Кімната має створюватися порожньою в лобі' USING ERRCODE = '42501';
    END IF;
    IF NEW.room_code !~ '^[A-Z2-9]{8}$' THEN RAISE EXCEPTION 'Некоректний код кімнати'; END IF;
    IF (SELECT count(*) FROM public.rooms WHERE host_id = auth.uid() AND status NOT IN ('closed', 'finished')) >= 10 THEN
      RAISE EXCEPTION 'Забагато активних кімнат';
    END IF;
    NEW.created_at := now();
    NEW.version := 1;
    RETURN NEW;
  END IF;
  IF NEW.bunker_state ? 'logs' THEN
    IF jsonb_typeof(NEW.bunker_state->'logs') <> 'array' THEN RAISE EXCEPTION 'Некоректний журнал'; END IF;
    NEW.bunker_state := jsonb_set(NEW.bunker_state, '{logs}', (
      SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb) FROM (
        SELECT value, ord FROM jsonb_array_elements(NEW.bunker_state->'logs')
          WITH ORDINALITY t(value, ord) ORDER BY ord DESC LIMIT 100
      ) bounded
    ));
  END IF;
  IF NEW.room_code IS DISTINCT FROM OLD.room_code OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Службові поля кімнати змінювати не можна' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL THEN
    NEW.version := coalesce(OLD.version, 0) + 1;
    RETURN NEW; -- Trusted maintenance; raw client writes still require an authenticated host.
  END IF;
  IF OLD.status IN ('finished', 'closed') THEN
    -- ON DELETE SET NULL for a deleted personal pack must still work in archives.
    IF (NEW.selected_pack_id IS NULL OR NEW.selected_pack_id = '16ea0906-5874-4471-aa38-aef1513e82c6'::uuid) AND
       (to_jsonb(NEW) - ARRAY['selected_pack_id','selected_pack_title','version']) =
       (to_jsonb(OLD) - ARRAY['selected_pack_id','selected_pack_title','version']) THEN
      NEW.version := coalesce(OLD.version, 0) + 1;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Гру вже завершено';
  END IF;
  FOR v_id IN SELECT jsonb_object_keys(coalesce(NEW.players_state, '{}'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM bunker_private.room_members m
      WHERE m.room_code = OLD.room_code AND m.user_id::text = v_id AND m.is_player AND m.can_access) THEN
      RAISE EXCEPTION 'Не можна додавати гравців від імені іншого користувача' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF NEW.host_id IS DISTINCT FROM OLD.host_id AND NOT EXISTS (
    SELECT 1 FROM bunker_private.room_members WHERE room_code = OLD.room_code
      AND user_id = NEW.host_id AND is_player AND verified AND can_access
  ) THEN RAISE EXCEPTION 'Новий ведучий має бути учасником кімнати'; END IF;
  IF coalesce(OLD.bunker_state, '{}'::jsonb) = '{}'::jsonb AND
     coalesce(NEW.bunker_state, '{}'::jsonb) <> '{}'::jsonb THEN
    SELECT count(*) INTO v_count FROM jsonb_object_keys(NEW.players_state);
    IF EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()) THEN v_min := 1; END IF;
    IF v_count < v_min OR v_count > 15 THEN RAISE EXCEPTION 'Для старту потрібно від % до 15 гравців', v_min; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.players_state) p(id)
      WHERE NOT EXISTS (SELECT 1 FROM bunker_private.room_members m WHERE m.room_code = OLD.room_code
        AND m.user_id::text = p.id AND m.verified AND m.is_player AND m.can_access)) THEN
      RAISE EXCEPTION 'Учасники мають підтвердити вхід до кімнати';
    END IF;
  END IF;
  IF NEW.status = 'finished' AND OLD.status <> 'finished' AND
     (coalesce(OLD.bunker_state, '{}'::jsonb) = '{}'::jsonb OR
      coalesce(NEW.bunker_state, '{}'::jsonb) = '{}'::jsonb) THEN
    RAISE EXCEPTION 'Гру ще не розпочато';
  END IF;
  IF NEW.status = 'finished' AND OLD.status <> 'finished' THEN
    IF coalesce(NEW.bunker_state->>'capacity', '') !~ '^[1-9][0-9]{0,3}$' THEN
      RAISE EXCEPTION 'Некоректна місткість бункера';
    END IF;
    SELECT count(*) INTO v_count FROM jsonb_each(NEW.players_state)
      WHERE coalesce((value->>'is_alive')::boolean, true) AND NOT coalesce((value->>'is_kicked')::boolean, false);
    IF v_count > (NEW.bunker_state->>'capacity')::integer THEN
      RAISE EXCEPTION 'Живих гравців більше, ніж місць у бункері';
    END IF;
  END IF;
  -- A lobby kick revokes access; clients cannot silently rejoin themselves.
  IF coalesce(OLD.bunker_state, '{}'::jsonb) = '{}'::jsonb THEN
    UPDATE bunker_private.room_members SET can_access = false
    WHERE room_code = OLD.room_code AND is_player
      AND coalesce(OLD.players_state, '{}'::jsonb) ? user_id::text
      AND NOT (coalesce(NEW.players_state, '{}'::jsonb) ? user_id::text);
  END IF;
  NEW.version := coalesce(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS security_validate_selected_pack ON public.rooms;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.rooms'::regclass
    AND tgfoid = 'public.rooms_validate_selected_pack()'::regprocedure AND NOT tgisinternal) THEN
    CREATE TRIGGER security_validate_selected_pack BEFORE INSERT OR UPDATE ON public.rooms
      FOR EACH ROW EXECUTE FUNCTION public.rooms_validate_selected_pack();
  END IF;
END $$;
DROP TRIGGER IF EXISTS security_guard_room ON public.rooms;
CREATE TRIGGER security_guard_room BEFORE INSERT OR UPDATE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION bunker_private.guard_room();

CREATE TABLE IF NOT EXISTS public.room_events (
  room_code text PRIMARY KEY REFERENCES public.rooms(room_code) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0
);
ALTER TABLE public.room_events ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION bunker_private.publish_room_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO bunker_private.room_members(room_code, user_id, is_player, verified)
    VALUES(NEW.room_code, NEW.host_id, true, true) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.room_events(room_code, version) VALUES(NEW.room_code, coalesce(NEW.version, 0))
    ON CONFLICT (room_code) DO UPDATE SET version = EXCLUDED.version;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS security_publish_room_event ON public.rooms;
CREATE TRIGGER security_publish_room_event AFTER INSERT OR UPDATE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION bunker_private.publish_room_event();
INSERT INTO public.room_events SELECT room_code, coalesce(version, 0) FROM public.rooms
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.transfer_room_host(p_room text, p_user uuid, p_expected_version integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room FOR UPDATE;
  IF auth.uid() IS NULL OR r.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Лише ведучий може передати роль' USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> r.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;
  UPDATE public.rooms SET host_id = p_user,
    bunker_state = CASE WHEN coalesce(bunker_state, '{}'::jsonb) = '{}'::jsonb THEN bunker_state
      ELSE jsonb_set(bunker_state, '{latest_host_event}', jsonb_build_object(
        'id', (extract(epoch FROM clock_timestamp()) * 1000)::bigint,
        'text', 'Ведучий передав роль іншому учаснику'), true) END
  WHERE room_code = p_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_game_results(p_room_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room_code FOR UPDATE;
  IF auth.uid() IS NULL OR r.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Лише ведучий може зарахувати результат' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'finished' THEN RAISE EXCEPTION 'Гру ще не завершено'; END IF;
  IF EXISTS (SELECT 1 FROM bunker_private.recorded_results WHERE room_code = p_room_code) THEN
    RETURN jsonb_build_object('success', true, 'already_recorded', true, 'recorded_players', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(r.players_state, '{}'::jsonb)) p(id)
    WHERE NOT EXISTS (SELECT 1 FROM bunker_private.room_members m WHERE m.room_code = p_room_code
      AND m.user_id::text = p.id AND m.verified AND m.is_player AND m.can_access)) THEN
    RAISE EXCEPTION 'Не можна зарахувати результат непідтвердженому учаснику';
  END IF;
  v_result := bunker_private.record_game_results_impl(p_room_code);
  IF coalesce((v_result->>'success')::boolean, false) IS NOT TRUE OR
     jsonb_array_length(coalesce(v_result->'errors', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'Не вдалося зарахувати результат: %', v_result;
  END IF;
  INSERT INTO bunker_private.recorded_results(room_code) VALUES(p_room_code);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_log(p_room text, p_text text, p_max integer DEFAULT 100)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_entry jsonb; v_now bigint;
BEGIN
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room FOR UPDATE;
  IF auth.uid() IS NULL OR r.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Лише ведучий може додавати довільні події' USING ERRCODE = '42501';
  END IF;
  IF r.status IN ('finished', 'closed') OR coalesce(r.bunker_state, '{}'::jsonb) = '{}'::jsonb THEN RETURN; END IF;
  v_now := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_entry := jsonb_build_object('id', greatest(v_now, coalesce((r.bunker_state->'logs'->-1->>'id')::bigint, 0) + 1),
    't', v_now, 'actor_id', auth.uid(), 'text', 'Ведучий: ' || left(btrim(coalesce(p_text, '')), 280));
  UPDATE public.rooms SET bunker_state = jsonb_set(bunker_state, '{logs}', (
    SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb) FROM (
      SELECT value, ord FROM jsonb_array_elements(coalesce(r.bunker_state->'logs', '[]'::jsonb) || jsonb_build_array(v_entry))
        WITH ORDINALITY t(value, ord) ORDER BY ord DESC LIMIT 100
    ) bounded
  ), true) WHERE room_code = p_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_reveals(p_room text, p_changes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_uid text := auth.uid()::text; v_player jsonb;
  v_item jsonb; v_path text[]; v_val boolean; v_changed boolean := false; v_now bigint; v_entry jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Необхідна авторизація' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) > 50 THEN
    RAISE EXCEPTION 'Некоректний список змін';
  END IF;
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room FOR UPDATE;
  v_player := r.players_state->v_uid;
  IF v_player IS NULL OR r.status IN ('finished', 'closed') OR
     coalesce((v_player->>'is_kicked')::boolean, false) THEN
    RAISE EXCEPTION 'Немає доступу до кімнати' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(v_item->'path') IS DISTINCT FROM 'array' OR
       jsonb_typeof(v_item->'value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Некоректна зміна'; END IF;
    SELECT array_agg(value ORDER BY ord) INTO v_path FROM jsonb_array_elements_text(v_item->'path')
      WITH ORDINALITY t(value, ord);
    v_val := (v_item->>'value')::boolean;
    IF array_length(v_path, 1) BETWEEN 1 AND 2 AND v_path[1] IN (
      'gender', 'age', 'childfree', 'is_childfree', 'body', 'professions', 'hobbies', 'health',
      'traits', 'phobias', 'backpack', 'large_inventory', 'extra_info', 'special_abilities'
    ) AND (array_length(v_path, 1) = 1 OR v_path[2] ~ '^[0-9]{1,3}$')
      AND jsonb_typeof(v_player #> v_path) = 'object'
      AND (v_player #> v_path) ? 'is_revealed' THEN
      v_changed := v_changed OR (v_player #> (v_path || ARRAY['is_revealed'])) IS DISTINCT FROM to_jsonb(v_val);
      v_player := jsonb_set(v_player, v_path || ARRAY['is_revealed'], to_jsonb(v_val), false);
    END IF;
  END LOOP;
  IF NOT v_changed THEN RETURN; END IF;
  v_now := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_entry := jsonb_build_object('id', greatest(v_now, coalesce((r.bunker_state->'logs'->-1->>'id')::bigint, 0) + 1),
    't', v_now, 'actor_id', auth.uid(), 'text', 'Гравець ' || left(coalesce(v_player->>'name', 'Гравець'), 40) || ' змінив відкритість своїх карток');
  UPDATE public.rooms SET players_state = jsonb_set(players_state, ARRAY[v_uid], v_player, false),
    bunker_state = jsonb_set(bunker_state, '{logs}', (
      SELECT coalesce(jsonb_agg(value ORDER BY ord), '[]'::jsonb) FROM (
        SELECT value, ord FROM jsonb_array_elements(coalesce(r.bunker_state->'logs', '[]'::jsonb) || jsonb_build_array(v_entry))
          WITH ORDINALITY t(value, ord) ORDER BY ord DESC LIMIT 100
      ) bounded
    ), true) WHERE room_code = p_room;
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_vote(p_room text, p_candidate text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r public.rooms%ROWTYPE; v_uid text := auth.uid()::text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Необхідна авторизація' USING ERRCODE = '42501'; END IF;
  IF p_candidate IS NULL OR p_candidate = '' THEN RAISE EXCEPTION 'Оберіть кандидата'; END IF;
  SELECT * INTO r FROM public.rooms WHERE room_code = p_room FOR UPDATE;
  IF NOT FOUND OR r.status IN ('finished', 'closed') OR
    coalesce((r.bunker_state->'voting'->>'isActive')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Голосування вже завершено';
  END IF;
  IF NOT (r.players_state ? v_uid) OR
    coalesce((r.players_state->v_uid->>'is_alive')::boolean, true) = false OR
    coalesce((r.players_state->v_uid->>'is_kicked')::boolean, false) THEN
    RAISE EXCEPTION 'Ви не можете голосувати' USING ERRCODE = '42501';
  END IF;
  IF NOT (r.players_state ? p_candidate) OR
    coalesce((r.players_state->p_candidate->>'is_alive')::boolean, true) = false OR
    coalesce((r.players_state->p_candidate->>'is_kicked')::boolean, false) THEN
    RAISE EXCEPTION 'Цього гравця виключено з голосування';
  END IF;
  UPDATE public.rooms SET bunker_state = jsonb_set(bunker_state,
    ARRAY['voting','votes',v_uid], to_jsonb(p_candidate), true) WHERE room_code = p_room;
END;
$$;

-- Reset permissive policies as well as ACLs: adding another policy would OR with
-- the old SELECT true and leave the data public.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('admins','packs','pack_cards','rooms','room_events') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
REVOKE ALL ON public.admins, public.packs, public.pack_cards, public.rooms, public.room_events FROM PUBLIC, anon, authenticated;
DO $$ DECLARE c record; BEGIN
  -- Table REVOKE does not remove old column-level grants.
  FOR c IN SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('admins','packs','pack_cards','rooms','room_events','users','user_game_history') LOOP
    EXECUTE format('REVOKE ALL (%I) ON public.%I FROM PUBLIC, anon, authenticated', c.column_name, c.table_name);
  END LOOP;
END $$;
GRANT SELECT ON public.admins, public.packs, public.pack_cards, public.room_events TO authenticated;
GRANT SELECT ON public.packs, public.pack_cards TO anon;
GRANT SELECT ON public.rooms TO authenticated;
GRANT INSERT (room_code, host_id, status, bunker_state, players_state) ON public.rooms TO authenticated;
GRANT UPDATE (players_state, bunker_state, status, selected_pack_id) ON public.rooms TO authenticated;
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_admin_self ON public.admins FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY security_pack_anon_read ON public.packs FOR SELECT TO anon
  USING (id = '16ea0906-5874-4471-aa38-aef1513e82c6'::uuid);
CREATE POLICY security_pack_read ON public.packs FOR SELECT TO authenticated
  USING (id = '16ea0906-5874-4471-aa38-aef1513e82c6'::uuid OR author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.rooms r WHERE r.host_id = auth.uid() AND r.selected_pack_id = packs.id));
CREATE POLICY security_card_read ON public.pack_cards FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.packs p WHERE p.id = pack_id));
CREATE POLICY security_room_host_read ON public.rooms FOR SELECT TO authenticated USING (host_id = auth.uid());
CREATE POLICY security_room_create ON public.rooms FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY security_room_host_update ON public.rooms FOR UPDATE TO authenticated
  USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
CREATE POLICY security_room_event_read ON public.room_events FOR SELECT TO authenticated
  USING (public.can_read_room_event(room_code));


-- Profile counters and history can only be written by the verified result RPC.
DO $$ DECLARE p record; c record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('users', 'user_game_history') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
REVOKE ALL ON public.users, public.user_game_history FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, avatar_url, created_at, games_played, games_won) ON public.users TO authenticated;
GRANT UPDATE (avatar_url) ON public.users TO authenticated;
GRANT SELECT ON public.user_game_history TO authenticated;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_game_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_profile_read ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY security_profile_avatar ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY security_own_history ON public.user_game_history FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- No client may invoke maintenance. Service/cron owner retains access.
REVOKE ALL ON FUNCTION public.handle_room_lifecycle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_room_lifecycle() TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bunker_private FROM PUBLIC, anon, authenticated;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature, p.prorettype = 'trigger'::regtype AS is_trigger
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'can_read_room_event','get_room_view','list_my_rooms','join_room','transfer_room_host',
      'record_game_results','append_log','set_my_reveals','cast_vote',
      'save_personal_pack','save_default_pack','delete_personal_pack',
      'handle_new_user','enforce_personal_pack_limit','rooms_validate_selected_pack','rooms_bump_version'
    ) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    IF NOT f.is_trigger THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature); END IF;
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA bunker_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Publish only notification rows, never full room JSON. Disabling the old
-- publication path also protects against accidental future SELECT-policy changes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms') THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.rooms;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_events;
    END IF;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
