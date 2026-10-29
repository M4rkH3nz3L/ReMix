-- 🔀 PRO-VIDEO B27: a remix-engedély SZERVER-oldali érvényesítése.
--
-- Eddig a `remixable` csak a kliens-oldalon számított (és publikáláskor mindig true
-- volt) → egy módosított kliens bármelyik posztra hivatkozó remix-posztot beszúrhatott.
-- Most a DB dönt: nem remixelhető (vagy a remixelő számára nem látható) forrás-posztra
-- hivatkozó remix-poszt NEM szúrható be / nem állítható át. A saját poszt remixe
-- (ugyanaz az alkotó) mindig engedett.

create or replace function public.enforce_remix_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  src_creator uuid;
  src_remixable boolean;
  src_visibility text;
begin
  if new.remix_of_post_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.remix_of_post_id is not distinct from old.remix_of_post_id then
    return new;
  end if;

  select p.creator_id, p.remixable, p.visibility
    into src_creator, src_remixable, src_visibility
    from public.posts p
   where p.id = new.remix_of_post_id;

  if not found then
    return new; -- a forrás törölve (az FK on delete set null kezeli)
  end if;

  if src_creator = new.creator_id then
    return new; -- saját poszt remixe
  end if;

  if src_remixable is not true or src_visibility = 'private' then
    raise exception 'remix_not_allowed' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists posts_enforce_remix on public.posts;
create trigger posts_enforce_remix
  before insert or update of remix_of_post_id on public.posts
  for each row execute function public.enforce_remix_permission();
