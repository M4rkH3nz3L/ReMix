-- 💰 PRO-CASH C3.6 + C3.7 — ajánlói program, remix-jutalék, alkotói alap (PRO-CASH 6.1, 6.4).
--
-- Minden bevétel MEGKERESETT Coin (30 nap tartás, csalásszűrés a kifizetéskor), a fizetőt a
-- tétel (`coin_lots.payer_id`) rögzíti.
--
-- AJÁNLÓ (6.1): a meghívott a regisztrációt követő 7 napon belül megadhatja az ajánló
-- felhasználónevét (`claim_referral`, egyszer, magát nem). A meghívott COINBÓL fizetett
-- előfizetéséből az ajánló az első fizetett hónapra 50%-ot, a következő 12 hónapra 10%-ot
-- kap. Éves fizetésnél a 12 lefedett hónap arányában (1 × 50% + 11 × 10%) / 12.
--   A forrás: a credit_transactions 'subscription' terhelései (trigger) — a platform bevételéből.
-- REMIX-JUTALÉK (6.1): ha egy bolti tétel egy megvett sablonból készült (`origin_item_id`),
-- minden eladásából az ár 10%-a az eredeti alkotóé (az eladó 70%-ából; a platform 30% marad).
-- ALKOTÓI ALAP (6.4): a Free-reklámbevétel 30%-a havonta, pontszám szerint, a legnagyobb
-- maradék módszerével (determinisztikus, a kerekítés miatt sem vész el cent). Jogosult, akinek
-- legalább 100 követője és 30 nap alatt legalább 1000 minőségi (3 mp feletti, nem saját) nézése van.
-- pontszám = minőségi nézések × (1 + elköteleződési arány, max. 1) × eredetiség (remix: 0,5).

alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check check (kind in (
  'topup', 'purchase', 'sale', 'refund', 'payout', 'transfer', 'gift', 'promo',
  'subscription', 'addon', 'bonus', 'release', 'expire', 'reversal', 'conversion', 'clawback',
  'referral', 'commission', 'fund'
));

-- ═══ ajánló ════════════════════════════════════════════════════════════════════
create table if not exists public.referrals (
  referred_id   uuid primary key references auth.users (id) on delete cascade,
  referrer_id   uuid not null references auth.users (id) on delete cascade,
  first_paid_at timestamptz,
  earned_cents  bigint not null default 0,
  created_at    timestamptz not null default now(),
  check (referred_id <> referrer_id)
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_id);
alter table public.referrals enable row level security;
drop policy if exists "referrals_select_party" on public.referrals;
create policy "referrals_select_party" on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referred_id);

create or replace function public.claim_referral(p_username text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_ref uuid; v_created timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select created_at into v_created from auth.users where id = v_user;
  if v_created < now() - interval '7 days' then raise exception 'referral_window_closed'; end if;
  if exists (select 1 from public.referrals where referred_id = v_user) then raise exception 'referral_already_set'; end if;
  select id into v_ref from public.profiles where lower(username) = lower(trim(p_username));
  if v_ref is null then raise exception 'referrer_not_found'; end if;
  if v_ref = v_user then raise exception 'cannot_refer_self'; end if;
  -- körbe-ajánlás tilos: aki engem ajánlott, azt én nem ajánlhattam
  if exists (select 1 from public.referrals where referred_id = v_ref and referrer_id = v_user) then
    raise exception 'referral_loop';
  end if;
  insert into public.referrals (referred_id, referrer_id) values (v_user, v_ref);
  return jsonb_build_object('referrer', v_ref);
end; $$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- a jutalék aránya a lefedett hónapokra (0. hónap 50%, 1–12. hónap 10%)
create or replace function public.referral_rate(p_month_index integer, p_months integer)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(sum(case when m = 0 then 0.5 when m between 1 and 12 then 0.1 else 0 end), 0) / greatest(p_months, 1)
    from generate_series(p_month_index, p_month_index + greatest(p_months, 1) - 1) m;
$$;

create or replace function public.referral_on_subscription_tx()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.referrals%rowtype; v_months integer; v_idx integer; v_reward bigint;
begin
  select * into r from public.referrals where referred_id = new.user_id for update;
  if not found then return new; end if;
  if r.first_paid_at is null then
    update public.referrals set first_paid_at = new.created_at where referred_id = new.user_id;
    r.first_paid_at := new.created_at;
  end if;
  v_months := case when coalesce(new.note, '') like '%:year:%' then 12 else 1 end;
  v_idx := (extract(year from age(new.created_at, r.first_paid_at)) * 12 + extract(month from age(new.created_at, r.first_paid_at)))::int;
  v_reward := floor(-new.delta_cents * public.referral_rate(v_idx, v_months))::bigint;
  if v_reward > 0 then
    perform public.coin_credit(r.referrer_id, v_reward, 'earned', 'referral', 'referral:' || v_months || 'mo', new.id, new.user_id);
    update public.referrals set earned_cents = earned_cents + v_reward where referred_id = new.user_id;
  end if;
  return new;
end; $$;
drop trigger if exists credit_tx_referral on public.credit_transactions;
create trigger credit_tx_referral after insert on public.credit_transactions
  for each row when (new.kind = 'subscription' and new.delta_cents < 0)
  execute function public.referral_on_subscription_tx();

-- ═══ remix-jutalék ═════════════════════════════════════════════════════════════
alter table public.shop_items add column if not exists origin_item_id uuid references public.shop_items (id) on delete set null;

create or replace function public.commission_pct()
returns integer language sql immutable set search_path = '' as $$ select 10; $$;

-- a származás megjelölése: csak a saját tételen, csak megvett (nem saját) eredetire
create or replace function public.set_item_origin(p_item uuid, p_origin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_origin_seller uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.shop_items where id = p_item and seller_id = v_user) then raise exception 'item not found'; end if;
  select seller_id into v_origin_seller from public.shop_items where id = p_origin;
  if v_origin_seller is null then raise exception 'origin not found'; end if;
  if v_origin_seller = v_user then raise exception 'origin_is_own'; end if;
  if not exists (select 1 from public.shop_purchases where item_id = p_origin and buyer_id = v_user) then
    raise exception 'origin_not_purchased';
  end if;
  update public.shop_items set origin_item_id = p_origin where id = p_item;
end; $$;
revoke all on function public.set_item_origin(uuid, uuid) from public, anon;
grant execute on function public.set_item_origin(uuid, uuid) to authenticated;

create or replace function public.purchase_shop_item(p_item uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer   uuid := auth.uid();
  v_item    public.shop_items%rowtype;
  v_origin_seller uuid;
  v_purchase uuid;
  v_share   bigint;
  v_comm    bigint := 0;
  v_payload jsonb;
begin
  if v_buyer is null then raise exception 'not authenticated'; end if;
  select * into v_item from public.shop_items where id = p_item;
  if not found or v_item.status <> 'published' then raise exception 'item not available'; end if;
  if v_item.seller_id = v_buyer then raise exception 'cannot buy own item'; end if;
  if exists (select 1 from public.shop_purchases where item_id = p_item and buyer_id = v_buyer) then
    raise exception 'already owned';
  end if;

  insert into public.shop_purchases (item_id, buyer_id, price_paid)
    values (p_item, v_buyer, v_item.price_cents) returning id into v_purchase;
  if v_item.price_cents > 0 then
    perform public.coin_debit(v_buyer, v_item.price_cents, 'purchase', v_item.title, v_purchase);
    v_share := public.coin_creator_share(v_item.price_cents, 'sale');
    if v_item.origin_item_id is not null then
      select seller_id into v_origin_seller from public.shop_items where id = v_item.origin_item_id;
      if v_origin_seller is not null and v_origin_seller not in (v_item.seller_id, v_buyer) then
        v_comm := floor(v_item.price_cents * public.commission_pct() / 100.0)::bigint;
      end if;
    end if;
    if v_comm > 0 then
      perform public.coin_credit(v_origin_seller, v_comm, 'earned', 'commission', v_item.title, v_purchase, v_buyer);
    end if;
    if v_share - v_comm > 0 then
      perform public.coin_credit(v_item.seller_id, v_share - v_comm, 'earned', 'sale', v_item.title, v_purchase, v_buyer);
    end if;
  end if;
  update public.shop_items set downloads = downloads + 1 where id = p_item;
  select payload into v_payload from public.shop_item_payloads where item_id = p_item;
  return v_payload;
end; $$;
revoke all on function public.purchase_shop_item(uuid) from public, anon;
grant execute on function public.purchase_shop_item(uuid) to authenticated;

-- ═══ alkotói alap ══════════════════════════════════════════════════════════════
create table if not exists public.creator_fund_runs (
  period      text primary key check (period ~ '^\d{4}-\d{2}$'),
  pool_cents  bigint not null check (pool_cents >= 0),
  total_score numeric not null default 0,
  recipients  integer not null default 0,
  created_at  timestamptz not null default now()
);
create table if not exists public.creator_fund_shares (
  period  text not null references public.creator_fund_runs (period) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  score   numeric not null,
  cents   bigint not null,
  primary key (period, user_id)
);
alter table public.creator_fund_runs enable row level security;
alter table public.creator_fund_shares enable row level security;
drop policy if exists "creator_fund_shares_select_own" on public.creator_fund_shares;
create policy "creator_fund_shares_select_own" on public.creator_fund_shares for select using (auth.uid() = user_id);

create or replace function public.creator_fund_min_followers()
returns integer language sql immutable set search_path = '' as $$ select 100; $$;
create or replace function public.creator_fund_min_views()
returns integer language sql immutable set search_path = '' as $$ select 1000; $$;

-- jogosult alkotók és pontszámuk a `p_now` előtti 30 napra
create or replace function public.creator_fund_scores(p_now timestamptz default now())
returns table (user_id uuid, score numeric)
language sql stable security definer set search_path = '' as $$
  with qv as (
    select p.creator_id as uid, count(*) as views,
           count(*) filter (where p.remix_of_post_id is not null) as remix_views
      from public.post_view_events e join public.posts p on p.id = e.post_id
     where e.created_at > p_now - interval '30 days' and e.created_at <= p_now
       and e.watched_ms > 3000 and e.viewer_id is distinct from p.creator_id
       and p.moderation_status <> 'removed'
     group by p.creator_id
  ), eng as (
    select creator_id as uid, sum(likes + 2 * saves + 3 * remixes)::numeric as acts, greatest(sum(views), 1)::numeric as views
      from public.posts where moderation_status <> 'removed' group by creator_id
  ), fol as (
    select following_id as uid, count(*) as n from public.follows group by following_id
  )
  select qv.uid,
         round(qv.views
           * (1 + least(1, coalesce(eng.acts, 0) / coalesce(eng.views, 1)))
           * (1 - 0.5 * qv.remix_views::numeric / qv.views), 6)
    from qv join fol on fol.uid = qv.uid left join eng on eng.uid = qv.uid
   where fol.n >= public.creator_fund_min_followers() and qv.views >= public.creator_fund_min_views();
$$;
revoke all on function public.creator_fund_scores(timestamptz) from public, anon, authenticated;
grant execute on function public.creator_fund_scores(timestamptz) to service_role;

-- havi szétosztás (idempotens a periódusra): a legnagyobb maradék módszere, holtversenyben user_id
create or replace function public.run_creator_fund(p_period text, p_pool_cents bigint, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_n integer; s record;
begin
  if p_pool_cents is null or p_pool_cents < 0 then raise exception 'invalid pool'; end if;
  if exists (select 1 from public.creator_fund_runs where period = p_period) then
    return (select jsonb_build_object('period', period, 'pool_cents', pool_cents, 'recipients', recipients, 'duplicate', true)
              from public.creator_fund_runs where period = p_period);
  end if;
  create temp table if not exists t_fund (user_id uuid, score numeric, base bigint, frac numeric, cents bigint) on commit drop;
  truncate t_fund;
  insert into t_fund (user_id, score) select x.user_id, x.score from public.creator_fund_scores(p_now) x where x.score > 0;
  select coalesce(sum(score), 0), count(*) into v_total, v_n from t_fund;
  insert into public.creator_fund_runs (period, pool_cents, total_score, recipients) values (p_period, p_pool_cents, v_total, v_n);
  if v_n = 0 then
    return jsonb_build_object('period', p_period, 'pool_cents', p_pool_cents, 'recipients', 0);
  end if;
  update t_fund set base = floor(p_pool_cents * score / v_total), frac = (p_pool_cents * score / v_total) - floor(p_pool_cents * score / v_total);
  update t_fund f set cents = f.base + case when r.rn <= (p_pool_cents - (select sum(base) from t_fund)) then 1 else 0 end
    from (select user_id, row_number() over (order by frac desc, user_id) rn from t_fund) r where r.user_id = f.user_id;
  for s in select * from t_fund where cents > 0 order by user_id loop
    insert into public.creator_fund_shares (period, user_id, score, cents) values (p_period, s.user_id, s.score, s.cents);
    perform public.coin_credit(s.user_id, s.cents, 'earned', 'fund', 'creator_fund:' || p_period, null, null);
  end loop;
  return jsonb_build_object('period', p_period, 'pool_cents', p_pool_cents, 'recipients', v_n,
                            'distributed', (select sum(cents) from t_fund));
end; $$;
revoke all on function public.run_creator_fund(text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.run_creator_fund(text, bigint, timestamptz) to service_role;

-- az eredet (és vele a jutalék címzettje) CSAK a set_item_origin-on át írható — a saját sor
-- RLS-sel szerkeszthető, ezért a közvetlen insert/update-et a trigger tiltja
create or replace function public.shop_items_guard_origin()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.origin_item_id is distinct from (case when tg_op = 'UPDATE' then old.origin_item_id else null end)
     and coalesce(current_setting('remix.origin_ok', true), '') <> '1' then
    raise exception 'origin_via_set_item_origin_only';
  end if;
  return new;
end; $$;
drop trigger if exists shop_items_guard_origin on public.shop_items;
create trigger shop_items_guard_origin before insert or update of origin_item_id on public.shop_items
  for each row execute function public.shop_items_guard_origin();

create or replace function public.set_item_origin(p_item uuid, p_origin uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_origin_seller uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.shop_items where id = p_item and seller_id = v_user) then raise exception 'item not found'; end if;
  select seller_id into v_origin_seller from public.shop_items where id = p_origin;
  if v_origin_seller is null then raise exception 'origin not found'; end if;
  if v_origin_seller = v_user then raise exception 'origin_is_own'; end if;
  if not exists (select 1 from public.shop_purchases where item_id = p_origin and buyer_id = v_user) then
    raise exception 'origin_not_purchased';
  end if;
  perform set_config('remix.origin_ok', '1', true);
  update public.shop_items set origin_item_id = p_origin where id = p_item;
  perform set_config('remix.origin_ok', '', true);
end; $$;

-- az alkotói alap havi futtatása adminból (pénzmozgás: külön `finance.manage` jog)
insert into public.app_permissions (key, label, description, sort)
  values ('finance.manage', 'Pénzügyek kezelése', 'Az alkotói alap havi szétosztása', 120)
on conflict (key) do nothing;
insert into public.role_permissions (role_slug, permission_key) values ('admin', 'finance.manage') on conflict do nothing;

create or replace function public.admin_run_creator_fund(p_period text, p_pool_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'finance.manage') then raise exception 'forbidden'; end if;
  return public.run_creator_fund(p_period, p_pool_cents, now());
end; $$;
revoke all on function public.admin_run_creator_fund(text, bigint) from public, anon;
grant execute on function public.admin_run_creator_fund(text, bigint) to authenticated;
