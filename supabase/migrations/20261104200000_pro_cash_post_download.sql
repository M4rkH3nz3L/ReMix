-- ⬇️ PRO-CASH C2.6 – C2.7 (4.5, D1, D11) — feed-videó letöltése a szerveren át.
--
-- A letöltés KIZÁRÓLAG a `GET /posts/:id/download` végponton megy: a szint a verifikált tokenből,
-- Free-nek és mások posztjánál mindenkinek a szerveren égetett vízjeles változat jár; tisztát csak
-- a fizetős tulajdonos kap a saját posztjáról. Az alkotó a letöltést letilthatja (a saját maga
-- számára nem). A vízjeles példányt az első kéréskor készíti a worker, és itt jegyzi meg.

alter table public.posts add column if not exists allow_download boolean not null default true;
alter table public.posts add column if not exists download_wm_key text;

-- a gyorsítótár-kulcsot csak a szerver írhatja; új videónál a régi vízjeles példány érvénytelen
create or replace function public.posts_download_cache_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() and new.download_wm_key is distinct from old.download_wm_key then
    new.download_wm_key := old.download_wm_key;
  end if;
  if new.video_url is distinct from old.video_url then
    new.download_wm_key := null;
  end if;
  return new;
end; $$;
drop trigger if exists posts_download_cache_guard on public.posts;
create trigger posts_download_cache_guard before update on public.posts
  for each row execute function public.posts_download_cache_guard();

create or replace function public.posts_download_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_client_request() then
    new.download_wm_key := null;
  end if;
  return new;
end; $$;
drop trigger if exists posts_download_insert_guard on public.posts;
create trigger posts_download_insert_guard before insert on public.posts
  for each row execute function public.posts_download_insert_guard();

-- láthatja-e a user a posztot (a feed RLS-ének szerveroldali tükre a letöltéshez)
create or replace function public.can_view_post(p_post uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.posts p
     where p.id = p_post and p.moderation_status <> 'removed'
       and (p.creator_id = p_user
            or p.visibility = 'public'
            or (p.visibility = 'followers' and exists (select 1 from public.follows f where f.follower_id = p_user and f.following_id = p.creator_id)))
       and not public.blocked_between(p.creator_id, p_user)
  );
$$;
revoke all on function public.can_view_post(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_view_post(uuid, uuid) to service_role;
