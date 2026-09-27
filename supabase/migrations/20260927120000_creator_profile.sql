-- 🎨 Creator Profile — a profil „bemutatkozás" / creator-page rétege.
--
-- A klasszikus adatlap (username/name/phone/…) fölé húzunk egy KREATÍV réteget,
-- hogy a user ne csak adatokat töltsön ki, hanem PROFILT komponáljon:
--   • bemutatkozás (bio + Rólam / Mit készítek? / Jelenleg ezen dolgozom),
--   • creator-típusok (🎬 videós, 🎵 zenész, …) + készség/érdeklődés tagek,
--   • social platform-identitások (nem sima URL, hanem platform + @username),
--   • showcase modulok (kiemelt videók/projektek/képek, kedvenc zene/film/játék).
--
-- Minden ÚJ oszlop/tábla additív és nullázható → régi sorokra is biztonságos.
-- A privát mezők (phone/birthday) NEM kerülnek a public_profile-ba (GDPR); a
-- mezőnkénti láthatóságot a `field_privacy` jsonb tárolja (enforcement: Phase 7).

-- ── 1) profiles: kreatív + identity mezők ────────────────────────────────────
alter table public.profiles add column if not exists bio           text;   -- rövid bemutatkozás (≈160–500)
alter table public.profiles add column if not exists about_me      text;   -- „Rólam"
alter table public.profiles add column if not exists what_i_make   text;   -- „Mit készítek?"
alter table public.profiles add column if not exists working_on    text;   -- „Jelenleg ezen dolgozom…"
alter table public.profiles add column if not exists creator_types text[] not null default '{}';
alter table public.profiles add column if not exists skills        text[] not null default '{}';
alter table public.profiles add column if not exists interests     text[] not null default '{}';
alter table public.profiles add column if not exists languages     text[] not null default '{}';
alter table public.profiles add column if not exists timezone      text;
-- mezőnkénti láthatóság: { "city": "followers", "birthday": "private", … }
-- értékek: 'public' | 'followers' | 'private' (a 'friends' réteg jövőbeli)
alter table public.profiles add column if not exists field_privacy jsonb not null default '{}'::jsonb;

-- ── 2) social platform-identitások ───────────────────────────────────────────
-- Nem sima link: platform + username, amiből az URL generálható (a UI dönti el).
create table if not exists public.profile_social_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  platform     text not null,                 -- 'instagram' | 'tiktok' | … | 'custom'
  username     text,                          -- @handle (platformnál); customnál null
  url          text,                          -- teljes URL (customnál kötelező, másnál generálható)
  display_name text,                          -- egyedi cím (customnál „My website")
  is_public    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists profile_social_links_user_idx
  on public.profile_social_links (user_id, sort_order);

alter table public.profile_social_links enable row level security;

drop policy if exists "social_links_select" on public.profile_social_links;
create policy "social_links_select" on public.profile_social_links
  for select using (
    auth.uid() = user_id
    or (
      is_public = true
      and exists (select 1 from public.profiles p where p.id = user_id and p.deleted_at is null)
    )
  );

drop policy if exists "social_links_write_own" on public.profile_social_links;
create policy "social_links_write_own" on public.profile_social_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 3) showcase modulok (kiemelt tartalom / kedvencek) ───────────────────────
create table if not exists public.profile_showcase_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,                  -- 'video'|'project'|'image'|'music'|'movie'|'game'|'link'
  ref_id      text,                           -- ReMix-tartalom hivatkozás (post_id/project_id)
  title       text,
  subtitle    text,                           -- előadó/album, rendező, platform…
  thumb_url   text,
  url         text,                           -- külső link / média-URL
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists profile_showcase_user_idx
  on public.profile_showcase_items (user_id, kind, sort_order);

alter table public.profile_showcase_items enable row level security;

drop policy if exists "showcase_select" on public.profile_showcase_items;
create policy "showcase_select" on public.profile_showcase_items
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = user_id and p.deleted_at is null)
  );

drop policy if exists "showcase_write_own" on public.profile_showcase_items;
create policy "showcase_write_own" on public.profile_showcase_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 4) public_profile: a PUBLIKUS kreatív identitás bárkinek ─────────────────
-- Bővítjük a nyilvános mezőket a creator-page-hez. A privát adatok (phone/
-- birthday/city/country) SZÁNDÉKOSAN kimaradnak — a mezőnkénti privacy
-- kikényszerítése (followers/private) a Phase 7-ben jön.
drop function if exists public.public_profile(uuid);
create or replace function public.public_profile(p_user uuid)
returns table (
  full_name     text,
  username      text,
  avatar_url    text,
  cover_url     text,
  bio           text,
  about_me      text,
  what_i_make   text,
  working_on    text,
  creator_types text[],
  skills        text[],
  interests     text[],
  languages     text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name, p.username, p.avatar_url, p.cover_url,
         p.bio, p.about_me, p.what_i_make, p.working_on,
         p.creator_types, p.skills, p.interests, p.languages
  from public.profiles p
  where p.id = p_user and p.deleted_at is null;
$$;
grant execute on function public.public_profile(uuid) to anon, authenticated;
