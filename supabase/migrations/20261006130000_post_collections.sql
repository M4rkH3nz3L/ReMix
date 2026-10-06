-- 📁 Social collections (audit §4.4) — a mentett posztok felhasználói MAPPÁI/
-- playlistjei. A kollekció a tulajdonosé (RLS: user_id = auth.uid()); az elemek
-- a kollekció tulajdonlásán át érhetők el. A poszt törlése kaszkádol (az elem
-- eltűnik), a kollekció törlése is viszi az elemeit.

create table if not exists public.post_collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists post_collections_user_idx on public.post_collections (user_id);
alter table public.post_collections enable row level security;

drop policy if exists "collections_select_own" on public.post_collections;
create policy "collections_select_own" on public.post_collections
  for select using (user_id = auth.uid());
drop policy if exists "collections_write_own" on public.post_collections;
create policy "collections_write_own" on public.post_collections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.post_collection_items (
  collection_id uuid not null references public.post_collections (id) on delete cascade,
  post_id       uuid not null references public.posts (id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists post_collection_items_post_idx on public.post_collection_items (post_id);
alter table public.post_collection_items enable row level security;

-- Az elemekhez a hozzáférés a KOLLEKCIÓ tulajdonlásán át (a user csak a saját
-- kollekciói elemeit látja/írja). A poszt publikussága a feed-RLS dolga; ide csak
-- a saját kollekció-szervezés tartozik.
drop policy if exists "collection_items_select_own" on public.post_collection_items;
create policy "collection_items_select_own" on public.post_collection_items
  for select using (
    exists (
      select 1 from public.post_collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );
drop policy if exists "collection_items_write_own" on public.post_collection_items;
create policy "collection_items_write_own" on public.post_collection_items
  for all using (
    exists (
      select 1 from public.post_collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.post_collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );
