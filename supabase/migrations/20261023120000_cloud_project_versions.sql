-- 🕓 Felhő-verziókezelés a projekteknek: a lokális verzió-pillanatképek
-- (vided.versions.v1.* — kézi snapshotok) felhő-tükre. A `cloud_projects` csak a
-- LEGUTOLSÓ tervet tartja — ez a tábla a névvel mentett verziókat, így a user a
-- felhőből (pl. Google Drive-ra mentett médiával együtt) egy KORÁBBI állapotot
-- is vissza tud állítani, eszközváltás után is. RLS: mindenki csak a sajátját.
-- A (user_id, project_id, version_id) egyedi → az upsert idempotens.

create table if not exists public.cloud_project_versions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  version_id text not null,
  name       text not null default '',
  kind       text not null default 'manual',
  at         timestamptz not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, project_id, version_id)
);
create index if not exists cloud_project_versions_proj_idx
  on public.cloud_project_versions (user_id, project_id, at desc);
alter table public.cloud_project_versions enable row level security;

drop policy if exists "cloud_versions_select_own" on public.cloud_project_versions;
create policy "cloud_versions_select_own" on public.cloud_project_versions
  for select using (user_id = auth.uid());
drop policy if exists "cloud_versions_write_own" on public.cloud_project_versions;
create policy "cloud_versions_write_own" on public.cloud_project_versions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
