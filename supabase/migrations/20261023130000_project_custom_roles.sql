-- 👥 Projekt-szintű EGYÉNI role-ok (local-ai utáni collab-kör):
-- a tulaj maga definiálja a role-okat és azok projekt-jogait a projekt-beállításokon;
-- a project_members.role mostantól tetszőleges role-id lehet (nem csak owner/editor/
-- viewer), ezért a fix CHECK lekerül. A role-definíciók (jsonb) a project_role_defs
-- sorban élnek; a chat-szoba és a kliens-oldali jogosultság-kapuk ezt öröklik.
-- A kollaboráció nem kapcsolható ki: a szoba mindig él, a „kikapcsolt" állapot
-- egyszerűen üres tagságot jelent.

alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.project_invites drop constraint if exists project_invites_role_check;

create table if not exists public.project_role_defs (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  project_id text not null,
  -- ProjectRole[] (id/name/permissions/builtin) — a kliens normalizálja (projectRoles.ts)
  roles      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, project_id)
);
alter table public.project_role_defs enable row level security;

-- olvasni minden projekt-tag tud (a chat/jog-kapukhoz), írni csak a tulaj
drop policy if exists "role_defs_select_member" on public.project_role_defs;
create policy "role_defs_select_member" on public.project_role_defs
  for select using (public.project_role(owner_id, project_id, auth.uid()) is not null);
drop policy if exists "role_defs_write_owner" on public.project_role_defs;
create policy "role_defs_write_owner" on public.project_role_defs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
