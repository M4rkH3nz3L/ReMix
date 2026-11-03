-- 🏢 PRO-CASH C4.1 – C4.3 — Vállalati csomag: szervezet, tagok, ülésszám, közös keretek.
--
-- C4.1 `organizations` + `org_members` (owner / admin / member). Egy user egyszerre egy
--      szervezet tagja. A tag a szervezet aktív Vállalati előfizetéséből a `business` szintet
--      kapja (active_tier_for), a saját előfizetése mellett (a magasabb nyer).
--      Ár: fejenként 10 Coin / hó, 10 fő felett 9, 50 fő felett 8; szerződéses ár felülírja
--      (`seat_price_cents`). Min. 2 ülés; a tagok száma nem lépheti túl az ülésszámot.
-- C4.2 Cégellenőrzés: a worker VIES-t és domaint ellenőriz (`org_record_verification`), a
--      szervezet `pending` marad, amíg `finance.manage` jogú admin jóvá nem hagyja (5.1: kézi
--      jóváhagyás). Előfizetni csak `verified` szervezet tud.
-- C4.3 Közös keretek: tárhely = 100 GB × ülés a szervezet összes tagjára; AI-token és render-
--      perc a szervezet tagjainak összesített fogyasztásával szemben (`usage_for_quota`).
--      Az admin taghatárt állíthat (tárhely GB, AI-token, render-perc / hó / fő).

-- ═══ szervezet és tagság ══════════════════════════════════════════════════════
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 2 and 200),
  country          text not null check (country ~ '^[A-Z]{2}$'),
  vat_id           text,                         -- közösségi adószám (VIES), pl. HU12345678
  reg_number       text,                         -- cégjegyzékszám
  domain           text,                         -- céges e-mail-domain
  billing_email    text,
  billing_address  text,
  status           text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'suspended')),
  verification     jsonb not null default '{}'::jsonb,   -- VIES-válasz, domain-ellenőrzés
  verified_at      timestamptz,
  seat_price_cents bigint check (seat_price_cents is null or seat_price_cents > 0),  -- szerződéses ár
  owner_id         uuid not null references auth.users (id) on delete restrict,
  created_at       timestamptz not null default now()
);
alter table public.organizations enable row level security;

create table if not exists public.org_members (
  org_id               uuid not null references public.organizations (id) on delete cascade,
  user_id              uuid not null references auth.users (id) on delete cascade,
  role                 text not null default 'member' check (role in ('owner', 'admin', 'member')),
  storage_limit_gb     integer check (storage_limit_gb is null or storage_limit_gb >= 0),
  ai_tokens_limit      bigint check (ai_tokens_limit is null or ai_tokens_limit >= 0),
  render_minutes_limit integer check (render_minutes_limit is null or render_minutes_limit >= 0),
  joined_at            timestamptz not null default now(),
  primary key (org_id, user_id),
  unique (user_id)
);
alter table public.org_members enable row level security;

create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;
create or replace function public.org_role(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select role from public.org_members where org_id = p_org and user_id = p_user;
$$;

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations for select using (id = public.my_org_id());
drop policy if exists "org_members_select_same_org" on public.org_members;
create policy "org_members_select_same_org" on public.org_members for select using (org_id = public.my_org_id());
-- ÍRÁS-policy szándékosan nincs: minden írás az alábbi RPC-ken át.

alter table public.subscriptions drop constraint if exists subscriptions_org_id_fkey;
alter table public.subscriptions add constraint subscriptions_org_id_fkey
  foreign key (org_id) references public.organizations (id) on delete set null;
alter table public.subscriptions add column if not exists pending_seats integer check (pending_seats is null or pending_seats >= 2);

-- ═══ ár ════════════════════════════════════════════════════════════════════════
-- @contract: fejenként 1000 / 900 (10 fő felett) / 800 (50 fő felett) cent-Coin, a szerződéses ár felülírja
create or replace function public.org_seat_price_cents(p_org uuid, p_seats integer)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select seat_price_cents from public.organizations where id = p_org),
                  case when p_seats > 50 then 800 when p_seats > 10 then 900 else 1000 end)::bigint;
$$;

-- egy előfizetés periódusdíja: szervezetnél a fejenkénti ár × ülés, egyébként a szint ára
create or replace function public.subscription_price_cents(p_org uuid, p_tier text, p_period text, p_seats integer)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when p_org is not null and p_tier = 'business'
    then public.org_seat_price_cents(p_org, p_seats) * greatest(coalesce(p_seats, 2), 2) * (case when p_period = 'year' then 10 else 1 end)
    else public.period_price_cents(p_tier, p_period, p_seats) end;
$$;

-- ═══ a szint öröklése: a szervezet aktív Vállalati előfizetése a tagoknak is jár ═══
create or replace function public.org_subscription_active(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o join public.subscriptions s on s.org_id = o.id and s.user_id = o.owner_id
     where o.id = p_org and o.status = 'verified' and s.tier = 'business'
       and s.status in ('active', 'trialing') and s.current_period_end > now()
  );
$$;

create or replace function public.active_tier_for(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  with own as (
    select coalesce((
      select s.tier from public.subscriptions s
       where s.user_id = p_user and s.status in ('active', 'trialing') and s.current_period_end > now()
         and (s.tier <> 'business' or s.org_id is not null and public.org_subscription_active(s.org_id))
    ), 'free') as t
  ), org as (
    select 'business'::text as t from public.org_members m
     where m.user_id = p_user and public.org_subscription_active(m.org_id)
  )
  select case when exists (select 1 from org) then 'business' else (select t from own) end;
$$;
revoke all on function public.active_tier_for(uuid) from public, anon, authenticated;
grant execute on function public.active_tier_for(uuid) to service_role;

-- ═══ C4.1: létrehozás, tagok, határok ═════════════════════════════════════════
create or replace function public.create_organization(
  p_name text, p_country text, p_vat_id text default null, p_reg_number text default null,
  p_domain text default null, p_billing_email text default null, p_billing_address text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.org_members where user_id = v_user) then raise exception 'already_in_org'; end if;
  insert into public.organizations (name, country, vat_id, reg_number, domain, billing_email, billing_address, owner_id)
    values (trim(p_name), upper(p_country), nullif(upper(replace(coalesce(p_vat_id, ''), ' ', '')), ''),
            nullif(trim(coalesce(p_reg_number, '')), ''), nullif(lower(trim(coalesce(p_domain, ''))), ''),
            nullif(lower(trim(coalesce(p_billing_email, ''))), ''), p_billing_address, v_user)
    returning id into v_id;
  insert into public.org_members (org_id, user_id, role) values (v_id, v_user, 'owner');
  return v_id;
end; $$;
revoke all on function public.create_organization(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, text, text) to authenticated;

create or replace function public.org_seats(p_org uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select s.seats from public.organizations o join public.subscriptions s on s.user_id = o.owner_id and s.org_id = o.id
                    where o.id = p_org and s.tier = 'business'), 2);
$$;

create or replace function public.org_add_member(p_org uuid, p_username text, p_role text default 'member')
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_target uuid;
begin
  if coalesce(public.org_role(p_org, v_user), '') not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  if p_role not in ('admin', 'member') then raise exception 'invalid role'; end if;
  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if v_target is null then raise exception 'user_not_found'; end if;
  if exists (select 1 from public.org_members where user_id = v_target) then raise exception 'already_in_org'; end if;
  perform 1 from public.organizations where id = p_org for update;
  if (select count(*) from public.org_members where org_id = p_org) >= public.org_seats(p_org) then raise exception 'no_free_seat'; end if;
  insert into public.org_members (org_id, user_id, role) values (p_org, v_target, p_role);
end; $$;
revoke all on function public.org_add_member(uuid, text, text) from public, anon;
grant execute on function public.org_add_member(uuid, text, text) to authenticated;

create or replace function public.org_remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_role text;
begin
  v_role := public.org_role(p_org, p_user);
  if v_role is null then raise exception 'not_member'; end if;
  if v_role = 'owner' then raise exception 'cannot_remove_owner'; end if;
  -- kiléphet magától is; mást az owner/admin vehet ki
  if p_user <> v_user and coalesce(public.org_role(p_org, v_user), '') not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  delete from public.org_members where org_id = p_org and user_id = p_user;
end; $$;
revoke all on function public.org_remove_member(uuid, uuid) from public, anon;
grant execute on function public.org_remove_member(uuid, uuid) to authenticated;

create or replace function public.org_set_member_limits(p_org uuid, p_user uuid, p_storage_gb integer, p_ai_tokens bigint, p_render_minutes integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.org_role(p_org, auth.uid()), '') not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  update public.org_members set storage_limit_gb = p_storage_gb, ai_tokens_limit = p_ai_tokens, render_minutes_limit = p_render_minutes
   where org_id = p_org and user_id = p_user;
  if not found then raise exception 'not_member'; end if;
end; $$;
revoke all on function public.org_set_member_limits(uuid, uuid, integer, bigint, integer) from public, anon;
grant execute on function public.org_set_member_limits(uuid, uuid, integer, bigint, integer) to authenticated;

-- ═══ C4.2: ellenőrzés (worker: VIES + domain) és kézi jóváhagyás ═══════════════
create or replace function public.org_record_verification(p_org uuid, p_result jsonb)
returns void language sql security definer set search_path = '' as $$
  update public.organizations set verification = coalesce(verification, '{}'::jsonb) || coalesce(p_result, '{}'::jsonb) where id = p_org;
$$;
revoke all on function public.org_record_verification(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.org_record_verification(uuid, jsonb) to service_role;

create or replace function public.admin_review_org(p_org uuid, p_approve boolean, p_seat_price_cents bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'finance.manage') then raise exception 'forbidden'; end if;
  if (select owner_id from public.organizations where id = p_org) = auth.uid() then raise exception 'cannot_review_own'; end if;
  update public.organizations set
    status = case when p_approve then 'verified' else 'rejected' end,
    verified_at = case when p_approve then now() else null end,
    seat_price_cents = coalesce(p_seat_price_cents, seat_price_cents)
  where id = p_org;
  if not found then raise exception 'not_found'; end if;
end; $$;
revoke all on function public.admin_review_org(uuid, boolean, bigint) from public, anon;
grant execute on function public.admin_review_org(uuid, boolean, bigint) to authenticated;

-- ═══ előfizetés Coinból + ülésszám ═════════════════════════════════════════════
create or replace function public.org_subscribe_with_coins(p_org uuid, p_months integer, p_seats integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); o public.organizations%rowtype; s public.subscriptions%rowtype;
  v_period text; v_cost bigint; v_debit jsonb; v_end timestamptz; v_extend boolean;
begin
  if coalesce(public.org_role(p_org, v_user), '') not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  select * into o from public.organizations where id = p_org for update;
  if o.status <> 'verified' then raise exception 'org_not_verified'; end if;
  if p_months not in (1, 12) then raise exception 'invalid months'; end if;
  if p_seats is null or p_seats < 2 then raise exception 'invalid seats'; end if;
  if p_seats < (select count(*) from public.org_members where org_id = p_org) then raise exception 'seats_below_members'; end if;
  v_period := case when p_months = 12 then 'year' else 'month' end;
  insert into public.subscriptions (user_id) values (o.owner_id) on conflict (user_id) do nothing;
  select * into s from public.subscriptions where user_id = o.owner_id for update;
  if s.source = 'iap' and s.current_period_end > now() and s.status = 'active' then raise exception 'managed_by_store'; end if;
  v_extend := s.org_id = p_org and s.tier = 'business' and s.status = 'active' and s.current_period_end > now()
              and s.seats = p_seats and s.billing_period = v_period;
  if s.org_id = p_org and s.tier = 'business' and s.current_period_end > now() and not v_extend then
    raise exception 'use_org_set_seats';
  end if;
  v_cost := public.org_seat_price_cents(p_org, p_seats) * p_seats * (case when p_months = 12 then 10 else 1 end);
  v_debit := public.coin_debit(v_user, v_cost, 'subscription', 'business:' || v_period || ':' || p_seats || 'seat:org');
  v_end := (case when v_extend then s.current_period_end else now() end) + public.period_interval(v_period);
  update public.subscriptions set tier = 'business', seats = p_seats, org_id = p_org, status = 'active', source = 'coins',
         billing_period = v_period, period_start = case when v_extend then s.period_start else now() end,
         current_period_end = v_end, tier_charge_cents = v_cost, auto_renew = true, pending_tier = null, pending_seats = null
   where user_id = o.owner_id;
  return jsonb_build_object('cost', v_cost, 'until', v_end, 'seats', p_seats, 'balance', (v_debit ->> 'balance')::bigint);
end; $$;
revoke all on function public.org_subscribe_with_coins(uuid, integer, integer) from public, anon;
grant execute on function public.org_subscribe_with_coins(uuid, integer, integer) to authenticated;

-- ülésszám: növelés azonnal, időarányos díjjal; csökkentés a következő ciklustól
create or replace function public.org_set_seats(p_org uuid, p_seats integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); o public.organizations%rowtype; s public.subscriptions%rowtype; v_cost bigint := 0;
begin
  if coalesce(public.org_role(p_org, v_user), '') not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  select * into o from public.organizations where id = p_org;
  select * into s from public.subscriptions where user_id = o.owner_id and org_id = p_org and tier = 'business' for update;
  if not found or s.current_period_end <= now() then raise exception 'no_org_subscription'; end if;
  if p_seats is null or p_seats < 2 then raise exception 'invalid seats'; end if;
  if p_seats < (select count(*) from public.org_members where org_id = p_org) then raise exception 'seats_below_members'; end if;
  if p_seats > s.seats then
    v_cost := ceil(public.org_seat_price_cents(p_org, p_seats) * (p_seats - s.seats)
                   * (case when s.billing_period = 'year' then 10 else 1 end)
                   * public.coin_remaining_fraction(s.period_start, s.current_period_end, now()))::bigint;
    if v_cost > 0 then
      perform public.coin_debit(v_user, v_cost, 'addon', 'seats:' || s.seats || '->' || p_seats || ':prorated');
    end if;
    update public.subscriptions set seats = p_seats, pending_seats = null where user_id = o.owner_id;
    return jsonb_build_object('seats', p_seats, 'cost', v_cost, 'effective', 'now');
  end if;
  update public.subscriptions set pending_seats = p_seats where user_id = o.owner_id;
  return jsonb_build_object('seats', s.seats, 'pending_seats', p_seats, 'cost', 0, 'effective', s.current_period_end);
end; $$;
revoke all on function public.org_set_seats(uuid, integer) from public, anon;
grant execute on function public.org_set_seats(uuid, integer) to authenticated;

-- a megújítás a szervezet fejenkénti árával és a függő ülésszámmal (a C1.3 függvény bővítése)
create or replace function public.renew_due_subscriptions(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_tier text; v_seats integer; v_full bigint; v_cost bigint;
  v_renewed int := 0; v_failed int := 0; v_ended int := 0;
begin
  for s in select * from public.subscriptions
            where source = 'coins' and status = 'active' and current_period_end <= p_now
            for update skip locked loop
    if not s.auto_renew then
      update public.subscriptions set status = 'expired', pending_tier = null, pending_seats = null where user_id = s.user_id;
      update public.subscription_addons set status = 'canceled', canceled_at = p_now where user_id = s.user_id and status = 'active';
      v_ended := v_ended + 1;
      continue;
    end if;
    v_tier := coalesce(s.pending_tier, s.tier);
    v_seats := coalesce(s.pending_seats, s.seats);
    update public.subscription_addons set status = 'canceled', canceled_at = p_now
     where user_id = s.user_id and status = 'active'
       and (cancel_at_period_end or public.tier_rank(v_tier) < public.tier_rank(public.addon_min_tier(addon)));
    v_full := public.subscription_price_cents(s.org_id, v_tier, s.billing_period, v_seats);
    v_cost := v_full + public.addons_period_cents(s.user_id, s.billing_period, true);
    begin
      perform public.coin_debit(s.user_id, v_cost, 'subscription', v_tier || ':' || s.billing_period || ':renewal');
      update public.subscriptions set
        tier = v_tier, seats = v_seats, pending_tier = null, pending_seats = null, period_start = s.current_period_end,
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

-- ═══ C4.3: közös tárhely-keret taghatárral ═════════════════════════════════════
create or replace function public.storage_usage_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_used  bigint; v_self bigint;
  v_tier  text;
  v_seats integer;
  v_base  bigint;
  v_addon bigint := 0;
  v_bonus bigint := 0;
  v_exp   timestamptz;
  v_quota bigint;
  v_since timestamptz;
  m public.org_members%rowtype;
begin
  select coalesce(sum(bytes), 0) into v_self from public.storage_objects where user_id = p_user;
  v_used := v_self;
  v_tier := public.active_tier_for(p_user);
  select * into m from public.org_members where user_id = p_user;
  if v_tier = 'business' and found and public.org_subscription_active(m.org_id) then
    -- a szervezet közös kerete: 100 GB × ülés az összes tag fájljaira
    v_seats := public.org_seats(m.org_id);
    select coalesce(sum(o.bytes), 0) into v_used from public.storage_objects o
      join public.org_members x on x.user_id = o.user_id where x.org_id = m.org_id;
    v_base := public.gib(public.tier_storage_gb('business')) * v_seats;
    v_quota := v_base;
    if m.storage_limit_gb is not null then
      v_quota := least(v_quota, v_used - v_self + public.gib(m.storage_limit_gb));
    end if;
  else
    select seats into v_seats from public.subscriptions where user_id = p_user;
    v_seats := case when v_tier = 'business' then greatest(coalesce(v_seats, 2), 2) else 1 end;
    v_base := case when v_tier = 'free' then public.free_post_allowance_bytes()
                   else public.gib(public.tier_storage_gb(v_tier)) * v_seats end;
    if v_tier <> 'free' then
      v_addon := public.gib(public.addon_storage_gb(p_user));
    end if;
    select bonus_bytes, bonus_expires_at into v_bonus, v_exp from public.storage_quotas where user_id = p_user;
    if v_exp is null or v_exp <= now() then
      v_bonus := 0;
      v_exp := null;
    end if;
    v_bonus := coalesce(v_bonus, 0);
    v_quota := v_base + v_addon + v_bonus;
  end if;

  select over_quota_since into v_since from public.storage_quotas where user_id = p_user;
  if v_used > v_quota and v_since is null then
    v_since := now();
    insert into public.storage_quotas (user_id, over_quota_since) values (p_user, v_since)
      on conflict (user_id) do update set over_quota_since = v_since, grace_notified_at = null;
  elsif v_used <= v_quota and v_since is not null then
    v_since := null;
    update public.storage_quotas set over_quota_since = null, grace_notified_at = null where user_id = p_user;
  end if;

  return jsonb_build_object(
    'tier', v_tier, 'used_bytes', v_used, 'self_bytes', v_self, 'base_bytes', v_base, 'addon_bytes', v_addon,
    'bonus_bytes', coalesce(v_bonus, 0), 'quota_bytes', v_quota, 'bonus_expires_at', v_exp,
    'org_id', case when m.org_id is not null and v_tier = 'business' then m.org_id end,
    'over_quota', v_used > v_quota, 'over_quota_since', v_since,
    'grace_until', case when v_since is null then null else v_since + (public.storage_grace_days() || ' days')::interval end,
    'archive_at', case when v_since is null then null else v_since + (public.storage_archive_days() || ' days')::interval end
  );
end;
$$;
revoke all on function public.storage_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.storage_usage_for(uuid) to service_role;

-- ═══ C4.3: AI-/render-keret a szervezet összesített fogyasztásával ══════════════
create or replace function public.subscription_quota_for(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tier', public.active_tier_for(p_user),
    'seats', coalesce((select public.org_seats(m.org_id) from public.org_members m
                        where m.user_id = p_user and public.org_subscription_active(m.org_id)),
                      (select seats from public.subscriptions where user_id = p_user), 1),
    'orgId', (select m.org_id from public.org_members m where m.user_id = p_user and public.org_subscription_active(m.org_id)),
    'aiTokens', coalesce((select sum(qty) * 1000000 from public.subscription_addons
                            where user_id = p_user and status = 'active' and addon = 'ai_1m'), 0),
    'renderMinutes', coalesce((select sum(qty) * 60 from public.subscription_addons
                                 where user_id = p_user and status = 'active' and addon = 'render_60'), 0),
    'memberLimits', (select jsonb_build_object('aiTokens', m.ai_tokens_limit, 'renderMinutes', m.render_minutes_limit)
                       from public.org_members m where m.user_id = p_user and public.org_subscription_active(m.org_id))
  );
$$;
revoke all on function public.subscription_quota_for(uuid) from public, anon, authenticated;
grant execute on function public.subscription_quota_for(uuid) to service_role;

-- a fogyasztás: szervezeti tagnál a teljes szervezeté (közös keret) és a sajátja (taghatár)
create or replace function public.usage_for_quota(p_user uuid, p_period text, p_metric text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'self', coalesce((select amount from public.usage_counters where user_id = p_user and period = p_period and metric = p_metric), 0),
    'pool', coalesce((select sum(u.amount) from public.usage_counters u join public.org_members x on x.user_id = u.user_id
                       where x.org_id = (select org_id from public.org_members where user_id = p_user)
                         and u.period = p_period and u.metric = p_metric),
                     (select amount from public.usage_counters where user_id = p_user and period = p_period and metric = p_metric), 0)
  );
$$;
revoke all on function public.usage_for_quota(uuid, text, text) from public, anon, authenticated;
grant execute on function public.usage_for_quota(uuid, text, text) to service_role;

-- a tag a saját szervezetének áttekintését kéri (konzol)
create or replace function public.my_org()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.my_org_id(); o public.organizations%rowtype; s public.subscriptions%rowtype;
begin
  if v_org is null then return null; end if;
  select * into o from public.organizations where id = v_org;
  select * into s from public.subscriptions where user_id = o.owner_id;
  return jsonb_build_object(
    'id', o.id, 'name', o.name, 'country', o.country, 'vat_id', o.vat_id, 'status', o.status, 'verification', o.verification,
    'my_role', public.org_role(v_org, auth.uid()),
    'seats', public.org_seats(v_org), 'pending_seats', s.pending_seats,
    'seat_price_cents', public.org_seat_price_cents(v_org, public.org_seats(v_org)),
    'active', public.org_subscription_active(v_org), 'until', case when s.org_id = v_org then s.current_period_end end,
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', p.username, 'role', m.role,
                          'storage_limit_gb', m.storage_limit_gb, 'ai_tokens_limit', m.ai_tokens_limit,
                          'render_minutes_limit', m.render_minutes_limit) order by m.joined_at)
                          from public.org_members m left join public.profiles p on p.id = m.user_id where m.org_id = v_org), '[]'::jsonb),
    'storage', public.storage_usage_for(o.owner_id)
  );
end; $$;
revoke all on function public.my_org() from public, anon;
grant execute on function public.my_org() to authenticated;

-- a Vállalati szint csak szervezethez köthető: Coinból szervezet nélkül nem vehető (különben
-- terhelnénk, de az active_tier_for nem adná meg) — a terhelés is visszagördül
create or replace function public.subscriptions_guard_business()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tier = 'business' and new.org_id is null and new.source in ('coins', 'iap', 'trial') then
    raise exception 'use_org_subscription';
  end if;
  return new;
end; $$;
drop trigger if exists subscriptions_guard_business on public.subscriptions;
create trigger subscriptions_guard_business before insert or update of tier, org_id, source on public.subscriptions
  for each row execute function public.subscriptions_guard_business();
