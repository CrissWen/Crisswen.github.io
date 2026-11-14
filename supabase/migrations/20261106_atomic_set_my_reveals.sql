-- Migration: Add atomic event logging to set_my_reveals
-- Reduces Realtime WebSocket messages by combining players_state and bunker_state.logs updates.

DROP FUNCTION IF EXISTS public.set_my_reveals(text, jsonb);

CREATE OR REPLACE FUNCTION public.set_my_reveals(
  p_room text,
  p_changes jsonb,
  p_log_text text DEFAULT NULL,
  p_max_logs integer DEFAULT 100
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_player jsonb;
  v_bunker jsonb;
  v_item jsonb;
  v_path text[];
  v_val boolean;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_last_id bigint;
  v_id bigint;
  v_entry jsonb;
  v_has_log boolean := (p_log_text IS NOT NULL AND trim(p_log_text) <> '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Необхідна авторизація';
  END IF;

  SELECT players_state -> v_uid, bunker_state
    INTO v_player, v_bunker
    FROM rooms
   WHERE room_code = p_room
     AND status NOT IN ('finished', 'closed')
   FOR UPDATE;

  IF v_player IS NULL THEN
    RAISE EXCEPTION 'Кімнату не знайдено або немає доступу';
  END IF;

  -- Apply reveal flag changes
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_changes, '[]'::jsonb))
  LOOP
    SELECT array_agg(x) INTO v_path
      FROM jsonb_array_elements_text(v_item -> 'path') AS x;
    v_val := coalesce((v_item ->> 'value')::boolean, false);

    IF v_path IS NOT NULL
       AND array_length(v_path, 1) BETWEEN 1 AND 3
       AND v_path[1] IN (
         'gender', 'age', 'childfree', 'is_childfree', 'body',
         'professions', 'hobbies', 'health', 'traits', 'phobias',
         'backpack', 'large_inventory', 'extra_info', 'special_abilities',
         'characteristics', 'abilities'
       )
       AND jsonb_typeof(v_player #> v_path) = 'object' THEN
      v_player := jsonb_set(v_player, v_path || ARRAY['is_revealed'], to_jsonb(v_val), false);
    END IF;
  END LOOP;

  -- If log text provided and room has bunker_state, prepare log entry
  IF v_has_log AND v_bunker IS NOT NULL AND v_bunker <> '{}'::jsonb THEN
    v_last_id := coalesce((v_bunker->'logs'->-1->>'id')::bigint, 0);
    v_id := GREATEST(v_now, v_last_id + 1);

    v_entry := jsonb_build_object(
      'id', v_id,
      't', v_now,
      'text', left(trim(p_log_text), 300)
    );

    v_bunker := jsonb_set(
      v_bunker,
      '{logs}',
      (
        SELECT coalesce(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
        FROM (
          SELECT elem, ord
          FROM jsonb_array_elements(coalesce(v_bunker->'logs', '[]'::jsonb) || jsonb_build_array(v_entry))
               WITH ORDINALITY AS t(elem, ord)
          ORDER BY ord DESC
          LIMIT greatest(coalesce(p_max_logs, 100), 1)
        ) sub
      ),
      true
    );
  END IF;

  -- Single atomic update
  UPDATE rooms
     SET players_state = jsonb_set(players_state, ARRAY[v_uid], v_player, false),
         bunker_state = CASE WHEN v_has_log AND v_bunker IS NOT NULL AND v_bunker <> '{}'::jsonb THEN v_bunker ELSE bunker_state END
   WHERE room_code = p_room;
END;
$function$;
