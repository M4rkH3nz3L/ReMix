-- 🎯 Aktív tárhely-cél: a user a bekötött külső forrásai közül kiválaszthatja,
-- HOVÁ mentsen minden studio (és honnan olvasson vissza). Ha egyik sincs
-- kijelölve (nincs is_default sor), a ReMix-tárhely (renders bucket) az alap.
--
-- Legfeljebb EGY alapértelmezett forrás lehet userenként (parciális unique index).
alter table public.user_storage_providers
  add column if not exists is_default boolean not null default false;

create unique index if not exists user_storage_providers_one_default
  on public.user_storage_providers (user_id)
  where is_default;
