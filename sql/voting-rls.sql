-- ============================================================
-- Голосування "Кого виключити з бункера?" — запис голосу звичайним гравцем.
-- НЕ ЗАСТОСОВАНО АВТОМАТИЧНО — виконайте вручну в Supabase → SQL Editor.
--
-- Навіщо RPC, а не прямий UPDATE з клієнта: bunker_state.voting.votes міняє БУДЬ-ЯКИЙ гравець,
-- не лише ведучий. Якщо/коли в проєкті застосують sql/host-rls.sql (rooms_update_host_only —
-- UPDATE дозволено лише host_id = auth.uid()), прямий supabase.from('rooms').update({bunker_state})
-- від звичайного гравця перестане проходити. RPC із SECURITY DEFINER обходить цю політику так само,
-- як вже зроблено для join_room, і додатково сам перевіряє права голосуючого.
-- ============================================================

create or replace function public.cast_vote(room_code_val text, candidate_id_val text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms;
  voter_id text := auth.uid()::text;
begin
  select * into r from public.rooms where room_code = room_code_val for update;
  if not found then
    raise exception 'Кімнату не знайдено';
  end if;

  if not (coalesce(r.players_state, '{}'::jsonb) ? voter_id) then
    raise exception 'Ви не берете участі в цій грі';
  end if;

  if coalesce((r.players_state -> voter_id ->> 'is_alive')::boolean, true) = false then
    raise exception 'Вибулі гравці не голосують';
  end if;

  if coalesce((r.bunker_state -> 'voting' ->> 'isActive')::boolean, false) = false then
    raise exception 'Голосування не активне';
  end if;

  if not (coalesce(r.players_state, '{}'::jsonb) ? candidate_id_val) then
    raise exception 'Кандидата не знайдено';
  end if;

  update public.rooms
     set bunker_state = jsonb_set(
       bunker_state,
       '{voting,votes}',
       coalesce(bunker_state #> '{voting,votes}', '{}'::jsonb) || jsonb_build_object(voter_id, candidate_id_val),
       true
     )
   where room_code = room_code_val;
end;
$$;

grant execute on function public.cast_vote(text, text) to authenticated;
