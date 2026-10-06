-- 🚧 Restrict (lágy tiltás, audit §4.1) — a tartalom tulajdonosa KORLÁTOZ egy
-- kommentelőt: annak kommentje csak neki + a tulajnak látszik (a feed/komment
-- kliens-oldali szűrése a blocks.ts `isCommentVisible`-jével; a szerver-oldali
-- enforcement külön komment-RLS lesz). A `user_blocks`-mintát követi (owner-only).

create table if not exists public.restricted_users (
  restricter_id uuid not null references auth.users (id) on delete cascade,
  restricted_id uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (restricter_id, restricted_id),
  constraint restricted_users_no_self check (restricter_id <> restricted_id)
);
create index if not exists restricted_users_restricter_idx on public.restricted_users (restricter_id);
alter table public.restricted_users enable row level security;

drop policy if exists "restricted_users_select_own" on public.restricted_users;
create policy "restricted_users_select_own" on public.restricted_users
  for select to authenticated using (restricter_id = auth.uid());
drop policy if exists "restricted_users_insert_own" on public.restricted_users;
create policy "restricted_users_insert_own" on public.restricted_users
  for insert to authenticated with check (restricter_id = auth.uid());
drop policy if exists "restricted_users_delete_own" on public.restricted_users;
create policy "restricted_users_delete_own" on public.restricted_users
  for delete to authenticated using (restricter_id = auth.uid());
