-- 👤 Publikus profil-mezők BÁRKINEK (a csatorna-fejléchez), a privát mezők
-- (phone/birthday/country/city) KISZIVÁRGÁSA nélkül.
--
-- A profiles SELECT policy szándékosan csak a SAJÁT sort engedi (GDPR: a
-- telefonszám/születésnap privát). A csatorna viszont MÁS user nevét/avatarját/
-- borítóját is mutatja — ezt egy SECURITY DEFINER függvény adja, ami KIZÁRÓLAG a
-- három publikus mezőt tér vissza, a soft-törölt fiókokat kihagyva.

create or replace function public.public_profile(p_user uuid)
returns table (full_name text, avatar_url text, cover_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name, p.avatar_url, p.cover_url
  from public.profiles p
  where p.id = p_user and p.deleted_at is null;
$$;

grant execute on function public.public_profile(uuid) to anon, authenticated;
