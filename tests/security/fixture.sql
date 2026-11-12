CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE room_status_enum AS ENUM('lobby','in_progress','finished','closed');
CREATE TYPE pool_type_enum AS ENUM('character','bunker');
CREATE TYPE card_category_enum AS ENUM('profession','gender','cataclysm','trait');
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id), username text NOT NULL,
  avatar_url text, created_at timestamptz DEFAULT now(), games_played integer DEFAULT 0,
  games_won integer DEFAULT 0, private_email text
);
CREATE TABLE public.admins(user_id uuid PRIMARY KEY REFERENCES auth.users(id));
CREATE TABLE public.packs (
  id uuid PRIMARY KEY, author_id uuid REFERENCES auth.users(id), title text,
  description text, config jsonb DEFAULT '{}', version integer DEFAULT 1, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.pack_cards (
  id uuid PRIMARY KEY, pack_id uuid REFERENCES public.packs(id) ON DELETE CASCADE,
  pool_type pool_type_enum, category card_category_enum, value text, meta jsonb
);
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_code varchar(4) UNIQUE NOT NULL,
  host_id uuid NOT NULL REFERENCES auth.users(id), status room_status_enum DEFAULT 'lobby',
  created_at timestamptz DEFAULT now(), version integer DEFAULT 1,
  players_state jsonb DEFAULT '{}', bunker_state jsonb DEFAULT '{}',
  selected_pack_id uuid REFERENCES public.packs(id) ON DELETE SET NULL DEFAULT '16ea0906-5874-4471-aa38-aef1513e82c6',
  selected_pack_title text
);
CREATE TABLE public.user_game_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid REFERENCES public.users(id),
  room_code text NOT NULL, cataclysm_title text, profession_title text, survived boolean, played_at timestamptz
);
INSERT INTO public.packs(id,title) VALUES('16ea0906-5874-4471-aa38-aef1513e82c6','default');
-- Simulate the overly broad previous deployment, including a column grant.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT UPDATE(games_won) ON public.users TO anon, authenticated;
CREATE POLICY old_public_packs ON public.packs USING(true);
CREATE POLICY old_public_cards ON public.pack_cards USING(true);
CREATE POLICY old_public_rooms ON public.rooms USING(true);
CREATE PUBLICATION supabase_realtime FOR TABLE public.rooms;
