-- 🧠📁🗂️ Creator OS platform-mag felhő-perzisztenciája (PM1–PM4).
--
-- A négy platform-mag mag (Creator Memory · Universal Asset Library · Workspace ·
-- Creative Graph/⌘K) állapota TISZTA, szerializálható JSON — ezért per-user EGY
-- JSONB-dokumentumként tároljuk (a repo „kis JSON a DB-ben" hibrid mintája, mint
-- a cloud_projects projekt-terv). A kliens (`@/lib/creatorMemory` stb.) maga a
-- lekérdező-motor, így nincs szükség szerver-oldali normalizálásra.
--
-- Hatókör:
--   • creator_memory  — PER USER (a creator perzisztens AI-identitása)
--   • asset_library   — PER USER (a „My Assets" közös könyvtár)
--   • workspace       — PER USER (a projekt-refek/notes/tasks/brand/sablon; a
--                       library/memory NINCS benne duplikálva — külön tárolt)
--
-- Minden tábla PRIVÁT (owner-only RLS). Az adatbiztonság miatt INGYENES (mint a
-- cloud_projects) — a Pro-érték a nehéz felhő (média-sync/HD-render/AI) marad.
-- Minden additív, `if not exists`, nullázható → régi userekre is biztonságos.
-- Az updated_at karbantartáshoz a MEGLÉVŐ public.set_updated_at() triggert
-- használjuk (20260911120000-ban definiálva).

-- ── 1) Creator Memory (per user) ─────────────────────────────────────────────
create table if not exists public.creator_memory (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,   -- CreatorMemory { facts[], updatedAt }
  updated_at timestamptz not null default now()
);
alter table public.creator_memory enable row level security;

drop policy if exists "creator_memory_own" on public.creator_memory;
create policy "creator_memory_own" on public.creator_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists creator_memory_touch on public.creator_memory;
create trigger creator_memory_touch before update on public.creator_memory
  for each row execute function public.set_updated_at();

-- ── 2) Universal Asset Library (per user) ────────────────────────────────────
create table if not exists public.asset_library (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,   -- AssetLibrary { assets[], collections[], updatedAt }
  updated_at timestamptz not null default now()
);
alter table public.asset_library enable row level security;

drop policy if exists "asset_library_own" on public.asset_library;
create policy "asset_library_own" on public.asset_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists asset_library_touch on public.asset_library;
create trigger asset_library_touch before update on public.asset_library
  for each row execute function public.set_updated_at();

-- ── 3) Workspace (per user; library/memory nélkül) ───────────────────────────
create table if not exists public.workspace (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,   -- WorkspaceDoc { id,name,projects[],notes[],tasks[],brands[],templates[] }
  updated_at timestamptz not null default now()
);
alter table public.workspace enable row level security;

drop policy if exists "workspace_own" on public.workspace;
create policy "workspace_own" on public.workspace
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists workspace_touch on public.workspace;
create trigger workspace_touch before update on public.workspace
  for each row execute function public.set_updated_at();
