-- 🗄️ Tárhely-elszámolás + kvóta + külső tárhely-szolgáltatók
--
-- HÁROM dolgot vezetünk be:
--   1. `storage_objects` — a MI tárhelyünkön (Supabase `renders` bucket / szerver-
--      média) fekvő fájlok BÁJT-naplója. Ebből jön a per-projekt és a per-user
--      pontos használat. A user SAJÁT Drive/Dropbox/WebDAV/S3 forrásán fekvő média
--      NEM kerül ide → nem terheli a kvótát (az „ingyen bővítés" lényege).
--   2. `storage_quotas` — a koinnal vett HAVI bónusz-tárhely (az alap-kvótán felül).
--      Az alap fix: ingyenes 1 GiB / Pro 5 GiB — a `subscriptions.tier`-ből számolva.
--   3. `user_storage_providers` — a user SAJÁT bekötött külső forrásai
--      (Google Drive / Dropbox / WebDAV / S3). A tokenek/kulcsok SOHA nem mennek a
--      kliensre: a tábla RLS-e alatt a kliensnek NINCS olvasási policy-ja — csak a
--      worker (service_role) olvassa, és proxyzva listáz. Ezért a kliens a saját
--      forrásait is a workeren (`/storage/sources`, requireAuth) keresztül látja.
--
-- SZERVER-HITELES: a használatot/kvótát SENKI nem írja szabadon kliensről; a
-- felvétel SECURITY DEFINER függvényeken át megy, a limit-túllépés KEMÉNY tiltás.

-- ── segéd: 1 GiB bájtban ──────────────────────────────────────────────────────
create or replace function public.gib(n numeric)
returns bigint language sql immutable as $$
  select (n * 1073741824)::bigint;
$$;

-- ── MI-tárhelyünkön fekvő fájlok bájt-naplója ─────────────────────────────────
create table if not exists public.storage_objects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  project_id text,                                  -- helyi projekt-id (lehet null: pl. avatar)
  bucket     text not null default 'renders',
  key        text not null,                         -- storage-kulcs (`<projectId>/<kind>/<uuid>` v. `media/<uuid>`)
  bytes      bigint not null default 0 check (bytes >= 0),
  -- honnan: kliens webes közvetlen feltöltés / szerver-oldali (`/media/upload`)
  source     text not null default 'server' check (source in ('server', 'client')),
  created_at timestamptz not null default now(),
  unique (bucket, key)
);
create index if not exists storage_objects_user_idx on public.storage_objects (user_id);
create index if not exists storage_objects_project_idx on public.storage_objects (user_id, project_id);
alter table public.storage_objects enable row level security;
-- a user OLVASHATJA a sajátját (per-projekt kijelzéshez); ÍRÁS csak SECURITY DEFINER / service_role
drop policy if exists "storage_objects_select_own" on public.storage_objects;
create policy "storage_objects_select_own" on public.storage_objects
  for select using (auth.uid() = user_id);

-- ── koinnal vett HAVI bónusz-tárhely ──────────────────────────────────────────
create table if not exists public.storage_quotas (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  bonus_bytes     bigint not null default 0 check (bonus_bytes >= 0),
  bonus_expires_at timestamptz,                     -- null = nincs aktív bónusz
  updated_at      timestamptz not null default now()
);
alter table public.storage_quotas enable row level security;
drop policy if exists "storage_quotas_select_own" on public.storage_quotas;
create policy "storage_quotas_select_own" on public.storage_quotas
  for select using (auth.uid() = user_id);
-- ÍRÁS-policy szándékosan NINCS: csak a `buy_storage_boost` SECURITY DEFINER írhat.

-- ── user SAJÁT külső tárhely-forrásai (a titkok a szerveren maradnak) ──────────
create table if not exists public.user_storage_providers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- gdrive | dropbox | webdav | s3
  type       text not null check (type in ('gdrive', 'dropbox', 'webdav', 's3')),
  label      text not null,
  -- hitelesítés + beállítás (oauth token/refresh, webdav baseUrl/pw, s3 kulcsok) —
  -- SOHA nem megy a kliensre (nincs kliens SELECT policy)
  config     jsonb not null default '{}'::jsonb,
  status     text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_storage_providers_user_idx on public.user_storage_providers (user_id);
alter table public.user_storage_providers enable row level security;
-- RLS bekapcsolva, de a klienshez NINCS policy → csak a worker (service_role) fér hozzá.

-- ── projekt törlésekor a MI-tárhely-naplóból is takarítunk ────────────────────
create or replace function public.storage_objects_on_project_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.storage_objects
    where user_id = old.user_id and project_id = old.project_id;
  return old;
end;
$$;
drop trigger if exists cloud_projects_release_storage on public.cloud_projects;
create trigger cloud_projects_release_storage
  after delete on public.cloud_projects
  for each row execute function public.storage_objects_on_project_delete();

-- ── kvóta-számítás (service_role: szerver display + enforcement) ───────────────
-- Visszaad: used_bytes, base_bytes (tier szerint), bonus_bytes (ha nem járt le),
-- quota_bytes (base+bonus), bonus_expires_at.
create or replace function public.storage_usage_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_used  bigint;
  v_tier  text;
  v_base  bigint;
  v_bonus bigint := 0;
  v_exp   timestamptz;
begin
  select coalesce(sum(bytes), 0) into v_used
    from public.storage_objects where user_id = p_user;

  select tier into v_tier from public.subscriptions where user_id = p_user;
  -- alap: Pro 5 GiB, egyébként (free / nincs sor) 1 GiB
  v_base := case when v_tier = 'pro' then public.gib(5) else public.gib(1) end;

  select bonus_bytes, bonus_expires_at into v_bonus, v_exp
    from public.storage_quotas where user_id = p_user;
  -- lejárt (vagy nincs) bónusz → 0
  if v_exp is null or v_exp <= now() then
    v_bonus := 0;
    v_exp := null;
  end if;
  v_bonus := coalesce(v_bonus, 0);

  return jsonb_build_object(
    'used_bytes', v_used,
    'base_bytes', v_base,
    'bonus_bytes', v_bonus,
    'quota_bytes', v_base + v_bonus,
    'bonus_expires_at', v_exp
  );
end;
$$;
revoke all on function public.storage_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.storage_usage_for(uuid) to service_role;

-- a BEJELENTKEZETT user a saját használatát kéri (a param nélküli burok auth.uid()-ot használ)
create or replace function public.storage_usage()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return public.storage_usage_for(auth.uid());
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- ── fájl-felvétel a naplóba KVÓTA-ELLENŐRZÉSSEL (kemény tiltás) ────────────────
-- Belső mag: adott user + kulcs + bájt → ha a limit túllépné, `quota_exceeded`.
-- Idempotens: ugyanaz a (bucket,key) frissül (a régi bájtot kivonjuk a limitből).
create or replace function public.record_storage_object_for(
  p_user uuid, p_bucket text, p_key text, p_bytes bigint, p_project_id text, p_source text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_usage    jsonb;
  v_quota    bigint;
  v_existing bigint := 0;
  v_used     bigint;
begin
  if p_user is null then
    raise exception 'user required';
  end if;
  if p_bytes is null or p_bytes < 0 then
    raise exception 'invalid bytes';
  end if;

  v_usage := public.storage_usage_for(p_user);
  v_quota := (v_usage ->> 'quota_bytes')::bigint;
  v_used  := (v_usage ->> 'used_bytes')::bigint;

  -- ha már van ilyen kulcs, a régi bájtja NEM számít duplán
  select bytes into v_existing from public.storage_objects
    where bucket = p_bucket and key = p_key;
  v_existing := coalesce(v_existing, 0);

  if (v_used - v_existing + p_bytes) > v_quota then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into public.storage_objects (user_id, project_id, bucket, key, bytes, source)
    values (p_user, p_project_id, p_bucket, p_key, p_bytes, coalesce(p_source, 'server'))
  on conflict (bucket, key) do update
    set bytes = excluded.bytes, project_id = excluded.project_id, user_id = excluded.user_id;

  return public.storage_usage_for(p_user);
end;
$$;
revoke all on function public.record_storage_object_for(uuid, text, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.record_storage_object_for(uuid, text, text, bigint, text, text) to service_role;

-- a BEJELENTKEZETT user (webes közvetlen Supabase-feltöltés után) a saját fájlját
-- rögzíti — a bájtot a storage.objects metaadatából olvassuk (nem a kliens szava),
-- így nem hamisítható; kvóta-túllépéskor `quota_exceeded`.
create or replace function public.record_storage_object(
  p_bucket text, p_key text, p_project_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_bytes bigint;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  -- a valódi méret a storage-objektumból (a kliens előbb feltölt, aztán hív)
  select coalesce((metadata ->> 'size')::bigint, 0) into v_bytes
    from storage.objects where bucket_id = p_bucket and name = p_key;
  if v_bytes is null then
    raise exception 'object_not_found';
  end if;
  return public.record_storage_object_for(v_user, p_bucket, p_key, v_bytes, p_project_id, 'client');
end;
$$;
revoke all on function public.record_storage_object(text, text, text) from public, anon;
grant execute on function public.record_storage_object(text, text, text) to authenticated;

-- ── koinos HAVI tárhely-bővítés (atomikus) ────────────────────────────────────
-- Ár: p_gb × p_months × 100 koin. Levon a user_credits-ből (kevés → `insufficient_
-- credits`), naplóz, és a bónusz-poolt bővíti: a lejáratot p_months hónappal tolja
-- (lejárt/nincs bónusz → mosttól; élő → a meglévő lejárattól). Lejáratkor a teljes
-- bónusz nullázódik (lusta: a `storage_usage_for` lejárt bónuszt 0-nak vesz).
create or replace function public.buy_storage_boost(p_gb integer, p_months integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_cost    integer;
  v_balance integer;
  v_add     bigint;
  v_cur_exp timestamptz;
  v_cur_bon bigint;
  v_new_exp timestamptz;
  v_new_bon bigint;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_gb is null or p_gb < 1 or p_gb > 100 then
    raise exception 'invalid gb';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'invalid months';
  end if;

  v_cost := p_gb * p_months * 100;

  select balance into v_balance from public.user_credits where user_id = v_user for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_cost then
    raise exception 'insufficient_credits';
  end if;

  update public.user_credits set balance = balance - v_cost, updated_at = now()
    where user_id = v_user;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_user, -v_cost, 'purchase', 'storage_boost:' || p_gb || 'GBx' || p_months || 'mo');

  v_add := public.gib(p_gb);
  select bonus_bytes, bonus_expires_at into v_cur_bon, v_cur_exp
    from public.storage_quotas where user_id = v_user;
  if v_cur_exp is null or v_cur_exp <= now() then
    -- lejárt / új: friss pool mosttól
    v_new_bon := v_add;
    v_new_exp := now() + (p_months || ' months')::interval;
  else
    -- élő bónusz: hozzáadunk + a meglévő lejárattól tolunk
    v_new_bon := coalesce(v_cur_bon, 0) + v_add;
    v_new_exp := v_cur_exp + (p_months || ' months')::interval;
  end if;

  insert into public.storage_quotas (user_id, bonus_bytes, bonus_expires_at, updated_at)
    values (v_user, v_new_bon, v_new_exp, now())
  on conflict (user_id) do update
    set bonus_bytes = v_new_bon, bonus_expires_at = v_new_exp, updated_at = now();

  select balance into v_balance from public.user_credits where user_id = v_user;
  return jsonb_build_object(
    'balance', v_balance,
    'cost', v_cost,
    'usage', public.storage_usage_for(v_user)
  );
end;
$$;
revoke all on function public.buy_storage_boost(integer, integer) from public, anon;
grant execute on function public.buy_storage_boost(integer, integer) to authenticated;

-- updated_at karbantartás (a set_updated_at() a profiles-migrációból már létezik)
drop trigger if exists user_storage_providers_set_updated_at on public.user_storage_providers;
create trigger user_storage_providers_set_updated_at
  before update on public.user_storage_providers
  for each row execute function public.set_updated_at();
