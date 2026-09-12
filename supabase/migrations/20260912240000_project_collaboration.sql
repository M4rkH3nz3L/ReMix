-- 👥 Projekt-kollaboráció — tagok + szerepkörök (owner | editor | viewer).
--
-- A megosztott projektet a `cloud_projects` sor hordozza (a tulaj felhő-másolata,
-- Pro). Fölé kerül egy ACL-réteg: `project_members` (ki tag + milyen szerepben).
-- A szerep-alapú ÍRÁST az RLS kényszeríti ki: néző FIZIKAILAG nem tud a
-- cloud_projects-be írni, csak olvasni.
--
-- Kulcs-döntések:
--  • a projektet a (tulaj = owner_id, project_id) pár azonosítja — pontosan a
--    cloud_projects PK-ja; a tagságok FK-val ehhez kötődnek (törlés → cascade),
--    így megosztani CSAK felhőre mentett (Pro) projektet lehet.
--  • a taglista megjelenítendő mezői (email, név, projektnév) DENORMALIZÁLTAK a
--    project_members-ben → a tag nem olvassa más profilját (profiles RLS: saját).
--  • a szerep-lekérdezés SECURITY DEFINER függvény (project_role) → nincs
--    RLS-rekurzió a self-referáló policykben.
--  • meghívás nem-létező e-mailre: `project_invites` (pending) → a meghívott
--    regisztrációjakor trigger tagsággá alakítja + értesítést ír.

-- ── tagok ─────────────────────────────────────────────────────────────────────
create table if not exists public.project_members (
  owner_id     uuid not null,                 -- = cloud_projects.user_id (tulaj)
  project_id   text not null,                 -- = cloud_projects.project_id
  member_id    uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('owner', 'editor', 'viewer')),
  -- megjelenítéshez denormalizálva (nincs cross-profil olvasás):
  project_name text,
  email        text,
  display_name text,
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  primary key (owner_id, project_id, member_id),
  foreign key (owner_id, project_id)
    references public.cloud_projects (user_id, project_id) on delete cascade
);

create index if not exists project_members_member_idx
  on public.project_members (member_id, created_at desc);

-- ── szerepkör-lekérdező (RLS-rekurzió elkerülésére SECURITY DEFINER) ──────────
create or replace function public.project_role(p_owner uuid, p_project text, p_uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
    from public.project_members
   where owner_id = p_owner
     and project_id = p_project
     and member_id = p_uid
   limit 1;
$$;

alter table public.project_members enable row level security;

-- SELECT: a projekt BÁRMELY tagja látja a teljes taglistát (a szerep-fn dönt)
drop policy if exists "members_select_shared" on public.project_members;
create policy "members_select_shared" on public.project_members
  for select using (
    member_id = auth.uid()
    or public.project_role(owner_id, project_id, auth.uid()) is not null
  );

-- INSERT: a tulaj vehet fel tagot (a saját projektjéhez). A cross-user meghívást
-- a worker service_role-lal intézi (megkerüli az RLS-t) — a névfeloldás miatt.
drop policy if exists "members_insert_owner" on public.project_members;
create policy "members_insert_owner" on public.project_members
  for insert with check (owner_id = auth.uid());

-- UPDATE: szerep-váltás csak a tulajnak
drop policy if exists "members_update_owner" on public.project_members;
create policy "members_update_owner" on public.project_members
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- DELETE: a tulaj bárkit eltávolíthat; a tag SAJÁT magát (kilépés)
drop policy if exists "members_delete_owner_or_self" on public.project_members;
create policy "members_delete_owner_or_self" on public.project_members
  for delete using (owner_id = auth.uid() or member_id = auth.uid());

-- ── pending meghívók (még nem regisztrált e-mailre) ──────────────────────────
create table if not exists public.project_invites (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,
  project_id   text not null,
  project_name text,
  email        text not null,
  role         text not null check (role in ('editor', 'viewer')),
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  unique (owner_id, project_id, email),
  foreign key (owner_id, project_id)
    references public.cloud_projects (user_id, project_id) on delete cascade
);

create index if not exists project_invites_email_idx on public.project_invites (lower(email));

alter table public.project_invites enable row level security;

-- csak a tulaj látja/kezeli a saját függő meghívóit (a konverzió service_role/trigger)
drop policy if exists "invites_all_owner" on public.project_invites;
create policy "invites_all_owner" on public.project_invites
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ── cloud_projects RLS kiterjesztése: a TAGOK is olvashatnak/írhatnak szerep szerint ──
-- olvasás: tulaj VAGY bármely tag
drop policy if exists "cloud_projects_select_own" on public.cloud_projects;
drop policy if exists "cloud_projects_select_member" on public.cloud_projects;
create policy "cloud_projects_select_member" on public.cloud_projects
  for select using (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) is not null
  );

-- írás (frissítés): tulaj VAGY editor tag (a viewer nem — ezért fizikailag nem push-olhat)
drop policy if exists "cloud_projects_update_own" on public.cloud_projects;
drop policy if exists "cloud_projects_update_member" on public.cloud_projects;
create policy "cloud_projects_update_member" on public.cloud_projects
  for update using (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) in ('owner', 'editor')
  ) with check (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) in ('owner', 'editor')
  );
-- (insert/delete marad tulaj-only: a projektet a tulaj hozza létre/törli)

-- ── e-mail → user_id feloldás (CSAK a worker service_role hívja) ──────────────
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

-- ── pending meghívók tagsággá alakítása a meghívott regisztrációjakor ─────────
create or replace function public.convert_project_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
  dname text := nullif(new.raw_user_meta_data ->> 'full_name', '');
begin
  for inv in
    select * from public.project_invites where lower(email) = lower(new.email)
  loop
    insert into public.project_members
      (owner_id, project_id, member_id, role, project_name, email, display_name, invited_by)
    values
      (inv.owner_id, inv.project_id, new.id, inv.role, inv.project_name, new.email, dname, inv.invited_by)
    on conflict (owner_id, project_id, member_id) do nothing;

    insert into public.notifications (user_id, type, title, body, route, data)
    values (
      new.id, 'invite',
      'Meghívó egy projektbe',
      coalesce(inv.project_name, 'Projekt') || ' — ' || inv.role,
      '/collab/' || inv.project_id || '?owner=' || inv.owner_id::text,
      jsonb_build_object('ownerId', inv.owner_id, 'projectId', inv.project_id, 'role', inv.role)
    );

    delete from public.project_invites where id = inv.id;
  end loop;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_convert_invites on auth.users;
create trigger on_auth_user_created_convert_invites
  after insert on auth.users
  for each row execute function public.convert_project_invites();

-- 🔴 realtime: a taglista élő frissítése (meghívás/szerep-váltás/eltávolítás)
alter publication supabase_realtime add table public.project_members;
