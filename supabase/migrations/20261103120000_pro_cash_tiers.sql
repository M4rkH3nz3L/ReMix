-- 💠 PRO-CASH C0.1 + C0.2 — mind az 5 előfizetési szint a DB-ben, egy forrás a tárhely-kerethez.
--
-- Eddig a `subscriptions.tier` csak 'free'/'pro' lehetett, miközben a kliens és a worker
-- már 5 szinttel (free/basic/pro/ultra/business = Free/Amatőr/Haladó/Profi/Vállalati)
-- számolt; az Amatőr/Profi/Vállalati így be sem kerülhetett az adatbázisba. A tárhely-
-- alap ráadásul két helyen élt, eltérő számokkal (DB: Pro 5 GiB / más 1 GiB, kliens:
-- 0/10/50/200/korlátlan). Mostantól:
--   • `active_tier_for(user)` — a HITELES aktív szint (lejárt/inaktív → free), ezt
--     használja minden DB-függvény; a worker JS-tükre a server/tiers.js `activeTierFromRow`.
--   • `tier_storage_gb(tier)` — a szintenkénti felhő-tárhely (GB / fő) EGYETLEN DB-forrása;
--     a kliens/szerver `ENTITLEMENTS.storageQuotaGB`-vel a src/lib/contract.test.ts zárolja.
--   • Free: 0 GB saját felhő (a média a telefonon marad, ADR-013), DE a feed-posztoláshoz
--     1 GiB poszt-keret jár (PRO-CASH D1: a Free is posztolhat) — `free_post_allowance_bytes()`.

-- ── C0.1: szintek, ülésszám, szervezet, forrás ───────────────────────────────
alter table public.subscriptions drop constraint if exists subscriptions_tier_check;
alter table public.subscriptions add constraint subscriptions_tier_check
  check (tier in ('free', 'basic', 'pro', 'ultra', 'business'));

alter table public.subscriptions add column if not exists seats integer not null default 1;
alter table public.subscriptions drop constraint if exists subscriptions_seats_check;
alter table public.subscriptions add constraint subscriptions_seats_check
  check (seats >= 1 and seats <= 10000 and (tier <> 'business' or seats >= 2));

-- a szervezet (4. fázis, `organizations`) — addig FK nélkül, a 4. fázis köti be
alter table public.subscriptions add column if not exists org_id uuid;

-- forrás: iap (áruház/RevenueCat) · coins (Coinból) · web (Stripe) · invoice (céges átutalás)
-- · trial (7 napos próba) · promo · manual; a régi 'revenuecat'/'stripe'/'credits' átkerül.
alter table public.subscriptions drop constraint if exists subscriptions_source_check;
update public.subscriptions set source = 'iap' where source = 'revenuecat';
update public.subscriptions set source = 'web' where source = 'stripe';
update public.subscriptions set source = 'coins' where source = 'credits';
alter table public.subscriptions add constraint subscriptions_source_check
  check (source in ('manual', 'iap', 'coins', 'web', 'invoice', 'trial', 'promo'));

-- ── a HITELES aktív szint ─────────────────────────────────────────────────────
-- Aktív, ha a státusz active/trialing ÉS a periódus még nem járt le. FAIL-CLOSED: lejárat
-- nélküli (null) sor nem ad fizetős szintet — örökös hozzáférés távoli dátummal adható.
-- Minden más → 'free'. A server/tiers.js activeTierFromRow a tükre.
create or replace function public.active_tier_for(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.tier from public.subscriptions s
     where s.user_id = p_user
       and s.status in ('active', 'trialing')
       and s.current_period_end > now()
  ), 'free');
$$;
revoke all on function public.active_tier_for(uuid) from public, anon, authenticated;
grant execute on function public.active_tier_for(uuid) to service_role;

-- ── C0.2: a szintenkénti felhő-tárhely (GB / fő) — EGY forrás ────────────────
-- @contract storageQuotaGB: a sorok a src/lib/entitlements.ts ENTITLEMENTS-ével azonosak
-- (a contract.test.ts ebből a függvényből olvassa ki a számokat).
create or replace function public.tier_storage_gb(p_tier text)
returns integer language sql immutable set search_path = '' as $$
  select case p_tier
    when 'free' then 0
    when 'basic' then 3
    when 'pro' then 25
    when 'ultra' then 100
    when 'business' then 100
    else 0
  end;
$$;

-- D1: a Free feed-poszt-kerete (a poszt videóját nekünk kell tárolni és kiszolgálni)
create or replace function public.free_post_allowance_bytes()
returns bigint language sql immutable set search_path = '' as $$
  select public.gib(1);
$$;

-- ── kvóta-számítás: a szint a HITELES aktív szintből, a keret a tier_storage_gb-ből ──
create or replace function public.storage_usage_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_used  bigint;
  v_tier  text;
  v_seats integer;
  v_base  bigint;
  v_bonus bigint := 0;
  v_exp   timestamptz;
begin
  select coalesce(sum(bytes), 0) into v_used
    from public.storage_objects where user_id = p_user;

  v_tier := public.active_tier_for(p_user);
  select seats into v_seats from public.subscriptions where user_id = p_user;
  v_seats := case when v_tier = 'business' then greatest(coalesce(v_seats, 2), 2) else 1 end;

  v_base := case
    when v_tier = 'free' then public.free_post_allowance_bytes()
    else public.gib(public.tier_storage_gb(v_tier)) * v_seats
  end;

  select bonus_bytes, bonus_expires_at into v_bonus, v_exp
    from public.storage_quotas where user_id = p_user;
  if v_exp is null or v_exp <= now() then
    v_bonus := 0;
    v_exp := null;
  end if;
  v_bonus := coalesce(v_bonus, 0);

  return jsonb_build_object(
    'tier', v_tier,
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

-- ── a Coinból fizetett Pro forrása mostantól 'coins' (a régi 'credits' megszűnt) ──
-- A teljes, mind az 5 szintet kezelő `subscribe_with_coins` a C1.1-ben jön; addig a
-- régi függvény ugyanazt csinálja, csak az új forrás-értékkel.
create or replace function public.subscribe_pro_with_credits(p_months integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_cost    integer;
  v_balance integer;
  v_cur_end timestamptz;
  v_cur_tier text;
  v_base    timestamptz;
  v_end     timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_months is null or p_months < 1 or p_months > 12 then raise exception 'invalid months'; end if;
  v_cost := 500 * p_months;

  select balance into v_balance from public.user_credits where user_id = v_user for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_cost then raise exception 'insufficient_credits'; end if;

  update public.user_credits set balance = balance - v_cost, updated_at = now() where user_id = v_user;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_user, -v_cost, 'purchase', 'pro_credits:' || p_months || 'mo');

  select current_period_end, tier into v_cur_end, v_cur_tier
    from public.subscriptions where user_id = v_user;
  v_base := case
    when v_cur_tier = 'pro' and v_cur_end is not null and v_cur_end > now() then v_cur_end
    else now() end;
  v_end := v_base + (p_months || ' months')::interval;
  insert into public.subscriptions (user_id, tier, status, current_period_end, source)
    values (v_user, 'pro', 'active', v_end, 'coins')
  on conflict (user_id) do update
    set tier = 'pro', status = 'active', current_period_end = v_end, source = 'coins';

  select balance into v_balance from public.user_credits where user_id = v_user;
  return jsonb_build_object('balance', v_balance, 'pro_until', v_end);
end; $$;
