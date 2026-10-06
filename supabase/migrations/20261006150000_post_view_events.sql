-- 👁️ Nézési események (audit §4.3) — a For-You ranking VALÓS jeleihez
-- (végignézés/újranézés; a `viewSignals.ts` aggregálja). A hitelesített néző a
-- SAJÁT nézését rögzíti; a poszt TULAJDONOSA látja a saját posztjai eseményeit
-- (owner-analytics). A ranking server-oldali aggregációja a service_role-lal fut
-- (megkerüli az RLS-t). Forgalom-érzékeny → a watched/duration ms-ban, minimál.

create table if not exists public.post_view_events (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  viewer_id   uuid not null references auth.users (id) on delete cascade,
  watched_ms  integer not null default 0 check (watched_ms >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists post_view_events_post_idx on public.post_view_events (post_id);
create index if not exists post_view_events_viewer_idx on public.post_view_events (viewer_id);
alter table public.post_view_events enable row level security;

-- a néző a SAJÁT nézési eseményét szúrhatja be
drop policy if exists "view_events_insert_own" on public.post_view_events;
create policy "view_events_insert_own" on public.post_view_events
  for insert to authenticated with check (viewer_id = auth.uid());

-- a poszt TULAJDONOSA olvassa a saját posztjai eseményeit (owner-analytics);
-- a néző a sajátjait is olvashatja
drop policy if exists "view_events_select_owner_or_self" on public.post_view_events;
create policy "view_events_select_owner_or_self" on public.post_view_events
  for select to authenticated using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.creator_id = auth.uid()
    )
  );
