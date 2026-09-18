-- 🛡️ Globális szerepkör + jogosultság rendszer (RBAC) — TESTRE SZABHATÓ.
--
-- KÉT RÉTEG, VAGY-ral kombinálva:
--  1) GLOBÁLIS governance-jogok (ez a tábla): „bármely" tartalom moderálása,
--     user-/szerep-kezelés. A szerep→jog párok SZERKESZTHETŐK (role_permissions),
--     és EGYEDI szerep is létrehozható → minden testre szabható.
--  2) TARTALOM-KÖTÖTT jogok (már megvannak): a projekt tulaja/editora/nézője
--     (project_members) + a poszt tulaja (posts.creator_id). A usernek MINDIG
--     teljes joga van a SAJÁT tartalmához — ezt az RLS a globális joggal VAGY-ozza.
--
-- A `has_permission(uid, kulcs)` a GLOBÁLIS jogot adja; a tartalom-tulajdonlást a
-- meglévő policyk (owner/member) adják, és az RLS így kombinál:
--   (saját tartalom)  OR  has_permission(auth.uid(), '<action>')

-- ── jogosultság-katalógus (kódból seedelt „any-content" governance-jogok) ─────
create table if not exists public.app_permissions (
  key         text primary key,
  label       text not null,
  description text,
  sort        int not null default 0
);

-- ── szerepek (beépített + EGYEDI; a jogokat a role_permissions adja) ──────────
create table if not exists public.app_roles (
  slug       text primary key,
  label      text not null,
  is_system  boolean not null default false,   -- beépített (nem törölhető)
  sort       int not null default 0,
  created_at timestamptz not null default now()
);

-- ── szerep → jog párok (EZ a testreszabás felülete) ───────────────────────────
create table if not exists public.role_permissions (
  role_slug      text not null references public.app_roles (slug) on delete cascade,
  permission_key text not null references public.app_permissions (key) on delete cascade,
  primary key (role_slug, permission_key)
);

-- ── ki milyen szerepben (KÜLÖN tábla → senki nem emelheti a SAJÁT szerepét) ────
create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user' references public.app_roles (slug),
  updated_at timestamptz not null default now()
);

-- ── van-e a usernek GLOBÁLIS joga (SECURITY DEFINER → nincs RLS-rekurzió) ──────
create or replace function public.has_permission(p_uid uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_permissions rp
    where rp.permission_key = p_key
      and rp.role_slug = coalesce(
        (select role from public.user_roles where user_id = p_uid),
        'user'   -- szerep-sor nélkül az alap 'user' (semmilyen governance-jog)
      )
  );
$$;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.has_permission(uuid, text) to anon, authenticated;

-- ── a HÍVÓ jogai (a kliens ezt kéri le belépéskor) ────────────────────────────
create or replace function public.current_user_permissions()
returns table (permission_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.permission_key from public.role_permissions rp
  where rp.role_slug = coalesce(
    (select role from public.user_roles where user_id = auth.uid()), 'user'
  );
$$;
revoke all on function public.current_user_permissions() from public;
grant execute on function public.current_user_permissions() to anon, authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.app_permissions enable row level security;
alter table public.app_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

-- olvasás: minden bejelentkezett láthatja a katalógust/szerepeket (admin-UI + kliens)
drop policy if exists "app_permissions_read" on public.app_permissions;
create policy "app_permissions_read" on public.app_permissions for select using (auth.uid() is not null);

drop policy if exists "app_roles_read" on public.app_roles;
create policy "app_roles_read" on public.app_roles for select using (auth.uid() is not null);

drop policy if exists "role_permissions_read" on public.role_permissions;
create policy "role_permissions_read" on public.role_permissions for select using (auth.uid() is not null);

-- szerepek + szerep→jog ÍRÁSA csak a `role.manage` jog birtokosának
drop policy if exists "app_roles_write" on public.app_roles;
create policy "app_roles_write" on public.app_roles
  for all using (public.has_permission(auth.uid(), 'role.manage'))
  with check (public.has_permission(auth.uid(), 'role.manage'));

drop policy if exists "role_permissions_write" on public.role_permissions;
create policy "role_permissions_write" on public.role_permissions
  for all using (public.has_permission(auth.uid(), 'role.manage'))
  with check (public.has_permission(auth.uid(), 'role.manage'));

-- user_roles: a SAJÁT sorom olvasható, ill. a `user.manage` birtokosa mindenkiét;
-- ÍRNI csak `user.manage` jog birtokosa tud → nincs ön-emelés
drop policy if exists "user_roles_read" on public.user_roles;
create policy "user_roles_read" on public.user_roles
  for select using (user_id = auth.uid() or public.has_permission(auth.uid(), 'user.manage'));

drop policy if exists "user_roles_write" on public.user_roles;
create policy "user_roles_write" on public.user_roles
  for all using (public.has_permission(auth.uid(), 'user.manage'))
  with check (public.has_permission(auth.uid(), 'user.manage'));

-- ── profiles: a `user.manage` birtokosa (admin) MINDEN profilt lát (a user-lista/
--    szerep-kiosztás UI-hoz) — a self-only olvasás mellé ──────────────────────
drop policy if exists "profiles_select_manager" on public.profiles;
create policy "profiles_select_manager" on public.profiles
  for select using (public.has_permission(auth.uid(), 'user.manage'));

-- ── SEED: jogosultság-katalógus (globális „any-content" governance) ───────────
insert into public.app_permissions (key, label, description, sort) values
  ('post.moderate',    'Bármely poszt moderálása',       'Bármely feed-poszt eltávolítása/visszaállítása (nem csak a sajátod).', 10),
  ('comment.moderate', 'Bármely komment törlése',        'Bárki kommentjének törlése bármely poszton.', 20),
  ('report.review',    'Bejelentések kezelése',          'Beérkező tartalom-bejelentések áttekintése/lezárása.', 30),
  ('post.feature',     'Poszt kiemelése',                'Bármely poszt kiemelése/levétele a feedben.', 40),
  ('project.moderate', 'Bármely projekt kezelése',       'Bármely megosztott projekt megtekintése/kezelése (admin).', 50),
  ('user.manage',      'Felhasználók szerepének kezelése','Szerep kiosztása/visszavonása a felhasználóknak.', 60),
  ('role.manage',      'Szerepek és jogok szerkesztése', 'Szerepek létrehozása és a szerep→jog párok testreszabása.', 70)
on conflict (key) do update set label = excluded.label, description = excluded.description, sort = excluded.sort;

-- ── SEED: beépített szerepek ──────────────────────────────────────────────────
insert into public.app_roles (slug, label, is_system, sort) values
  ('user',      'Néző',      true, 0),
  ('creator',   'Alkotó',    true, 1),
  ('moderator', 'Moderátor', true, 2),
  ('admin',     'Admin',     true, 3)
on conflict (slug) do update set label = excluded.label, is_system = true;

-- ── SEED: alap szerep→jog párok (később az admin-UI-ban testreszabható) ───────
-- moderátor: tartalom-moderáció
insert into public.role_permissions (role_slug, permission_key) values
  ('moderator', 'post.moderate'),
  ('moderator', 'comment.moderate'),
  ('moderator', 'report.review')
on conflict do nothing;
-- admin: MINDEN jog
insert into public.role_permissions (role_slug, permission_key)
  select 'admin', key from public.app_permissions
on conflict do nothing;
-- (user és creator: nincs globális governance-jog — a saját tartalmukhoz úgyis
--  teljes joguk van a tartalom-kötött policykból)

-- ── BOOTSTRAP: az első admin (Teszt Elek) — enélkül tojás-tyúk a szerep-kiosztás.
-- FONTOS: FELTÉTELES insert (csak ha a user LÉTEZIK) — különben friss DB-n /
-- `supabase db reset`-nél / éles telepítéskor FK-hibával ELHASALNA a migráció
-- (a user_roles.user_id az auth.users-re hivatkozik). Élesben a valódi admin-t
-- kézzel/ENV-ből kell kiosztani; ez a dev-bootstrap.
insert into public.user_roles (user_id, role)
  select id, 'admin' from auth.users
  where id = 'ade79ce0-f6c5-4283-9ab0-fcb21e20333a'
on conflict (user_id) do update set role = 'admin', updated_at = now();

-- ── komment-moderáció KITERJESZTÉSE: a globális `comment.moderate` jog is töröl ─
-- (a szerző + a poszt-tulaj mellé — így a moderátor/admin BÁRMELY kommentet törli)
drop policy if exists "comments_delete_author_or_owner" on public.post_comments;
create policy "comments_delete_author_or_owner" on public.post_comments
  for delete using (
    author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id and p.creator_id = auth.uid()
    )
    or public.has_permission(auth.uid(), 'comment.moderate')
  );

-- ── globális poszt-moderáció RPC: a `post.moderate` jog birtokosa BÁRMELY posztot
--    removed/ok-ra állíthatja (a tulaj-only saját törlés/remix-moderáció mellett) ─
create or replace function public.moderate_post(p_post uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ok', 'pending', 'removed') then
    raise exception 'moderate_post: érvénytelen státusz %', p_status;
  end if;
  if not public.has_permission(auth.uid(), 'post.moderate') then
    raise exception 'moderate_post: nincs jogosultság';
  end if;
  update public.posts set moderation_status = p_status where id = p_post;
end;
$$;
revoke all on function public.moderate_post(uuid, text) from public, anon;
grant execute on function public.moderate_post(uuid, text) to authenticated;

-- 🔴 realtime: a szerep-változások / jog-szerkesztés élő követése az admin-UI-ban
alter publication supabase_realtime add table public.user_roles;
alter publication supabase_realtime add table public.role_permissions;
