-- 🔴 Élő közvetítés (Live) — session-életciklus + „most élőben" + értesítés.
--
-- A tényleges videó-transzport (host→nézők) médiaszervert/providert igényel
-- (LiveKit/Mux/Agora) — azt NEM ez a réteg oldja meg. Ez a tábla a session-
-- állapot (ki van élőben, mivel, mióta), amire a kliens a Supabase-Realtime
-- presence-t (nézőszám) + broadcast-ot (chat/reakció) építi, és amiből a
-- „most élőben" lista jön. A profil denormalizált (mint a posztnál/üzenetnél).

create table if not exists public.live_sessions (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 120),
  status        text not null default 'live' check (status in ('live', 'ended')),
  host_username text,
  host_name     text,
  host_avatar   text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  viewer_peak   integer not null default 0
);

create index if not exists live_sessions_live_idx
  on public.live_sessions (started_at desc) where status = 'live';
-- egy hostnak egyszerre csak EGY élő sessionje lehet
create unique index if not exists live_sessions_one_live_per_host
  on public.live_sessions (host_id) where status = 'live';

alter table public.live_sessions enable row level security;

-- SELECT: a bejelentkezettek látják az ÉLŐ sessionöket + a sajátjaikat (ended is)
drop policy if exists "live_select" on public.live_sessions;
create policy "live_select" on public.live_sessions
  for select to authenticated
  using (status = 'live' or host_id = auth.uid());

-- INSERT: csak a saját nevében (host_id = auth.uid())
drop policy if exists "live_insert_own" on public.live_sessions;
create policy "live_insert_own" on public.live_sessions
  for insert to authenticated
  with check (host_id = auth.uid());

-- UPDATE (leállítás + viewer_peak frissítés): csak a host
drop policy if exists "live_update_own" on public.live_sessions;
create policy "live_update_own" on public.live_sessions
  for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

-- ── „X most élőben van" értesítés a KÖVETŐKNEK (session indításakor) ──────────
create or replace function public.on_live_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- a host összes követőjének (cross-user insert → SECURITY DEFINER)
  insert into public.notifications (user_id, type, title, body, route, data)
  select f.follower_id,
         'system',
         coalesce(nullif(new.host_name, ''), nullif(new.host_username, ''), 'Valaki') || ' élőben! 🔴',
         left(new.title, 80),
         '/live/' || new.id::text,
         jsonb_build_object('liveId', new.id, 'hostId', new.host_id, 'kind', 'live')
    from public.follows f
   where f.following_id = new.host_id;
  return new;
end;
$$;
drop trigger if exists live_sessions_after_insert on public.live_sessions;
create trigger live_sessions_after_insert
  after insert on public.live_sessions
  for each row execute function public.on_live_started();

-- 🔴 realtime: a „most élőben" lista élő frissítése (insert/update: új élő / leállás)
alter publication supabase_realtime add table public.live_sessions;
