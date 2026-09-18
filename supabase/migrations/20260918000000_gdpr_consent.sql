-- 📜 GDPR — hozzájárulás auditálható rögzítése.
--
-- A regisztrációkor adott hozzájárulás (Felhasználási feltételek + Adatkezelési
-- tájékoztató) IDŐBÉLYEGGEL és VERZIÓVAL rögzül → GDPR 7. cikk (a hozzájárulás
-- igazolhatósága). Append-only napló: ha a tájékoztató verziója változik,
-- új sor rögzíthető (újra-hozzájárulás), a régi megmarad.

create table if not exists public.user_consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,             -- 'terms_privacy' (később: 'marketing' stb.)
  version     text not null,             -- a tájékoztató verziója (a kliens CONSENT_VERSION-je)
  accepted_at timestamptz not null default now()
);
create index if not exists user_consents_user_idx on public.user_consents (user_id, accepted_at desc);

alter table public.user_consents enable row level security;

-- a user CSAK a saját hozzájárulásait látja/rögzíti
drop policy if exists "user_consents_select_own" on public.user_consents;
create policy "user_consents_select_own" on public.user_consents
  for select using (auth.uid() = user_id);

drop policy if exists "user_consents_insert_own" on public.user_consents;
create policy "user_consents_insert_own" on public.user_consents
  for insert with check (auth.uid() = user_id);

-- ── handle_new_user KITERJESZTÉSE: a signup-metadatából a hozzájárulást is rögzíti
-- (a profil-sor mellé). SECURITY DEFINER → e-mail-megerősítés mellett is, session
-- előtt lefut; a consent-verziót a kliens a metadatában küldi.
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

  -- 📜 GDPR: a regisztrációkor adott hozzájárulás rögzítése (ha a kliens küldte)
  if nullif(new.raw_user_meta_data ->> 'consent_version', '') is not null then
    insert into public.user_consents (user_id, kind, version)
    values (new.id, 'terms_privacy', new.raw_user_meta_data ->> 'consent_version');
  end if;

  return new;
end;
$$;
