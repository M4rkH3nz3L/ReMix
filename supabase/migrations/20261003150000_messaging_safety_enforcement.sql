-- 🧱 Messaging/social safety ENFORCEMENT (devs/tasks/remix/10) — a block bekötése
-- a feed/komment-láthatóságba + message-report.
--
-- A 20261003140000 létrehozta a `user_blocks` / `conversation_mutes` táblákat és a
-- DM-küldés blokkolását, DE a blokkolt user posztjai/kommentjei MÉG LÁTSZOTTAK a
-- blokkoló feedjében/komment-listájában. Ez a migráció:
--   1) `viewer_blocks(other)` helper — van-e blokk a néző és `other` közt BÁRMELY
--      irányban (A↔B: egyik se lássa a másikat),
--   2) a `posts_select` és `comments_select` RLS kiegészítése ezzel,
--   3) a `reports` kiterjesztése `message` célra (DM/chat-üzenet bejelentése).
-- Additív + idempotens; a legitim láthatóságot nem szűkíti (csak blokkolt irányban).

-- ── 1. viewer_blocks: kétirányú blokk-ellenőrzés (mint a viewer_follows) ──────
create or replace function public.viewer_blocks(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = auth.uid() and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = auth.uid())
  );
$$;
revoke all on function public.viewer_blocks(uuid) from public;
grant execute on function public.viewer_blocks(uuid) to anon, authenticated;

-- ── 2a. posts_select: a blokkolt (bármely irányban) creator posztja nem látszik ─
-- (a saját poszt és a remix-forrás-tulaj ág érintetlen — magadat nem blokkolhatod)
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select using (
    (visibility = 'public' and moderation_status <> 'removed' and not public.is_deleted(creator_id)
      and not public.viewer_blocks(creator_id))
    or (visibility = 'followers' and moderation_status <> 'removed' and not public.is_deleted(creator_id)
        and public.viewer_follows(creator_id) and not public.viewer_blocks(creator_id))
    or creator_id = auth.uid()
    or (remix_of_post_id is not null and public.owns_remix_source(remix_of_post_id))
  );

-- ── 2b. comments_select: a blokkolt szerző kommentje nem látszik (saját marad) ──
drop policy if exists "comments_select" on public.post_comments;
create policy "comments_select" on public.post_comments
  for select using (
    author_id = auth.uid()
    or (
      not public.is_deleted(author_id)
      and not public.viewer_blocks(author_id)
      and exists (
        select 1 from public.posts p
        where p.id = post_comments.post_id
          and (
            (p.visibility = 'public' and p.moderation_status <> 'removed')
            or (p.visibility = 'followers' and p.moderation_status <> 'removed'
                and public.viewer_follows(p.creator_id))
            or p.creator_id = auth.uid()
          )
      )
    )
  );

-- ── 3. reports: 'message' cél (DM/chat-üzenet bejelentése) ───────────────────
alter table public.reports
  add column if not exists message_id uuid references public.messages (id) on delete cascade;

-- A régi check-constraintek NEVE nem garantált (inline definiálva) → introspektíven
-- keressük meg és dobjuk: (a) a target_type értékkészlet-check, (b) a „pontosan egy
-- cél" tábla-szintű check. Utána a bővített változatokat EXPLICIT névvel tesszük be.
do $$
declare v_name text;
begin
  -- (a) target_type értékkészlet
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.reports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%target_type%'
     and pg_get_constraintdef(oid) ilike '%post%'
     and pg_get_constraintdef(oid) not ilike '%is null%'
   limit 1;
  if v_name is not null then
    execute format('alter table public.reports drop constraint %I', v_name);
  end if;

  -- (b) „pontosan egy cél" (a comment_id/post_id null-mintázatra illeszkedik)
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.reports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%comment_id is null%'
   limit 1;
  if v_name is not null then
    execute format('alter table public.reports drop constraint %I', v_name);
  end if;
end $$;

alter table public.reports
  add constraint reports_target_type_ck
  check (target_type in ('post', 'comment', 'message'));

alter table public.reports
  add constraint reports_one_target_ck
  check (
    (target_type = 'post'    and post_id    is not null and comment_id is null and message_id is null)
    or (target_type = 'comment' and comment_id is not null and post_id is null and message_id is null)
    or (target_type = 'message' and message_id is not null and post_id is null and comment_id is null)
  );

create index if not exists reports_message_idx
  on public.reports (message_id) where message_id is not null;
