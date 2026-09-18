-- 🗑️ Soft delete (fiók-deaktiválás) — a felhasználó „törölheti" a fiókját, de az
-- adat NEM vész el véglegesen: `profiles.deleted_at` beáll, a tartalma eltűnik a
-- platformról (más nem látja), és VISSZAÁLLÍTHATÓ (reactivate). A tulaj a saját
-- (rejtett) tartalmát továbbra is látja belépve → helyreállítható a fiók.

alter table public.profiles add column if not exists deleted_at timestamptz;

-- soft-törölt-e egy user (SECURITY DEFINER → az RLS-ben is hívható, anon-ra is;
-- megkerüli a profiles-RLS-t, mint az owns_remix_source; enélkül 42501)
create or replace function public.is_deleted(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and deleted_at is not null
  );
$$;
revoke all on function public.is_deleted(uuid) from public;
grant execute on function public.is_deleted(uuid) to anon, authenticated;

-- a hívó FIÓKJÁNAK soft-törlése / visszaállítása
create or replace function public.soft_delete_account()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set deleted_at = now() where id = auth.uid();
$$;
revoke all on function public.soft_delete_account() from public, anon;
grant execute on function public.soft_delete_account() to authenticated;

create or replace function public.reactivate_account()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set deleted_at = null where id = auth.uid();
$$;
revoke all on function public.reactivate_account() from public, anon;
grant execute on function public.reactivate_account() to authenticated;

-- ── a POSZTOK elrejtése: soft-törölt alkotó posztjai nem látszanak másnak ──────
-- (a tulaj a `creator_id = auth.uid()` ágon TOVÁBBRA is látja a sajátját)
drop policy if exists "posts_select" on public.posts;
create policy "posts_select" on public.posts
  for select using (
    (visibility in ('public', 'unlisted')
      and moderation_status <> 'removed'
      and not public.is_deleted(creator_id))
    or creator_id = auth.uid()
    or (remix_of_post_id is not null and public.owns_remix_source(remix_of_post_id))
  );

-- ── a KOMMENTEK elrejtése: soft-törölt szerző kommentje nem látszik másnak ─────
drop policy if exists "comments_select" on public.post_comments;
create policy "comments_select" on public.post_comments
  for select using (
    author_id = auth.uid()
    or (
      not public.is_deleted(author_id)
      and exists (
        select 1 from public.posts p
        where p.id = post_comments.post_id
          and ((p.visibility in ('public', 'unlisted') and p.moderation_status <> 'removed')
               or p.creator_id = auth.uid())
      )
    )
  );
