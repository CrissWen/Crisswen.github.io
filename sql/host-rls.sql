-- ============================================================
-- Крок 4 ТЗ: захист таблиці rooms (Row Level Security) для панелі ведучого
-- НЕ ЗАСТОСОВАНО АВТОМАТИЧНО — виконайте вручну в Supabase → SQL Editor.
-- ============================================================
--
-- ВАЖЛИВО (порядок дій):
-- У проєкті стан гравців лежить у rooms.players_state (jsonb), а не в окремій таблиці players.
-- Зараз game.js (initGame) додає нового гравця прямим UPDATE rooms від імені самого гравця.
-- Щойно UPDATE стане "тільки для ведучого", це перестане працювати.
-- Тому спочатку створюємо RPC join_room (SECURITY DEFINER), потім у initGame замінюємо
-- прямий update на:
--
--   const { error: joinErr } = await supabase.rpc('join_room', {
--     room_code_val: currentRoomCode,
--     player_name: currentUserName
--   });
--   if (joinErr) throw new Error(joinErr.message);
--   // після цього перечитати кімнату: select * from rooms ...
--
-- Також перевірте, що існуюча функція update_single_player_state оголошена як
-- SECURITY DEFINER і всередині перевіряє, що user_id_val = auth.uid()
-- (інакше гравці зможуть міняти чужі картки, а після RLS — взагалі не зможуть писати).
-- ============================================================

-- 1) Приєднання до кімнати до старту гри
create or replace function public.join_room(room_code_val text, player_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where room_code = room_code_val for update;
  if not found then
    raise exception 'Кімнату не знайдено';
  end if;

  if r.bunker_state is not null and r.bunker_state <> '{}'::jsonb then
    raise exception 'Гра вже почалася. Приєднання нових гравців закрито.';
  end if;

  update public.rooms
     set players_state = coalesce(players_state, '{}'::jsonb)
                         || jsonb_build_object(auth.uid()::text, jsonb_build_object('name', player_name))
   where room_code = room_code_val
     and not (coalesce(players_state, '{}'::jsonb) ? auth.uid()::text);
end;
$$;

grant execute on function public.join_room(text, text) to authenticated;

-- 2) RLS: змінювати та видаляти кімнату може лише її ведучий
alter table public.rooms enable row level security;

drop policy if exists rooms_update_host_only on public.rooms;
create policy rooms_update_host_only
  on public.rooms
  for update
  to authenticated
  using (host_id = auth.uid())   -- старий рядок: змінює чинний ведучий
  with check (true);             -- новий рядок: дозволяє передати host_id іншому гравцю

drop policy if exists rooms_delete_host_only on public.rooms;
create policy rooms_delete_host_only
  on public.rooms
  for delete
  to authenticated
  using (host_id = auth.uid());

-- SELECT / INSERT політики залишаються як є (гравці читають кімнату, лобі створює кімнату з host_id = auth.uid()).
-- Якщо INSERT-політики ще немає:
-- create policy rooms_insert_self_host on public.rooms for insert to authenticated with check (host_id = auth.uid());
