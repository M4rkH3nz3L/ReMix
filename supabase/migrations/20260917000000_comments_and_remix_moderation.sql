-- 💬 Komment-rendszer + 🔀 remix-moderáció (tulajdonosi felügyelet).
--
-- Komment: post_comments tábla RLS-szel — a SZERZŐ törli a sajátját, a
-- POSZT-TULAJ bármely kommentet a saját posztján (moderáció). A számlálót a
-- meglévő generikus bump_post_counter trigger tartja; új komment → értesítés a
-- poszt-tulajnak.
--
-- Remix-moderáció: az EREDETI tartalom tulajdonosa a belőle SZÁRMAZÓ remixet
-- 'removed'-ra állíthatja (kikerül a nyilvános feedből, VISSZAFORDÍTHATÓ) a
-- moderate_remix RPC-vel — más eredeti tartalmát NEM érinti. A posts_select
-- bővül, hogy a tulaj LÁSSA a removed remixeket (felügyelet/visszaállítás).

-- ── segéd: birtoklom-e a remix FORRÁS-posztját? ─────────────────────────────
-- RLS-rekurzió elkerülése: security definer → a belső posts-olvasás megkerüli az
-- RLS-t (a definer tulajdonosaként fut), az auth.uid() viszont a HÍVÓ-é marad.
create or replace function public.owns_remix_source(p_source uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.posts
    where id = p_source and creator_id = auth.uid()
  );
$$;
-- FONTOS: az `anon` szerepnek is EXECUTE kell — a posts_select RLS-policy hívja,
-- és a kijelentkezett (public feed) olvasás anon szerepként fut. Enélkül 42501.
revoke all on function public.owns_remix_source(uuid) from public;
grant execute on function public.owns_remix_source(uuid) to anon, authenticated;

-- ── posts_select bővítése: a removed remixet LÁSSA az eredeti tulaj is ──────
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select using (
    (visibility in ('public', 'unlisted') and moderation_status <> 'removed')
    or creator_id = auth.uid()
    or (remix_of_post_id is not null and public.owns_remix_source(remix_of_post_id))
  );

-- ── remix-moderáció RPC: az eredeti tulaj a remixet 'removed'/'ok'-ra állítja ─
create or replace function public.moderate_remix(p_remix uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source uuid;
begin
  if p_status not in ('ok', 'removed') then
    raise exception 'moderate_remix: érvénytelen státusz %', p_status;
  end if;
  select remix_of_post_id into v_source from public.posts where id = p_remix;
  if v_source is null then
    raise exception 'moderate_remix: a poszt nem remix';
  end if;
  -- CSAK a remix FORRÁS-posztjának tulajdonosa moderálhat
  if not exists (select 1 from public.posts where id = v_source and creator_id = auth.uid()) then
    raise exception 'moderate_remix: nincs jogosultság';
  end if;
  update public.posts set moderation_status = p_status where id = p_remix;
end;
$$;
revoke all on function public.moderate_remix(uuid, text) from public, anon;
grant execute on function public.moderate_remix(uuid, text) to authenticated;

-- ── komment-tábla ───────────────────────────────────────────────────────────
create table if not exists public.post_comments (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references public.posts (id) on delete cascade,
  author_id        uuid not null references auth.users (id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 2000),
  -- denormalizált szerző (nincs cross-profil olvasás — mint a posztnál)
  author_username  text,
  author_name      text,
  author_avatar    text,
  created_at       timestamptz not null default now()
);
create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at desc);
alter table public.post_comments enable row level security;

-- olvasás: a saját kommentem, VAGY olyan poszté, amit egyébként is látok
drop policy if exists "comments_select" on public.post_comments;
create policy "comments_select" on public.post_comments
  for select using (
    author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id
        and ((p.visibility in ('public', 'unlisted') and p.moderation_status <> 'removed')
             or p.creator_id = auth.uid())
    )
  );

-- beszúrás: csak a saját nevemben, létező+látható posztra
drop policy if exists "comments_insert_own" on public.post_comments;
create policy "comments_insert_own" on public.post_comments
  for insert with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id
        and ((p.visibility in ('public', 'unlisted') and p.moderation_status <> 'removed')
             or p.creator_id = auth.uid())
    )
  );

-- szerkesztés: a szerző a saját kommentjét
drop policy if exists "comments_update_own" on public.post_comments;
create policy "comments_update_own" on public.post_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

-- törlés: a SZERZŐ a sajátját, VAGY a POSZT-TULAJ bármelyiket a posztján (moderáció)
drop policy if exists "comments_delete_author_or_owner" on public.post_comments;
create policy "comments_delete_author_or_owner" on public.post_comments
  for delete using (
    author_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id and p.creator_id = auth.uid()
    )
  );

-- komment-számláló a meglévő generikus triggerrel (posts.comments)
drop trigger if exists post_comments_count on public.post_comments;
create trigger post_comments_count
  after insert or delete on public.post_comments
  for each row execute function public.bump_post_counter('comments');

-- új komment → értesítés a poszt-tulajnak (ha nem ő kommentelt)
create or replace function public.on_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, title, body, route, data)
  select p.creator_id, 'comment', 'Új komment 💬',
         coalesce(new.author_name, 'Valaki') || ': ' || left(new.body, 80),
         '/feed', jsonb_build_object('postId', new.post_id, 'commentId', new.id, 'kind', 'comment')
    from public.posts p
   where p.id = new.post_id and p.creator_id <> new.author_id;
  return new;
end;
$$;
drop trigger if exists post_comments_notify on public.post_comments;
create trigger post_comments_notify
  after insert on public.post_comments
  for each row execute function public.on_comment_insert();

-- 🔴 realtime: élő kommentek
alter publication supabase_realtime add table public.post_comments;
