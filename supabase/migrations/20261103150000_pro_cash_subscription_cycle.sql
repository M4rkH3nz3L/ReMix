-- 🔁 PRO-CASH C1.1 – C1.3 — előfizetési ciklus Coinból: szintváltás, add-on, megújítás.
--
-- C1.1  `subscribe_with_coins(tier, months, seats)` minden váltást kezel:
--         • indulás (Free-ről) / meghosszabbítás ugyanazon a szinten és periódusban;
--         • FELFELÉ váltás azonnal: a régi szintért Coinban fizetett rész fel nem használt
--           hányada jóváíródik, az új szint teljes periódusa mostantól indul;
--         • LEFELÉ váltás a következő ciklustól (`pending_tier`), díj nélkül.
--       Áruházi (iap) előfizetést nem írunk át Coinnal (`managed_by_store`).
-- C1.2  `subscription_addons`: havi ismétlődő bővítés, felvételkor időarányos díj, levétel a
--       következő ciklustól. A tárhely-add-on a `storage_usage_for`-ba, az AI-/render-add-on a
--       worker kvótájába (`subscription_quota_for`) számít.
-- C1.3  `renew_due_subscriptions(now)`: a lejárt Coin-előfizetések megújítása (a következő
--       szint + a megmaradó add-onok), kevés egyenlegnél `past_due` (→ Free). A
--       `take_renewal_notices(now)` a 3 napon belül lejáró, kevés egyenlegű fiókokat adja
--       vissza értesítésre (egyszer periódusonként). Mindkettő idő-injektálható (teszt).
-- A tiszta tükör: src/lib/subscriptionPlan.ts (a contract.test.ts zárolja az árakat).

-- ═══ előfizetés: periódus, megújítás, függő váltás ═════════════════════════════
alter table public.subscriptions add column if not exists billing_period text not null default 'month';
alter table public.subscriptions drop constraint if exists subscriptions_billing_period_check;
alter table public.subscriptions add constraint subscriptions_billing_period_check check (billing_period in ('month', 'year'));
alter table public.subscriptions add column if not exists period_start timestamptz;
alter table public.subscriptions add column if not exists auto_renew boolean not null default true;
alter table public.subscriptions add column if not exists pending_tier text;
alter table public.subscriptions drop constraint if exists subscriptions_pending_tier_check;
alter table public.subscriptions add constraint subscriptions_pending_tier_check
  check (pending_tier is null or pending_tier in ('basic', 'pro', 'ultra', 'business'));
-- a jelenlegi periódusban a SZINTÉRT Coinban fizetett összeg (a jóváírás alapja; más forrásnál 0)
alter table public.subscriptions add column if not exists tier_charge_cents bigint not null default 0;
-- melyik periódus-végről küldtünk már megújítási értesítést
alter table public.subscriptions add column if not exists renewal_notified_for timestamptz;

-- ═══ add-onok ══════════════════════════════════════════════════════════════════
create table if not exists public.subscription_addons (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  addon               text not null check (addon in ('storage_10gb', 'storage_100gb', 'ai_1m', 'render_60',
                                                     'publish_account', 'multistream_target', 'collab_5')),
  qty                 integer not null check (qty between 1 and 100),
  status              text not null default 'active' check (status in ('active', 'canceled')),
  cancel_at_period_end boolean not null default false,
  created_at          timestamptz not null default now(),
  canceled_at         timestamptz
);
create index if not exists subscription_addons_user_idx on public.subscription_addons (user_id, status);
alter table public.subscription_addons enable row level security;
drop policy if exists "subscription_addons_select_own" on public.subscription_addons;
create policy "subscription_addons_select_own" on public.subscription_addons for select using (auth.uid() = user_id);

-- @contract: add-on havi ár cent-Coinban és minimum-szint (src/lib/subscriptionPlan.ts ADDONS)
create or replace function public.addon_price_cents(p_addon text)
returns bigint language sql immutable set search_path = '' as $$
  select case p_addon
    when 'storage_10gb' then 100
    when 'storage_100gb' then 600
    when 'ai_1m' then 100
    when 'render_60' then 100
    when 'publish_account' then 40
    when 'multistream_target' then 40
    when 'collab_5' then 100
  end::bigint;
$$;
create or replace function public.addon_min_tier(p_addon text)
returns text language sql immutable set search_path = '' as $$
  select case when p_addon in ('storage_100gb', 'multistream_target') then 'pro' else 'basic' end;
$$;
create or replace function public.tier_rank(p_tier text)
returns integer language sql immutable set search_path = '' as $$
  select case p_tier when 'basic' then 1 when 'pro' then 2 when 'ultra' then 3 when 'business' then 4 else 0 end;
$$;

-- ═══ időarányos számolás (a TS prorationCreditCents / proratedChargeCents tükre) ═
create or replace function public.coin_remaining_fraction(p_start timestamptz, p_end timestamptz, p_now timestamptz)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_end is null or p_start is null or p_end <= p_start then 0
    else least(1, greatest(0, extract(epoch from (p_end - p_now)) / extract(epoch from (p_end - p_start)))) end;
$$;

create or replace function public.period_interval(p_period text)
returns interval language sql immutable set search_path = '' as $$
  select case p_period when 'year' then interval '12 months' else interval '1 month' end;
$$;

-- egy teljes periódus díja (szint × ülés; éves = 10 havi)
create or replace function public.period_price_cents(p_tier text, p_period text, p_seats integer)
returns bigint language sql immutable set search_path = '' as $$
  select public.tier_price_cents(p_tier)
       * (case when p_tier = 'business' then greatest(coalesce(p_seats, 2), 2) else 1 end)
       * (case when p_period = 'year' then 10 else 1 end);
$$;

-- az aktív add-onok díja egy periódusra (havi ár; éves periódusnál × 12)
create or replace function public.addons_period_cents(p_user uuid, p_period text, p_only_renewing boolean)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(public.addon_price_cents(addon) * qty), 0)::bigint * (case when p_period = 'year' then 12 else 1 end)
    from public.subscription_addons
   where user_id = p_user and status = 'active' and (not p_only_renewing or not cancel_at_period_end);
$$;

-- ═══ C1.1: előfizetés / váltás Coinból ════════════════════════════════════════
drop function if exists public.subscribe_with_coins(text, integer, integer);
create or replace function public.subscribe_with_coins(p_tier text, p_months integer, p_seats integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_now    timestamptz := now();
  v_period text;
  v_seats  integer;
  v_cur    public.subscriptions%rowtype;
  v_active text;
  v_full   bigint;
  v_credit bigint := 0;
  v_cost   bigint;
  v_kind   text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_debit  jsonb;
  v_balance bigint;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_tier not in ('basic', 'pro', 'ultra', 'business') then raise exception 'invalid tier'; end if;
  if p_months is null or p_months not in (1, 12) then raise exception 'invalid months'; end if;
  v_period := case when p_months = 12 then 'year' else 'month' end;
  v_seats := case when p_tier = 'business' then coalesce(p_seats, 2) else 1 end;
  if v_seats < 1 or (p_tier = 'business' and v_seats < 2) then raise exception 'invalid seats'; end if;

  insert into public.subscriptions (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_cur from public.subscriptions where user_id = v_user for update;
  v_active := public.active_tier_for(v_user);
  if v_active <> 'free' and v_cur.source = 'iap' then raise exception 'managed_by_store'; end if;

  v_full := public.period_price_cents(p_tier, v_period, v_seats);

  if v_active = 'free' then
    v_kind := 'start';
  elsif v_active = p_tier and v_cur.billing_period = v_period and v_cur.seats = v_seats then
    v_kind := 'extend';
  elsif public.tier_rank(p_tier) < public.tier_rank(v_active) then
    v_kind := 'downgrade';
  else
    v_kind := 'change';  -- felfelé, más periódus vagy ülésszám: jóváírás + új periódus mostantól
  end if;

  if v_kind = 'downgrade' then
    update public.subscriptions set pending_tier = p_tier where user_id = v_user;
    select balance into v_balance from public.user_credits where user_id = v_user;
    return jsonb_build_object('kind', 'downgrade', 'cost', 0, 'tier', v_active, 'pending_tier', p_tier,
                              'until', v_cur.current_period_end, 'balance', coalesce(v_balance, 0));
  end if;

  if v_kind = 'change' and v_cur.source = 'coins' then
    v_credit := floor(v_cur.tier_charge_cents * public.coin_remaining_fraction(v_cur.period_start, v_cur.current_period_end, v_now))::bigint;
  end if;
  v_cost := greatest(0, v_full - v_credit);

  if v_cost > 0 then
    v_debit := public.coin_debit(v_user, v_cost, 'subscription',
      p_tier || ':' || v_period || ':' || v_seats || 'seat:' || v_kind || case when v_credit > 0 then ':credit' || v_credit else '' end);
  end if;

  if v_kind = 'extend' then
    v_start := v_cur.current_period_end;
  else
    v_start := v_now;
  end if;
  v_end := v_start + public.period_interval(v_period);

  update public.subscriptions set
    tier = p_tier, seats = v_seats, status = 'active', source = 'coins', billing_period = v_period,
    period_start = case when v_kind = 'extend' then coalesce(v_cur.period_start, v_now) else v_start end,
    current_period_end = v_end,
    tier_charge_cents = case when v_kind = 'extend' then v_cur.tier_charge_cents + v_full else v_full end,
    auto_renew = true, pending_tier = null, renewal_notified_for = null
  where user_id = v_user;

  select balance into v_balance from public.user_credits where user_id = v_user;
  return jsonb_build_object('kind', v_kind, 'cost', v_cost, 'credit', v_credit, 'tier', p_tier,
                            'until', v_end, 'balance', coalesce(v_balance, 0));
end; $$;
revoke all on function public.subscribe_with_coins(text, integer, integer) from public, anon;
grant execute on function public.subscribe_with_coins(text, integer, integer) to authenticated;

-- lemondás / visszavonás: egy koppintás (PRO-CASH 3.4); a hozzáférés a periódus végéig marad
create or replace function public.set_auto_renew(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_end timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  update public.subscriptions set auto_renew = coalesce(p_on, false), pending_tier = case when p_on then pending_tier else null end
   where user_id = v_user returning current_period_end into v_end;
  return jsonb_build_object('auto_renew', coalesce(p_on, false), 'until', v_end);
end; $$;
revoke all on function public.set_auto_renew(boolean) from public, anon;
grant execute on function public.set_auto_renew(boolean) to authenticated;

-- ═══ C1.2: add-on felvétele és levétele ═══════════════════════════════════════
create or replace function public.add_addon(p_addon text, p_qty integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_cur    public.subscriptions%rowtype;
  v_active text;
  v_full   bigint;
  v_cost   bigint;
  v_id     uuid;
  v_debit  jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if public.addon_price_cents(p_addon) is null then raise exception 'invalid addon'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 100 then raise exception 'invalid qty'; end if;
  select * into v_cur from public.subscriptions where user_id = v_user for update;
  v_active := public.active_tier_for(v_user);
  if v_active = 'free' then raise exception 'paid_tier_required'; end if;
  if public.tier_rank(v_active) < public.tier_rank(public.addon_min_tier(p_addon)) then raise exception 'tier_too_low'; end if;
  if v_cur.source <> 'coins' then raise exception 'addon_requires_coin_billing'; end if;

  v_full := public.addon_price_cents(p_addon) * p_qty * (case when v_cur.billing_period = 'year' then 12 else 1 end);
  v_cost := ceil(v_full * public.coin_remaining_fraction(v_cur.period_start, v_cur.current_period_end, now()))::bigint;
  insert into public.subscription_addons (user_id, addon, qty) values (v_user, p_addon, p_qty) returning id into v_id;
  if v_cost > 0 then
    v_debit := public.coin_debit(v_user, v_cost, 'addon', p_addon || 'x' || p_qty || ':prorated', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'cost', v_cost, 'renewal_cost',
    public.period_price_cents(coalesce(v_cur.pending_tier, v_cur.tier), v_cur.billing_period, v_cur.seats)
    + public.addons_period_cents(v_user, v_cur.billing_period, true),
    'balance', coalesce((v_debit ->> 'balance')::bigint, (select balance from public.user_credits where user_id = v_user)));
end; $$;
revoke all on function public.add_addon(text, integer) from public, anon;
grant execute on function public.add_addon(text, integer) to authenticated;

create or replace function public.remove_addon(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.subscription_addons set cancel_at_period_end = true
   where id = p_id and user_id = auth.uid() and status = 'active';
  if not found then raise exception 'addon_not_found'; end if;
end; $$;
revoke all on function public.remove_addon(uuid) from public, anon;
grant execute on function public.remove_addon(uuid) to authenticated;

-- ═══ C1.3: megújítás és értesítés (a worker ütemezője hívja) ═══════════════════
create or replace function public.renew_due_subscriptions(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_tier text; v_full bigint; v_cost bigint;
  v_renewed int := 0; v_failed int := 0; v_ended int := 0;
begin
  for s in select * from public.subscriptions
            where source = 'coins' and status = 'active' and current_period_end <= p_now
            for update skip locked loop
    if not s.auto_renew then
      update public.subscriptions set status = 'expired', pending_tier = null where user_id = s.user_id;
      update public.subscription_addons set status = 'canceled', canceled_at = p_now where user_id = s.user_id and status = 'active';
      v_ended := v_ended + 1;
      continue;
    end if;
    v_tier := coalesce(s.pending_tier, s.tier);
    -- a lefelé váltott szinthez már nem illő add-on a ciklusváltással lekerül
    update public.subscription_addons set status = 'canceled', canceled_at = p_now
     where user_id = s.user_id and status = 'active'
       and (cancel_at_period_end or public.tier_rank(v_tier) < public.tier_rank(public.addon_min_tier(addon)));
    v_full := public.period_price_cents(v_tier, s.billing_period, s.seats);
    v_cost := v_full + public.addons_period_cents(s.user_id, s.billing_period, true);
    begin
      perform public.coin_debit(s.user_id, v_cost, 'subscription', v_tier || ':' || s.billing_period || ':renewal');
      update public.subscriptions set
        tier = v_tier, pending_tier = null, period_start = s.current_period_end,
        current_period_end = s.current_period_end + public.period_interval(s.billing_period),
        tier_charge_cents = v_full, renewal_notified_for = null
      where user_id = s.user_id;
      v_renewed := v_renewed + 1;
    exception when others then
      if sqlerrm not like '%insufficient_credits%' then raise; end if;
      update public.subscriptions set status = 'past_due', tier = v_tier, pending_tier = null where user_id = s.user_id;
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('renewed', v_renewed, 'failed', v_failed, 'ended', v_ended);
end; $$;
revoke all on function public.renew_due_subscriptions(timestamptz) from public, anon, authenticated;
grant execute on function public.renew_due_subscriptions(timestamptz) to service_role;

-- a 3 napon belül lejáró, megújuló Coin-előfizetések, ahol az egyenleg kevés — periódusonként egyszer
create or replace function public.take_renewal_notices(p_now timestamptz default now())
returns table (user_id uuid, period_end timestamptz, cost_cents bigint, balance_cents bigint)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select s.user_id, s.current_period_end,
           public.period_price_cents(coalesce(s.pending_tier, s.tier), s.billing_period, s.seats)
             + public.addons_period_cents(s.user_id, s.billing_period, true) as cost,
           coalesce((select u.balance from public.user_credits u where u.user_id = s.user_id), 0) as bal
      from public.subscriptions s
     where s.source = 'coins' and s.status = 'active' and s.auto_renew
       and s.current_period_end > p_now and s.current_period_end <= p_now + interval '3 days'
       and s.renewal_notified_for is distinct from s.current_period_end
  ), marked as (
    update public.subscriptions s set renewal_notified_for = d.current_period_end
      from due d where s.user_id = d.user_id and d.bal < d.cost
    returning s.user_id
  )
  select d.user_id, d.current_period_end, d.cost, d.bal from due d join marked m on m.user_id = d.user_id;
end; $$;
revoke all on function public.take_renewal_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.take_renewal_notices(timestamptz) to service_role;

-- ═══ a kliens előfizetés-nézete ════════════════════════════════════════════════
create or replace function public.my_subscription()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); s public.subscriptions%rowtype; v_active text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into s from public.subscriptions where user_id = v_user;
  v_active := public.active_tier_for(v_user);
  return jsonb_build_object(
    'tier', v_active, 'status', s.status, 'source', s.source, 'seats', coalesce(s.seats, 1),
    'billing_period', coalesce(s.billing_period, 'month'), 'period_start', s.period_start,
    'until', s.current_period_end, 'auto_renew', coalesce(s.auto_renew, false), 'pending_tier', s.pending_tier,
    'renewal_cost', case when v_active = 'free' then 0 else
      public.period_price_cents(coalesce(s.pending_tier, s.tier), s.billing_period, s.seats)
      + public.addons_period_cents(v_user, s.billing_period, true) end,
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'addon', a.addon, 'qty', a.qty,
                          'cancel_at_period_end', a.cancel_at_period_end) order by a.created_at)
                          from public.subscription_addons a where a.user_id = v_user and a.status = 'active'), '[]'::jsonb)
  );
end; $$;
revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- ═══ az add-onok beszámítása: tárhely + worker-kvóta ══════════════════════════
create or replace function public.addon_storage_gb(p_user uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(qty * case addon when 'storage_10gb' then 10 when 'storage_100gb' then 100 else 0 end), 0)::bigint
    from public.subscription_addons where user_id = p_user and status = 'active';
$$;

create or replace function public.storage_usage_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_used  bigint;
  v_tier  text;
  v_seats integer;
  v_base  bigint;
  v_addon bigint := 0;
  v_bonus bigint := 0;
  v_exp   timestamptz;
begin
  select coalesce(sum(bytes), 0) into v_used from public.storage_objects where user_id = p_user;
  v_tier := public.active_tier_for(p_user);
  select seats into v_seats from public.subscriptions where user_id = p_user;
  v_seats := case when v_tier = 'business' then greatest(coalesce(v_seats, 2), 2) else 1 end;
  v_base := case
    when v_tier = 'free' then public.free_post_allowance_bytes()
    else public.gib(public.tier_storage_gb(v_tier)) * v_seats
  end;
  if v_tier <> 'free' then
    v_addon := public.gib(public.addon_storage_gb(p_user));
  end if;
  select bonus_bytes, bonus_expires_at into v_bonus, v_exp from public.storage_quotas where user_id = p_user;
  if v_exp is null or v_exp <= now() then
    v_bonus := 0;
    v_exp := null;
  end if;
  v_bonus := coalesce(v_bonus, 0);
  return jsonb_build_object(
    'tier', v_tier,
    'used_bytes', v_used,
    'base_bytes', v_base,
    'addon_bytes', v_addon,
    'bonus_bytes', v_bonus,
    'quota_bytes', v_base + v_addon + v_bonus,
    'bonus_expires_at', v_exp
  );
end;
$$;
revoke all on function public.storage_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.storage_usage_for(uuid) to service_role;

-- a worker kvótájához: ülésszám + az AI-/render-add-onok többlete (service_role)
create or replace function public.subscription_quota_for(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tier', public.active_tier_for(p_user),
    'seats', coalesce((select seats from public.subscriptions where user_id = p_user), 1),
    'aiTokens', coalesce((select sum(qty) * 1000000 from public.subscription_addons
                            where user_id = p_user and status = 'active' and addon = 'ai_1m'), 0),
    'renderMinutes', coalesce((select sum(qty) * 60 from public.subscription_addons
                                 where user_id = p_user and status = 'active' and addon = 'render_60'), 0)
  );
$$;
revoke all on function public.subscription_quota_for(uuid) from public, anon, authenticated;
grant execute on function public.subscription_quota_for(uuid) to service_role;
