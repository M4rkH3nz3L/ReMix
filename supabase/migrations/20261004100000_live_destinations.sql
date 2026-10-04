-- 🎥 Live multistream célok (LIVE.md Fázis E) — a felhasználó külső RTMP-céljai
-- (YouTube/TikTok/Twitch/Facebook/custom). A worker a LiveKit Egresszel streameli
-- ide az adást. A `stream_key` ÉRZÉKENY: owner-only RLS (más nem látja); a kliens
-- SOHA nem küldi broadcast-csatornán (a live-doc csak platform-toggle, kulcs nélkül),
-- és a listázó kliens-lekérés sem adja vissza (lásd src/lib/liveDestinations.ts).
-- A worker service_role-lal olvassa az egress-indításkor.

create table if not exists public.live_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'tiktok', 'twitch', 'facebook', 'custom')),
  label text not null,
  rtmp_url text not null,
  stream_key text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists live_destinations_user_idx on public.live_destinations (user_id);

alter table public.live_destinations enable row level security;

-- Owner-only: a felhasználó CSAK a saját céljait látja/kezeli. A `stream_key` így
-- más elől védett; a worker a service_role-lal (RLS-megkerülő) olvassa.
create policy "live_destinations_select_own" on public.live_destinations
  for select using (auth.uid() = user_id);

create policy "live_destinations_insert_own" on public.live_destinations
  for insert with check (auth.uid() = user_id);

create policy "live_destinations_update_own" on public.live_destinations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "live_destinations_delete_own" on public.live_destinations
  for delete using (auth.uid() = user_id);
