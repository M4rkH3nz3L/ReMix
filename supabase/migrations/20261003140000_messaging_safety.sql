-- 🧱 Messaging safety (devs/tasks/remix/10): block + mute.
--
-- GAP: eddig bármely user DM-elhetett bárkit; nem volt block (letiltás) és mute
-- (némítás). Ez a migráció additív: két új tábla (owner-only RLS) + egy RESTRICTIVE
-- policy a messages-re, ami a BLOKKOLT feladótól nem enged üzenetet.
--
-- ⚠️ A restrictive messages-policy a küldést befolyásolja → éles push ELŐTT
-- RLS-teszt ajánlott (lokális supabase / staging). Az app a legitim küldést nem
-- töri (csak blokkolt irányban tilt).

-- ── user_blocks: ki kit tiltott le (irányított) ──────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
alter table public.user_blocks enable row level security;

-- a felhasználó CSAK a SAJÁT blokkjait látja/kezeli (más blokkjait nem olvashatja)
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ── conversation_mutes: némított beszélgetések (per user) ─────────────────────
create table if not exists public.conversation_mutes (
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table public.conversation_mutes enable row level security;

drop policy if exists "conversation_mutes_own" on public.conversation_mutes;
create policy "conversation_mutes_own" on public.conversation_mutes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── messages: BLOKKOLT feladótól ne fogadjon ─────────────────────────────────
-- RESTRICTIVE → a meglévő permissive "messages_insert" MELLÉ AND-elődik: a küldés
-- csak akkor megy, ha a feladó tag (meglévő policy) ÉS a beszélgetés egyetlen MÁS
-- tagja sem tiltotta le a feladót.
drop policy if exists "messages_not_from_blocked" on public.messages;
create policy "messages_not_from_blocked" on public.messages
  as restrictive
  for insert to authenticated
  with check (
    not exists (
      select 1
      from public.conversation_members cm
      join public.user_blocks b on b.blocker_id = cm.user_id
      where cm.conversation_id = messages.conversation_id
        and cm.user_id <> auth.uid()
        and b.blocked_id = auth.uid()
    )
  );
