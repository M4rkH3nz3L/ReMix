-- 👁️ Per-tartalom láthatóság — TikTok-modell: Nyilvános / Követők / Privát.
--
-- A 'followers' ÚJ tier: a posztot csak az látja, aki KÖVETI az alkotót (egyirányú
-- követés). A 'public' mindenkinek (feed), a 'private' csak az alkotónak. A korábbi
-- 'unlisted' megszűnik (friss DB — a defenzív UPDATE a maradékot 'public'-ra állítja).
-- A follow-ellenőrzés SECURITY DEFINER helperrel megy: nincs RLS-rekurzió a follows-ra,
-- és anon-ra is jár (a kijelentkezett public-feed olvasás anon szerepként fut).

-- ── követem-e az alkotót? (RLS-ben hívható; anon/kijelentkezett → false) ──────
create or replace function public.viewer_follows(p_creator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.follows
    where follower_id = auth.uid() and following_id = p_creator
  );
$$;
revoke all on function public.viewer_follows(uuid) from public;
grant execute on function public.viewer_follows(uuid) to anon, authenticated;

-- ── visibility értékkészlet: public | followers | private ────────────────────
update public.posts set visibility = 'public' where visibility = 'unlisted';
alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public', 'followers', 'private'));

-- ── posts_select: public mindenkinek; followers a KÖVETŐKNEK; saját; remix-forrás tulaj ─
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select using (
    (visibility = 'public' and moderation_status <> 'removed' and not public.is_deleted(creator_id))
    or (visibility = 'followers' and moderation_status <> 'removed' and not public.is_deleted(creator_id)
        and public.viewer_follows(creator_id))
    or creator_id = auth.uid()
    or (remix_of_post_id is not null and public.owns_remix_source(remix_of_post_id))
  );

-- ── comments_select: a komment akkor látszik, ha a poszt látható a nézőnek ────
drop policy if exists "comments_select" on public.post_comments;
create policy "comments_select" on public.post_comments
  for select using (
    author_id = auth.uid()
    or (
      not public.is_deleted(author_id)
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
