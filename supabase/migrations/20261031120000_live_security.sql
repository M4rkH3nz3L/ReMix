-- 🔐 PRO-LIVE 2. lépés — adat-biztonság (L2, L4, L6, L7, L10, L12)

-- ── L4/L6: a stream-kulcs a kliens felé SOHA nem olvasható / írható ─────────────
-- `has_key` jelző a kulcs helyett; a `stream_key` oszlopot csak a service_role (worker)
-- írja/olvassa — a kliens-szerepek oszlop-szintű jogot kapnak, a kulcs oszlopra nem.
alter table public.live_destinations alter column stream_key set default '';
alter table public.live_destinations
  add column if not exists has_key boolean generated always as (stream_key <> '') stored;

revoke select, insert, update on public.live_destinations from anon, authenticated;
grant select (id, user_id, platform, label, rtmp_url, enabled, created_at, has_key)
  on public.live_destinations to authenticated;
grant insert (user_id, platform, label, rtmp_url, enabled) on public.live_destinations to authenticated;
grant update (platform, label, rtmp_url, enabled) on public.live_destinations to authenticated;
grant delete on public.live_destinations to authenticated;

-- L7 (DB-szint): csak rtmp(s) séma, hitelesítő adat és nyilvánvaló belső host nélkül
-- (a teljes, DNS-sel is ellenőrzött validáció a workerben fut az egress előtt)
alter table public.live_destinations drop constraint if exists live_destinations_rtmp_url_check;
alter table public.live_destinations add constraint live_destinations_rtmp_url_check check (
  rtmp_url ~* '^rtmps?://[^/@\s]+'
  and rtmp_url !~* '^rtmps?://(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[)'
) not valid;

-- L6: engedélyezett cél csak kulccsal (a félbemaradt kulcs-mentés ne hagyjon élő üres célt)
alter table public.live_destinations drop constraint if exists live_destinations_enabled_needs_key;
alter table public.live_destinations add constraint live_destinations_enabled_needs_key
  check (not enabled or stream_key <> '') not valid;

-- ── L10: a host csak a megengedett mezőket frissítheti, és nem nyithat újra adást ──
revoke update on public.live_sessions from anon, authenticated;
grant update (status, ended_at, viewer_peak, title) on public.live_sessions to authenticated;

create or replace function public.guard_live_session_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'ended' and new.status = 'live' then
    raise exception 'live_session_ended' using errcode = '42501';
  end if;
  if new.status = 'ended' and old.status = 'live' then
    new.ended_at := now();
  elsif new.ended_at is distinct from old.ended_at then
    new.ended_at := old.ended_at;
  end if;
  -- a csúcs-nézőszám csak nőhet, és ésszerű határon belül
  new.viewer_peak := least(greatest(coalesce(new.viewer_peak, 0), old.viewer_peak), 1000000);
  return new;
end;
$$;

drop trigger if exists live_sessions_guard on public.live_sessions;
create trigger live_sessions_guard
  before update on public.live_sessions
  for each row execute function public.guard_live_session_update();

-- ── L2/L12: ELLENŐRZÖTT chat (a nyilvános broadcast hamisítható volt) ─────────────
-- A szerző a bejelentkezett user (RLS), a nevet/avatart a DB tölti (nincs
-- megszemélyesítés), szerveres rate limit, és megmarad a késői csatlakozónak is.
create table if not exists public.live_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.live_sessions (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  author_avatar text,
  body        text not null check (char_length(btrim(body)) between 1 and 300),
  created_at  timestamptz not null default now()
);

create index if not exists live_chat_session_idx on public.live_chat_messages (session_id, created_at desc);

alter table public.live_chat_messages enable row level security;

drop policy if exists "live_chat_select" on public.live_chat_messages;
create policy "live_chat_select" on public.live_chat_messages
  for select to authenticated
  using (exists (select 1 from public.live_sessions s where s.id = session_id and (s.status = 'live' or s.host_id = auth.uid())));

drop policy if exists "live_chat_insert" on public.live_chat_messages;
create policy "live_chat_insert" on public.live_chat_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.live_sessions s where s.id = session_id and s.status = 'live')
  );

-- a host moderálhat (törlés a saját adásában); a szerző a sajátját
drop policy if exists "live_chat_delete" on public.live_chat_messages;
create policy "live_chat_delete" on public.live_chat_messages
  for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.live_sessions s where s.id = session_id and s.host_id = auth.uid())
  );

revoke update on public.live_chat_messages from anon, authenticated;

create or replace function public.live_chat_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  new.author_id := auth.uid();
  -- szerveres rate limit: max 5 üzenet / 10 mp / szerző / adás
  select count(*) into recent
    from public.live_chat_messages m
   where m.session_id = new.session_id
     and m.author_id = new.author_id
     and m.created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'live_chat_rate_limited' using errcode = '54000';
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.username), p.avatar_url
    into new.author_name, new.author_avatar
    from public.profiles p
   where p.id = new.author_id;
  new.body := btrim(new.body);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists live_chat_before_insert on public.live_chat_messages;
create trigger live_chat_before_insert
  before insert on public.live_chat_messages
  for each row execute function public.live_chat_before_insert();

do $$
begin
  alter publication supabase_realtime add table public.live_chat_messages;
exception when duplicate_object then null;
end $$;
