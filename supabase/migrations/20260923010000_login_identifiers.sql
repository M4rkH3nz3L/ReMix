-- 🔐 Belépés e-mail / felhasználónév / telefon bármelyikével.
--
-- A Supabase Auth natívan e-mail+jelszóval léptet. A username/telefon login úgy
-- működik, hogy előbb feloldjuk az AZONOSÍTÓT a hozzá tartozó e-mailre (RPC),
-- majd azzal hívjuk a signInWithPassword-öt. A profiles.username az új mező (a
-- telefon már megvolt). A feloldó SECURITY DEFINER (a profiles owner-only RLS-t
-- megkerüli), és anon szerepnek is jár (belépés ELŐTT fut, még nincs session).

-- ── username oszlop + egyediség (kis/nagybetű-független, NULL megengedett) ───
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_uidx
  on public.profiles (lower(username))
  where username is not null;

-- ── a signUp-trigger írja a username-et is (metadata-ból) ────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, birthday, country, city, username)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date,
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    nullif(new.raw_user_meta_data ->> 'username', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── azonosító → e-mail feloldás (e-mail / username / telefon) ────────────────
create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_id    text := lower(trim(coalesce(p_identifier, '')));
  -- csak számjegyek/+ (telefon-egyeztetéshez, formázástól függetlenül)
  v_norm  text := regexp_replace(coalesce(p_identifier, ''), '[^0-9+]', '', 'g');
  v_email text;
begin
  if v_id = '' then
    return null;
  end if;
  -- e-mail: közvetlenül (kis/nagybetű-függetlenül)
  if position('@' in v_id) > 0 then
    select u.email into v_email
      from auth.users u
     where lower(u.email) = v_id
     limit 1;
    return v_email;
  end if;
  -- username (kis/nagybetű-függetlenül) VAGY telefon → a hozzá tartozó e-mail
  select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(p.username) = v_id
      or (length(v_norm) >= 5
          and regexp_replace(coalesce(p.phone, ''), '[^0-9+]', '', 'g') = v_norm)
   limit 1;
  return v_email;
end;
$$;
-- belépés ELŐTT fut (anon), és session-nel is (authenticated)
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
