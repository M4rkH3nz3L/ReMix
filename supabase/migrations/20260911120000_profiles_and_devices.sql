-- 🔐 Profil + eszköz-nyilvántartás a regisztrációhoz.
--
-- profiles      — a felhasználó megadott adatai (teljes név, telefon, szülinap,
--                 ország, város). Az e-mail az auth.users-ben marad.
-- user_devices  — minden bejelentkezett eszköz adatai (felbontás, modell, OS…),
--                 (user_id, fingerprint) kulcson upsertelve → egy sor / eszköz.
--
-- A profil-sort NEM a kliens szúrja be, hanem az auth.users-re kötött trigger a
-- signUp metadatából (raw_user_meta_data) — így e-mail-megerősítés mellett is
-- létrejön, még mielőtt lenne kliens-oldali session.

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  phone      text,
  birthday   date,
  country    text,
  city       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- updated_at karbantartása
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── profil-sor létrehozása a signUp metadatából ──────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, birthday, country, city)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date,
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'city', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── user_devices ─────────────────────────────────────────────────────────────
create table if not exists public.user_devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- eszköz-azonosító: telepítésenként egyszer generált, AsyncStorage-ban perzisztált
  fingerprint       text not null,
  platform          text,          -- ios | android | web
  brand             text,
  manufacturer      text,
  model_name        text,
  model_id          text,
  design_name       text,
  product_name      text,
  device_name       text,
  device_type       text,          -- phone | tablet | desktop | tv | unknown
  device_year_class integer,
  os_name           text,
  os_version        text,
  api_level         integer,       -- Android API szint
  total_memory      bigint,        -- byte
  cpu_archs         text[],
  is_physical       boolean,       -- valódi eszköz vagy szimulátor
  screen_width_dp   integer,
  screen_height_dp  integer,
  screen_width_px   integer,       -- fizikai pixel (dp × pixelRatio)
  screen_height_px  integer,
  pixel_ratio       numeric,
  font_scale        numeric,
  window_width_dp   integer,
  window_height_dp  integer,
  locale            text,
  region            text,
  timezone          text,
  currency          text,
  app_version       text,
  raw               jsonb,         -- minden nyers mező, ha később kell
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  unique (user_id, fingerprint)
);

create index if not exists user_devices_user_id_idx on public.user_devices (user_id);

alter table public.user_devices enable row level security;

drop policy if exists "devices_select_own" on public.user_devices;
create policy "devices_select_own" on public.user_devices
  for select using (auth.uid() = user_id);

drop policy if exists "devices_insert_own" on public.user_devices;
create policy "devices_insert_own" on public.user_devices
  for insert with check (auth.uid() = user_id);

drop policy if exists "devices_update_own" on public.user_devices;
create policy "devices_update_own" on public.user_devices
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "devices_delete_own" on public.user_devices;
create policy "devices_delete_own" on public.user_devices
  for delete using (auth.uid() = user_id);
