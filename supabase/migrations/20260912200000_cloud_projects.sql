-- ☁️ Cloud-sync (Phase 5.1 alap) — a projekt TELJES állapota (JSON) felhő-mentése
-- userenként. A médiafájlok (Supabase Storage) szinkronja külön, későbbi lépés;
-- ez a projekt-JSON backup/restore alapja. Pro-funkció (a kliens `cloudSync`
-- capability-vel gate-eli).
--
-- RLS: a user CSAK a saját mentéseit látja/írja.

create table if not exists public.cloud_projects (
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  name       text,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists cloud_projects_user_idx on public.cloud_projects (user_id, updated_at desc);

alter table public.cloud_projects enable row level security;

drop policy if exists "cloud_projects_select_own" on public.cloud_projects;
create policy "cloud_projects_select_own" on public.cloud_projects
  for select using (auth.uid() = user_id);

drop policy if exists "cloud_projects_insert_own" on public.cloud_projects;
create policy "cloud_projects_insert_own" on public.cloud_projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "cloud_projects_update_own" on public.cloud_projects;
create policy "cloud_projects_update_own" on public.cloud_projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cloud_projects_delete_own" on public.cloud_projects;
create policy "cloud_projects_delete_own" on public.cloud_projects
  for delete using (auth.uid() = user_id);

-- updated_at karbantartása (a profiles-migrációban definiált set_updated_at)
drop trigger if exists cloud_projects_set_updated_at on public.cloud_projects;
create trigger cloud_projects_set_updated_at
  before update on public.cloud_projects
  for each row execute function public.set_updated_at();
