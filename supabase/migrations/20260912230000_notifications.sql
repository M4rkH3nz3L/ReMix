-- 🔔 Értesítés-rendszer — realtime (Supabase Realtime) + deep-link cél; a
-- push (expo-notifications) később csatlakozik ugyanerre (push_token + worker).
-- A team-working (több szerkesztő) is erre épül majd: komment/meghívó/mention.
--
-- RLS: a user a SAJÁT értesítéseit olvassa/létrehozza/jelöli olvasottnak/törli.
-- A SAJÁT insert engedélyezett (self-notifications: pl. „kész a render"); a
-- CROSS-USER küldés (collab: más usernek) service_role-lal megy (worker /notify),
-- ami megkerüli az RLS-t.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- info | comment | invite | mention | render | system
  type       text not null default 'info',
  title      text not null,
  body       text,
  -- deep-link cél (expo-router útvonal, pl. /editor/<id> vagy /player/<id>)
  route      text,
  data       jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

-- 🔴 realtime: a kliens a saját sorai INSERT/UPDATE-jeire iratkozik fel (RLS szűr)
alter publication supabase_realtime add table public.notifications;

-- 📲 push-token az eszközön (expo push token) — a push-küldéshez (később)
alter table public.user_devices
  add column if not exists push_token text;
