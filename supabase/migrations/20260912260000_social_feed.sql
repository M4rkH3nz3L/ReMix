-- 📱 Social réteg — CSATORNA + TikTok-szerű FEED. A poszt a Project Model egy
-- NÉZETE (projectId + hordozott project_snapshot) → a feed bármely videója
-- megnyitható/REMIXELHETŐ a Studióban. Ez adja a „studio az alap" kapcsolatot.
--
-- Szerver-backend (Supabase), hogy a userek TÉNYLEG lássák egymás tartalmát. Az
-- adatmodell a src/types/social.ts alakját követi. Engagement szerver-hitelesen:
-- a számlálókat triggerek tartják; a like/save/follow a saját sorodon megy (RLS).

-- ── posztok ───────────────────────────────────────────────────────────────────
create table if not exists public.posts (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references auth.users (id) on delete cascade,
  project_id        text,                       -- helyi projekt (tulaj lejátszás/remix)
  title             text not null,
  description       text,
  hashtags          text[] not null default '{}',
  video_url         text,                       -- renderelt MP4 (Storage) — később
  poster_url        text,                       -- borítókocka
  aspect_ratio      text not null default '9:16',
  duration_sec      numeric not null default 0,
  project_snapshot  jsonb,                      -- hordozható a REMIXhez
  visibility        text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  moderation_status text not null default 'ok'  check (moderation_status in ('ok', 'pending', 'removed')),
  remixable         boolean not null default true,
  remix_of_post_id  uuid references public.posts (id) on delete set null,
  remix_of_creator  text,
  music             text,
  -- denormalizált alkotó (nincs cross-profil olvasás a feedben)
  creator_username  text,
  creator_name      text,
  creator_avatar    text,
  -- engagement-számlálók (triggerek + RPC tartják)
  likes             integer not null default 0,
  comments          integer not null default 0,
  saves             integer not null default 0,
  views             integer not null default 0,
  remixes           integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists posts_feed_idx on public.posts (visibility, moderation_status, created_at desc);
create index if not exists posts_creator_idx on public.posts (creator_id, created_at desc);
alter table public.posts enable row level security;

-- olvasás: publikus/unlisted (nem removed), vagy a sajátom
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select using (
    (visibility in ('public', 'unlisted') and moderation_status <> 'removed')
    or creator_id = auth.uid()
  );
drop policy if exists "posts_insert_own" on public.posts;
create policy "posts_insert_own" on public.posts
  for insert with check (creator_id = auth.uid());
drop policy if exists "posts_update_own" on public.posts;
create policy "posts_update_own" on public.posts
  for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());
drop policy if exists "posts_delete_own" on public.posts;
create policy "posts_delete_own" on public.posts
  for delete using (creator_id = auth.uid());

-- ── kedvelések ────────────────────────────────────────────────────────────────
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists "likes_select_own" on public.post_likes;
create policy "likes_select_own" on public.post_likes
  for select using (user_id = auth.uid());
drop policy if exists "likes_write_own" on public.post_likes;
create policy "likes_write_own" on public.post_likes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── mentések ──────────────────────────────────────────────────────────────────
create table if not exists public.post_saves (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_saves enable row level security;
drop policy if exists "saves_select_own" on public.post_saves;
create policy "saves_select_own" on public.post_saves
  for select using (user_id = auth.uid());
drop policy if exists "saves_write_own" on public.post_saves;
create policy "saves_write_own" on public.post_saves
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── követés (social gráf) ─────────────────────────────────────────────────────
create table if not exists public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
alter table public.follows enable row level security;
-- lásd a saját követéseimet ÉS a követőimet
drop policy if exists "follows_select" on public.follows;
create policy "follows_select" on public.follows
  for select using (follower_id = auth.uid() or following_id = auth.uid());
drop policy if exists "follows_write_own" on public.follows;
create policy "follows_write_own" on public.follows
  for all using (follower_id = auth.uid()) with check (follower_id = auth.uid());

-- ── számláló-triggerek (like/save) ────────────────────────────────────────────
create or replace function public.bump_post_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  col text := tg_argv[0];
  delta int := case when tg_op = 'INSERT' then 1 else -1 end;
  pid uuid := case when tg_op = 'INSERT' then new.post_id else old.post_id end;
begin
  execute format('update public.posts set %I = greatest(0, %I + $1) where id = $2', col, col)
    using delta, pid;
  return null;
end;
$$;

drop trigger if exists post_likes_count on public.post_likes;
create trigger post_likes_count
  after insert or delete on public.post_likes
  for each row execute function public.bump_post_counter('likes');

drop trigger if exists post_saves_count on public.post_saves;
create trigger post_saves_count
  after insert or delete on public.post_saves
  for each row execute function public.bump_post_counter('saves');

-- ── remix-attribúció: remix-poszt beszúrásakor a forrás remixes++ + értesítés ─
create or replace function public.on_post_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.remix_of_post_id is not null then
    update public.posts set remixes = remixes + 1 where id = new.remix_of_post_id;
    insert into public.notifications (user_id, type, title, body, route, data)
    select p.creator_id, 'mention', 'Remixelték a videódat 🔀',
           coalesce(new.creator_name, 'Valaki') || ' remixelte: ' || new.title,
           '/feed', jsonb_build_object('postId', new.id, 'kind', 'remix')
      from public.posts p
     where p.id = new.remix_of_post_id and p.creator_id <> new.creator_id;
  end if;
  return new;
end;
$$;
drop trigger if exists posts_after_insert on public.posts;
create trigger posts_after_insert
  after insert on public.posts
  for each row execute function public.on_post_insert();

-- ── követés → értesítés ───────────────────────────────────────────────────────
create or replace function public.on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, title, body, route, data)
  values (
    new.following_id, 'system', 'Új követőd van 👤',
    'Valaki követni kezdett téged.',
    '/channel/' || new.follower_id::text,
    jsonb_build_object('followerId', new.follower_id, 'kind', 'follow')
  );
  return new;
end;
$$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.on_follow();

-- ── megtekintés-számláló (bárki növelheti a saját nézésével) ──────────────────
create or replace function public.record_post_view(p_post uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.posts set views = views + 1 where id = p_post;
$$;
revoke all on function public.record_post_view(uuid) from public, anon;
grant execute on function public.record_post_view(uuid) to authenticated;

-- 🔴 realtime: élő feed / számlálók
alter publication supabase_realtime add table public.posts;
