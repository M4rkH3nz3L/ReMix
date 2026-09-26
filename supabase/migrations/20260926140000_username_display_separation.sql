-- 🔐 username = EGYEDI login-handle, KÜLÖN a display name-től (full_name).
--
-- Hiba: a `username` (login_identifiers) sok soron NULL volt, a feed/csatorna az
-- EMAIL-előtagot használta „username"-nek (nem egyedi, nem a login-handle), és a
-- public_profile nem adta vissza a username-et → a felhasználó a display name-mel
-- próbált belépni (nem megy), a username pedig rejtett/nem egyedi volt.
--
-- Javítás:
--   • gen_unique_username(): egyedi handle-generátor (slug + numerikus utótag),
--   • backfill: minden hiányzó username-et egyedivé teszünk (email-előtag/full_name),
--   • handle_new_user: username-fallback HA a metadata nem küld egyet — ÉS a
--     GDPR-consent naplózás, amit a login_identifiers migráció korábban elejtett,
--   • username NOT NULL (a backfill + trigger garantálja),
--   • public_profile: visszaadja a username-et is (a csatorna @handle-jéhez),
--   • username_available(): foglaltság-ellenőrzés regisztráció előtt (anon).

-- ── egyedi username generátor ────────────────────────────────────────────────
create or replace function public.gen_unique_username(p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_try  text;
  v_i    int := 0;
begin
  -- slug: csak [a-z0-9_], kisbetű; üres → 'user'; max 20 karakter
  v_base := lower(regexp_replace(coalesce(p_base, ''), '[^a-zA-Z0-9_]', '', 'g'));
  if v_base = '' then
    v_base := 'user';
  end if;
  v_base := left(v_base, 20);
  v_try := v_base;
  loop
    exit when not exists (
      select 1 from public.profiles where lower(username) = lower(v_try)
    );
    v_i := v_i + 1;
    v_try := v_base || v_i::text;
  end loop;
  return v_try;
end;
$$;

-- ── backfill: minden hiányzó (NULL/üres) username-hez egyedi handle ───────────
do $$
declare
  r record;
begin
  for r in
    select p.id,
           coalesce(nullif(split_part(u.email, '@', 1), ''), p.full_name, 'user') as base
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.username is null or btrim(p.username) = ''
  loop
    update public.profiles
       set username = public.gen_unique_username(r.base)
     where id = r.id;
  end loop;
end $$;

-- ── trigger: username-fallback + GDPR-consent (egyesítve) ─────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := nullif(new.raw_user_meta_data ->> 'username', '');
begin
  -- a kliens mindig küld username-et; ha valamiért mégsem, generálunk egyet
  if v_username is null then
    v_username := public.gen_unique_username(split_part(coalesce(new.email, ''), '@', 1));
  end if;

  insert into public.profiles (id, full_name, phone, birthday, country, city, username)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date,
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    v_username
  )
  on conflict (id) do nothing;

  -- 📜 GDPR: a regisztrációkor adott hozzájárulás rögzítése (ha a kliens küldte)
  if nullif(new.raw_user_meta_data ->> 'consent_version', '') is not null then
    insert into public.user_consents (user_id, kind, version)
    values (new.id, 'terms_privacy', new.raw_user_meta_data ->> 'consent_version');
  end if;

  return new;
end;
$$;

-- ── username most már KÖTELEZŐ (a backfill + trigger garantálja) ─────────────
alter table public.profiles alter column username set not null;

-- ── public_profile: adja vissza a username-et is (a csatorna @handle-jéhez) ──
-- (a RETURNS TABLE bővítése miatt előbb DROP kell)
drop function if exists public.public_profile(uuid);
create or replace function public.public_profile(p_user uuid)
returns table (full_name text, username text, avatar_url text, cover_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name, p.username, p.avatar_url, p.cover_url
  from public.profiles p
  where p.id = p_user and p.deleted_at is null;
$$;
grant execute on function public.public_profile(uuid) to anon, authenticated;

-- ── username-foglaltság ellenőrzése regisztráció előtt (session nélkül is) ───
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select btrim(coalesce(p_username, '')) <> ''
     and not exists (
       select 1 from public.profiles
        where lower(username) = lower(btrim(coalesce(p_username, '')))
     );
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
