-- 📊 Csatorna-statisztika — publikus aggregátum (követők/követettek/posztok). Az
-- RLS elrejti mások follow-sorait, ezért SECURITY DEFINER függvény adja a
-- számokat (csak darabszám, érzékeny adat nélkül).
create or replace function public.channel_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'followers', (select count(*) from public.follows where following_id = p_user),
    'following', (select count(*) from public.follows where follower_id = p_user),
    'posts', (
      select count(*) from public.posts
       where creator_id = p_user and visibility = 'public' and moderation_status <> 'removed'
    )
  );
$$;
grant execute on function public.channel_stats(uuid) to authenticated, anon;
