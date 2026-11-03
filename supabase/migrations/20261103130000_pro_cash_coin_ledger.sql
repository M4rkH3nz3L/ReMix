-- 🪙 PRO-CASH C0.3 + C0.4 (+ C3.1, C3.2 alapja) — Coin-főkönyv három alegyenleggel, cent-Coinban.
--
-- EGYSÉG: 1 Coin = 100 cent-Coin; vétel 1 Coin = 5 € (web) / 5,99 € (áruház), beváltás
-- 1 MEGKERESETT Coin = 3 €. A főkönyv MINDENHOL egész cent-Coinban számol (bigint).
--
-- ALEGYENLEGEK (`user_credits`):
--   purchased_cents        — feltöltés (web/IAP). Elkölthető, PÉNZRE NEM váltható, nem jár le.
--   bonus_cents            — csomag-bónusz, promó, jutalmazott reklám. Elkölthető, nem váltható,
--                            12 hónap után lejár (a lejárat tételenként a `coin_lots`-ban).
--   earned_pending_cents   — eladásból/ajándékból/jutalékból, 30 napos TARTÁSBAN (visszaterhelési
--                            ablak). Elkölthető, még nem váltható; visszavonható.
--   earned_available_cents — a tartás letelt: pénzre váltható (kifizetés csak innen).
--   balance                — a négy összege (generált oszlop, a kliens kijelzéséhez).
-- KÖLTÉSI SORREND: bónusz (a leghamarabb lejáró előbb) → vásárolt → beváltható → függő.
--
-- MINDEN pénzmozgás a belső `coin_credit` / `coin_debit` függvényeken megy (sorzárral,
-- tranzakcióban); ezeket kliens NEM hívhatja, csak a SECURITY DEFINER RPC-k és a worker.
-- A tiszta logika tükre: src/lib/coins.ts (a díj-elosztás és a költési sorrend).
--
-- D2 (átváltás): a régi egység 1 koin = 5 Ft volt. A befizetett forintérték szerint, 400 Ft/€
-- feltételezéssel: 1 régi koin = 5 Ft = 0,0125 € = 0,25 cent-Coin → floor(régi / 4). A régi
-- egyenleg a VÁSÁROLT alegyenlegre kerül (nem váltható — a régi rendszerben nem volt tartás).

-- ═══ alegyenlegek ═════════════════════════════════════════════════════════════
alter table public.user_credits add column if not exists purchased_cents bigint not null default 0;
alter table public.user_credits add column if not exists bonus_cents bigint not null default 0;
alter table public.user_credits add column if not exists earned_pending_cents bigint not null default 0;
alter table public.user_credits add column if not exists earned_available_cents bigint not null default 0;
update public.user_credits set purchased_cents = floor(balance / 4.0)::bigint;
alter table public.user_credits drop column balance;
alter table public.user_credits add column balance bigint
  generated always as (purchased_cents + bonus_cents + earned_pending_cents + earned_available_cents) stored;
alter table public.user_credits add constraint user_credits_buckets_nonneg check (
  purchased_cents >= 0 and bonus_cents >= 0 and earned_pending_cents >= 0 and earned_available_cents >= 0
);
comment on column public.user_credits.balance is 'Összes egyenleg cent-Coinban (1 Coin = 100). Generált: a négy alegyenleg összege.';

-- ═══ főkönyvi napló: cent-Coin + alegyenleg ═══════════════════════════════════
alter table public.credit_transactions rename column delta to legacy_delta;
alter table public.credit_transactions alter column legacy_delta drop not null;
alter table public.credit_transactions add column if not exists delta_cents bigint not null default 0;
alter table public.credit_transactions add column if not exists bucket text;
update public.credit_transactions set delta_cents = trunc(legacy_delta / 4.0)::bigint, bucket = 'purchased'
  where legacy_delta is not null;
comment on column public.credit_transactions.legacy_delta is 'A 2026-11-03 előtti, régi (5 Ft-os) koin-egység. Új sor nem írja.';
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check check (kind in (
  'topup', 'purchase', 'sale', 'refund', 'payout', 'transfer', 'gift', 'promo',
  'subscription', 'addon', 'bonus', 'release', 'expire', 'reversal', 'conversion'
));
alter table public.credit_transactions drop constraint if exists credit_transactions_bucket_check;
alter table public.credit_transactions add constraint credit_transactions_bucket_check
  check (bucket is null or bucket in ('purchased', 'bonus', 'earned_pending', 'earned_available'));

-- ═══ tételek: a bónusz lejárata és a megkeresett Coin tartása tételenként ══════
create table if not exists public.coin_lots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  bucket          text not null check (bucket in ('bonus', 'earned')),
  amount_cents    bigint not null check (amount_cents > 0),
  remaining_cents bigint not null check (remaining_cents >= 0),
  -- earned: mikor válik beválthatóvá · bonus: mikor jár le
  available_at    timestamptz,
  expires_at      timestamptz,
  -- earned: pending → released · bármelyik: reversed (visszaterhelés) / expired (bónusz)
  status          text not null default 'pending' check (status in ('pending', 'released', 'reversed', 'expired')),
  kind            text not null,                       -- sale / gift / referral / topup_bonus / promo / rewarded …
  source_ref      uuid,                                -- shop_purchases.id / gift_events.id / …
  payer_id        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (remaining_cents <= amount_cents)
);
create index if not exists coin_lots_user_idx on public.coin_lots (user_id, bucket, status);
create index if not exists coin_lots_due_idx on public.coin_lots (available_at) where bucket = 'earned' and status = 'pending';
create index if not exists coin_lots_expiry_idx on public.coin_lots (expires_at) where bucket = 'bonus' and status = 'pending';
create index if not exists coin_lots_source_idx on public.coin_lots (source_ref);
alter table public.coin_lots enable row level security;
drop policy if exists "coin_lots_select_own" on public.coin_lots;
create policy "coin_lots_select_own" on public.coin_lots for select using (auth.uid() = user_id);
-- ÍRÁS-policy szándékosan nincs.

-- ═══ árak és arányok (a src/lib/coins.ts tükre; a contract.test.ts zárolja) ════
-- @contract: a havidíj cent-Coinban / fő (Free 0 · Amatőr 2 · Haladó 4 · Profi 8 · Vállalati 10 Coin)
create or replace function public.tier_price_cents(p_tier text)
returns bigint language sql immutable set search_path = '' as $$
  select case p_tier
    when 'free' then 0
    when 'basic' then 200
    when 'pro' then 400
    when 'ultra' then 800
    when 'business' then 1000
    else null
  end::bigint;
$$;

-- a platform díja százalékban: bolt 30, ajándék 20 (D3)
create or replace function public.coin_fee_pct(p_kind text)
returns integer language sql immutable set search_path = '' as $$
  select case p_kind when 'sale' then 30 when 'gift' then 20 else 0 end;
$$;

-- az alkotó része: ár − floor(ár × díj%) — a platform a lefelé kerekített díjat kapja
create or replace function public.coin_creator_share(p_price bigint, p_kind text)
returns bigint language sql immutable set search_path = '' as $$
  select p_price - floor(p_price * public.coin_fee_pct(p_kind) / 100.0)::bigint;
$$;

create or replace function public.coin_hold_interval()
returns interval language sql immutable set search_path = '' as $$ select interval '30 days'; $$;
create or replace function public.coin_bonus_ttl()
returns interval language sql immutable set search_path = '' as $$ select interval '12 months'; $$;
-- a kifizetés minimuma (20 Coin) és a beváltási ár (1 megkeresett Coin = 3 € → 1 cent-Coin = 3 euró-cent)
create or replace function public.coin_min_payout_cents()
returns bigint language sql immutable set search_path = '' as $$ select 2000::bigint; $$;
create or replace function public.coin_payout_eur_cents(p_cents bigint)
returns bigint language sql immutable set search_path = '' as $$ select p_cents * 3; $$;

-- ═══ belső: lusta karbantartás (tartás-feloldás, bónusz-lejárat) egy userre ════
-- Minden olvasás/költés előtt lefut → az ütemező nélkül is pontos; a worker ütemezője
-- (`coin_release_due`) ugyanezt csinálja mindenkire.
create or replace function public.coin_settle(p_user uuid, p_now timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
declare v_rel bigint; v_exp bigint;
begin
  perform 1 from public.user_credits where user_id = p_user for update;
  if not found then return; end if;

  with due as (
    update public.coin_lots set status = 'released'
     where user_id = p_user and bucket = 'earned' and status = 'pending' and available_at <= p_now
     returning remaining_cents
  ) select coalesce(sum(remaining_cents), 0) into v_rel from due;
  if v_rel > 0 then
    update public.user_credits
       set earned_pending_cents = earned_pending_cents - v_rel,
           earned_available_cents = earned_available_cents + v_rel, updated_at = now()
     where user_id = p_user;
    insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note)
      values (p_user, -v_rel, 'earned_pending', 'release', 'hold_released'),
             (p_user, v_rel, 'earned_available', 'release', 'hold_released');
  end if;

  with gone as (
    update public.coin_lots set status = 'expired'
     where user_id = p_user and bucket = 'bonus' and status = 'pending' and expires_at <= p_now
       and remaining_cents > 0
     returning remaining_cents
  ) select coalesce(sum(remaining_cents), 0) into v_exp from gone;
  if v_exp > 0 then
    update public.user_credits set bonus_cents = bonus_cents - v_exp, updated_at = now() where user_id = p_user;
    insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note)
      values (p_user, -v_exp, 'bonus', 'expire', 'bonus_expired');
  end if;
end; $$;

-- ═══ belső: jóváírás egy alegyenlegre ═════════════════════════════════════════
-- p_bucket: purchased | bonus | earned. Az earned TARTÁSBA kerül (függő), a bonus lejár.
create or replace function public.coin_credit(
  p_user uuid, p_cents bigint, p_bucket text, p_kind text,
  p_note text default null, p_ref uuid default null, p_payer uuid default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_balance bigint; v_col text;
begin
  if p_user is null then raise exception 'user required'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'invalid amount'; end if;
  if p_bucket not in ('purchased', 'bonus', 'earned') then raise exception 'invalid bucket'; end if;

  insert into public.user_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.user_credits where user_id = p_user for update;

  if p_bucket = 'purchased' then
    update public.user_credits set purchased_cents = purchased_cents + p_cents, updated_at = now() where user_id = p_user;
    v_col := 'purchased';
  elsif p_bucket = 'bonus' then
    update public.user_credits set bonus_cents = bonus_cents + p_cents, updated_at = now() where user_id = p_user;
    insert into public.coin_lots (user_id, bucket, amount_cents, remaining_cents, expires_at, kind, source_ref, payer_id)
      values (p_user, 'bonus', p_cents, p_cents, now() + public.coin_bonus_ttl(), p_kind, p_ref, p_payer);
    v_col := 'bonus';
  else
    update public.user_credits set earned_pending_cents = earned_pending_cents + p_cents, updated_at = now() where user_id = p_user;
    insert into public.coin_lots (user_id, bucket, amount_cents, remaining_cents, available_at, kind, source_ref, payer_id)
      values (p_user, 'earned', p_cents, p_cents, now() + public.coin_hold_interval(), p_kind, p_ref, p_payer);
    v_col := 'earned_pending';
  end if;

  insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
    values (p_user, p_cents, v_col, p_kind, p_note, p_ref);
  select balance into v_balance from public.user_credits where user_id = p_user;
  return v_balance;
end; $$;

-- ═══ belső: terhelés a költési sorrendben ═════════════════════════════════════
-- bónusz (leghamarabb lejáró tétel előbb) → vásárolt → beváltható → függő (a legkésőbb
-- feloldódó tétel előbb, hogy a korábbi tartások hamarabb beválthatók maradjanak).
-- Kevés egyenleg → 'insufficient_credits'. Visszaadja a bontást.
create or replace function public.coin_debit(
  p_user uuid, p_cents bigint, p_kind text, p_note text default null, p_ref uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.user_credits%rowtype;
  v_left bigint := p_cents;
  v_bonus bigint := 0; v_purch bigint := 0; v_avail bigint := 0; v_pend bigint := 0;
  v_take bigint;
  lot record;
begin
  if p_user is null then raise exception 'user required'; end if;
  if p_cents is null or p_cents <= 0 then raise exception 'invalid amount'; end if;

  perform public.coin_settle(p_user);
  select * into w from public.user_credits where user_id = p_user for update;
  if not found or w.balance < p_cents then raise exception 'insufficient_credits'; end if;

  -- 1. bónusz, tételenként a lejárat sorrendjében
  for lot in select id, remaining_cents from public.coin_lots
              where user_id = p_user and bucket = 'bonus' and status = 'pending' and remaining_cents > 0
              order by expires_at, created_at for update loop
    exit when v_left = 0;
    v_take := least(v_left, lot.remaining_cents);
    update public.coin_lots set remaining_cents = remaining_cents - v_take where id = lot.id;
    v_bonus := v_bonus + v_take; v_left := v_left - v_take;
  end loop;
  -- 2. vásárolt
  v_purch := least(v_left, w.purchased_cents); v_left := v_left - v_purch;
  -- 3. beváltható megkeresett
  v_avail := least(v_left, w.earned_available_cents); v_left := v_left - v_avail;
  -- 4. függő megkeresett, a legkésőbb feloldódó tétel előbb
  for lot in select id, remaining_cents from public.coin_lots
              where user_id = p_user and bucket = 'earned' and status = 'pending' and remaining_cents > 0
              order by available_at desc, created_at desc for update loop
    exit when v_left = 0;
    v_take := least(v_left, lot.remaining_cents);
    update public.coin_lots set remaining_cents = remaining_cents - v_take where id = lot.id;
    v_pend := v_pend + v_take; v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'insufficient_credits'; end if;

  update public.user_credits set
    bonus_cents = bonus_cents - v_bonus,
    purchased_cents = purchased_cents - v_purch,
    earned_available_cents = earned_available_cents - v_avail,
    earned_pending_cents = earned_pending_cents - v_pend,
    updated_at = now()
  where user_id = p_user;

  insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
  select p_user, -x.amt, x.b, p_kind, p_note, p_ref
    from (values (v_bonus, 'bonus'), (v_purch, 'purchased'), (v_avail, 'earned_available'), (v_pend, 'earned_pending')) as x(amt, b)
   where x.amt > 0;

  return jsonb_build_object('bonus', v_bonus, 'purchased', v_purch, 'earned_available', v_avail,
                            'earned_pending', v_pend, 'balance', w.balance - p_cents);
end; $$;

-- ═══ belső: egy megkeresett tétel visszavonása (visszaterhelés, C3.1) ══════════
-- A még függő rész egyszerűen eltűnik; a már feloldott részt a beválthatóból vonjuk le,
-- amennyi van. A le nem vonható maradékot (már kifizették / elköltötték) a válasz jelzi,
-- ezt kézi ellenőrzés kezeli (PRO-CASH 2.5).
create or replace function public.coin_reverse_earning(p_ref uuid, p_reason text default 'chargeback')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lot record; v_rev bigint := 0; v_short bigint := 0; v_take bigint; v_avail bigint;
begin
  for lot in select * from public.coin_lots
              where source_ref = p_ref and bucket = 'earned' and status in ('pending', 'released') for update loop
    perform 1 from public.user_credits where user_id = lot.user_id for update;
    if lot.status = 'pending' then
      update public.user_credits set earned_pending_cents = earned_pending_cents - lot.remaining_cents, updated_at = now()
        where user_id = lot.user_id;
      if lot.remaining_cents > 0 then
        insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
          values (lot.user_id, -lot.remaining_cents, 'earned_pending', 'reversal', p_reason, p_ref);
      end if;
      v_rev := v_rev + lot.remaining_cents;
      v_short := v_short + (lot.amount_cents - lot.remaining_cents);
    else
      -- feloldott tétel: a remaining a feloldáskor beválthatóvá vált rész
      select earned_available_cents into v_avail from public.user_credits where user_id = lot.user_id;
      v_take := least(lot.remaining_cents, v_avail);
      if v_take > 0 then
        update public.user_credits set earned_available_cents = earned_available_cents - v_take, updated_at = now()
          where user_id = lot.user_id;
        insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
          values (lot.user_id, -v_take, 'earned_available', 'reversal', p_reason, p_ref);
      end if;
      v_rev := v_rev + v_take;
      v_short := v_short + (lot.amount_cents - v_take);  -- a tartás alatt elköltött + a már nem levonható rész
    end if;
    update public.coin_lots set status = 'reversed', remaining_cents = 0 where id = lot.id;
  end loop;
  return jsonb_build_object('reversed_cents', v_rev, 'unrecovered_cents', v_short);
end; $$;

-- ═══ ütemező: minden lejárt tartás és bónusz feldolgozása (worker hívja) ═══════
create or replace function public.coin_release_due(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare u uuid; n integer := 0;
begin
  for u in select distinct user_id from public.coin_lots
            where status = 'pending'
              and ((bucket = 'earned' and available_at <= p_now) or (bucket = 'bonus' and expires_at <= p_now)) loop
    perform public.coin_settle(u, p_now);
    n := n + 1;
  end loop;
  return n;
end; $$;

revoke all on function public.coin_settle(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.coin_credit(uuid, bigint, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.coin_debit(uuid, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function public.coin_reverse_earning(uuid, text) from public, anon, authenticated;
revoke all on function public.coin_release_due(timestamptz) from public, anon, authenticated;
grant execute on function public.coin_credit(uuid, bigint, text, text, text, uuid, uuid) to service_role;
grant execute on function public.coin_debit(uuid, bigint, text, text, uuid) to service_role;
grant execute on function public.coin_reverse_earning(uuid, text) to service_role;
grant execute on function public.coin_release_due(timestamptz) to service_role;

-- ═══ a kliens pénztárcája: bontás + a következő feloldás ═══════════════════════
create or replace function public.my_wallet()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); w public.user_credits%rowtype; v_next timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  perform public.coin_settle(v_user);
  select * into w from public.user_credits where user_id = v_user;
  select min(available_at) into v_next from public.coin_lots
   where user_id = v_user and bucket = 'earned' and status = 'pending' and remaining_cents > 0;
  return jsonb_build_object(
    'purchased', coalesce(w.purchased_cents, 0),
    'bonus', coalesce(w.bonus_cents, 0),
    'earned_pending', coalesce(w.earned_pending_cents, 0),
    'earned_available', coalesce(w.earned_available_cents, 0),
    'balance', coalesce(w.balance, 0),
    'next_release_at', v_next
  );
end; $$;
revoke all on function public.my_wallet() from public, anon;
grant execute on function public.my_wallet() to authenticated;

-- ═══ jóváírás kívülről (service_role: IAP / web / dev) — a régi grant_credits helyett ═
drop function if exists public.grant_credits(uuid, integer, text, text, uuid);
create or replace function public.grant_coins(
  p_user uuid, p_cents bigint, p_bucket text default 'purchased', p_kind text default 'topup',
  p_note text default null, p_ref uuid default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  return public.coin_credit(p_user, p_cents, p_bucket, p_kind, p_note, p_ref, null);
end; $$;
revoke all on function public.grant_coins(uuid, bigint, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_coins(uuid, bigint, text, text, text, uuid) to service_role;

-- 🚫 közvetlen user↔user koin-küldés: megszűnik (pénzmosás-kockázat, PRO-CASH 2.4)
drop function if exists public.send_credits(text, integer);

-- ═══ bolt: ár cent-Coinban, 70/30, az eladó része TARTÁSBA ═════════════════════
alter table public.shop_items rename column price_credits to price_cents;
alter table public.shop_items alter column price_cents type bigint;
update public.shop_items set price_cents = case when price_cents = 0 then 0 else greatest(20, round(price_cents / 4.0)) end;
alter table public.shop_items drop constraint if exists shop_items_price_credits_check;
alter table public.shop_items add constraint shop_items_price_check check (price_cents = 0 or price_cents >= 20);
alter table public.shop_purchases alter column price_paid type bigint;
comment on column public.shop_purchases.price_paid is 'cent-Coin (2026-11-03 előtt régi koin).';

create or replace function public.purchase_shop_item(p_item uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer   uuid := auth.uid();
  v_item    public.shop_items%rowtype;
  v_purchase uuid;
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
    perform public.coin_credit(v_item.seller_id, public.coin_creator_share(v_item.price_cents, 'sale'),
                               'earned', 'sale', v_item.title, v_purchase, v_buyer);
  end if;
  update public.shop_items set downloads = downloads + 1 where id = p_item;

  select payload into v_payload from public.shop_item_payloads where item_id = p_item;
  return v_payload;
end; $$;
revoke all on function public.purchase_shop_item(uuid) from public, anon;
grant execute on function public.purchase_shop_item(uuid) to authenticated;

-- ═══ ajándék: 0,10–100 Coin, 80/20 (D3), az alkotó része TARTÁSBA ═════════════
alter table public.gifts rename column cost_coins to cost_cents;
alter table public.gifts alter column cost_cents type bigint;
update public.gifts g set cost_cents = v.c from (values
  ('rose', 10), ('heart', 20), ('star', 50), ('confetti', 100), ('crown', 200),
  ('rocket', 500), ('diamond', 1000), ('sportscar', 2500), ('castle', 5000), ('universe', 10000)
) as v(id, c) where g.id = v.id;
alter table public.gifts drop constraint if exists gifts_cost_coins_check;
alter table public.gifts add constraint gifts_cost_check check (cost_cents between 10 and 10000);
alter table public.gift_events rename column coins to cost_cents;
alter table public.gift_events alter column cost_cents type bigint;
alter table public.gift_events add column if not exists creator_cents bigint;

create or replace function public.send_gift(
  p_to_username text, p_gift_id text, p_post_id text default null, p_message text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from  uuid := auth.uid();
  v_to    uuid;
  v_cost  bigint;
  v_share bigint;
  v_event uuid;
  v_debit jsonb;
begin
  if v_from is null then raise exception 'not authenticated'; end if;
  select cost_cents into v_cost from public.gifts where id = p_gift_id and active;
  if v_cost is null then raise exception 'gift_not_found'; end if;
  select id into v_to from public.profiles where lower(username) = lower(trim(p_to_username));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = v_from then raise exception 'cannot_send_to_self'; end if;

  v_share := public.coin_creator_share(v_cost, 'gift');
  insert into public.gift_events (from_user, to_user, gift_id, cost_cents, creator_cents, post_id, message)
    values (v_from, v_to, p_gift_id, v_cost, v_share, p_post_id, p_message) returning id into v_event;
  v_debit := public.coin_debit(v_from, v_cost, 'gift', p_gift_id || ':to:' || p_to_username, v_event);
  perform public.coin_credit(v_to, v_share, 'earned', 'gift', p_gift_id || ':from', v_event, v_from);

  return jsonb_build_object('balance', (v_debit ->> 'balance')::bigint, 'cost', v_cost, 'creator', v_share);
end; $$;
revoke all on function public.send_gift(text, text, text, text) from public, anon;
grant execute on function public.send_gift(text, text, text, text) to authenticated;

-- ═══ előfizetés Coinból (C1.1 előtti, egyszerű út) ═════════════════════════════
-- Ugyanannak a szintnek a meghosszabbítása vagy Free-ről indulás; a szintváltás
-- (időarányos jóváírás) a C1.1 `subscribe_with_coins` bővítésével jön.
-- Ár: tier_price_cents × hónap × ülés; 12 hónap = 10 havi díj (2 hónap ajándék).
create or replace function public.subscribe_with_coins(p_tier text, p_months integer, p_seats integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user  uuid := auth.uid();
  v_seats integer;
  v_cost  bigint;
  v_cur   public.subscriptions%rowtype;
  v_active text;
  v_base  timestamptz;
  v_end   timestamptz;
  v_debit jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_tier not in ('basic', 'pro', 'ultra', 'business') then raise exception 'invalid tier'; end if;
  if p_months is null or p_months not in (1, 12) then raise exception 'invalid months'; end if;
  v_seats := case when p_tier = 'business' then coalesce(p_seats, 2) else 1 end;
  if v_seats < 1 or (p_tier = 'business' and v_seats < 2) then raise exception 'invalid seats'; end if;

  select * into v_cur from public.subscriptions where user_id = v_user for update;
  v_active := public.active_tier_for(v_user);
  if v_active <> 'free' and (v_active <> p_tier or v_cur.seats <> v_seats) then
    raise exception 'tier_change_not_supported';
  end if;

  v_cost := public.tier_price_cents(p_tier) * v_seats * (case when p_months = 12 then 10 else 1 end);
  v_debit := public.coin_debit(v_user, v_cost, 'subscription', p_tier || ':' || p_months || 'mo:' || v_seats || 'seat');

  v_base := case when v_active = p_tier then v_cur.current_period_end else now() end;
  v_end := v_base + (p_months || ' months')::interval;
  insert into public.subscriptions (user_id, tier, seats, status, current_period_end, source)
    values (v_user, p_tier, v_seats, 'active', v_end, 'coins')
  on conflict (user_id) do update
    set tier = p_tier, seats = v_seats, status = 'active', current_period_end = v_end, source = 'coins';

  return jsonb_build_object('balance', (v_debit ->> 'balance')::bigint, 'cost', v_cost, 'tier', p_tier, 'until', v_end);
end; $$;
revoke all on function public.subscribe_with_coins(text, integer, integer) from public, anon;
grant execute on function public.subscribe_with_coins(text, integer, integer) to authenticated;

drop function if exists public.subscribe_pro_with_credits(integer);

-- ═══ tárhely-bővítés: 1 Coin / 10 GB / hó (a C1.2 add-on modell előtti átárazás) ═
create or replace function public.buy_storage_boost(p_gb integer, p_months integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_cost    bigint;
  v_add     bigint;
  v_cur_exp timestamptz;
  v_cur_bon bigint;
  v_new_exp timestamptz;
  v_new_bon bigint;
  v_debit   jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_gb is null or p_gb < 1 or p_gb > 100 then raise exception 'invalid gb'; end if;
  if p_months is null or p_months < 1 or p_months > 12 then raise exception 'invalid months'; end if;
  if public.active_tier_for(v_user) = 'free' then raise exception 'paid_tier_required'; end if;

  v_cost := p_gb::bigint * p_months * 10;  -- 0,10 Coin / GB / hó = 1 Coin / 10 GB / hó
  v_debit := public.coin_debit(v_user, v_cost, 'addon', 'storage_boost:' || p_gb || 'GBx' || p_months || 'mo');

  v_add := public.gib(p_gb);
  select bonus_bytes, bonus_expires_at into v_cur_bon, v_cur_exp from public.storage_quotas where user_id = v_user;
  if v_cur_exp is null or v_cur_exp <= now() then
    v_new_bon := v_add;
    v_new_exp := now() + (p_months || ' months')::interval;
  else
    v_new_bon := coalesce(v_cur_bon, 0) + v_add;
    v_new_exp := v_cur_exp + (p_months || ' months')::interval;
  end if;
  insert into public.storage_quotas (user_id, bonus_bytes, bonus_expires_at, updated_at)
    values (v_user, v_new_bon, v_new_exp, now())
  on conflict (user_id) do update set bonus_bytes = v_new_bon, bonus_expires_at = v_new_exp, updated_at = now();

  return jsonb_build_object('balance', (v_debit ->> 'balance')::bigint, 'cost', v_cost, 'usage', public.storage_usage_for(v_user));
end; $$;
revoke all on function public.buy_storage_boost(integer, integer) from public, anon;
grant execute on function public.buy_storage_boost(integer, integer) to authenticated;

-- ═══ poszt-promóció: a büdzsé és a nézetenkénti ár cent-Coinban ════════════════
comment on column public.post_promotions.budget_credits is 'cent-Coin (2026-11-03-tól).';
comment on column public.post_promotions.cost_per_view is 'cent-Coin / nézés (2026-11-03-tól).';
comment on column public.post_promotions.spent_credits is 'cent-Coin (2026-11-03-tól).';
create or replace function public.promote_post(p_post uuid, p_budget integer, p_cost_per_view integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sponsor uuid := auth.uid();
  v_cpv int := greatest(1, coalesce(p_cost_per_view, 1));
  v_budget int := coalesce(p_budget, 0);
  v_target int;
  v_id uuid;
begin
  if v_sponsor is null then raise exception 'not authenticated'; end if;
  if v_budget < v_cpv then raise exception 'budget too small'; end if;
  if not exists (select 1 from public.posts where id = p_post and moderation_status <> 'removed') then
    raise exception 'post not available';
  end if;
  perform public.coin_debit(v_sponsor, v_budget, 'purchase', 'promotion', p_post);
  v_target := floor(v_budget / v_cpv)::int;
  insert into public.post_promotions (post_id, sponsor_id, budget_credits, cost_per_view, views_target)
    values (p_post, v_sponsor, v_budget, v_cpv, v_target) returning id into v_id;
  update public.posts set promoted = true where id = p_post;
  return jsonb_build_object('promotionId', v_id, 'viewsTarget', v_target);
end; $$;
revoke all on function public.promote_post(uuid, integer, integer) from public, anon;
grant execute on function public.promote_post(uuid, integer, integer) to authenticated;

-- ═══ promó-kód: a jóváírás BÓNUSZ (nem váltható pénzre), cent-Coinban ══════════
create or replace function public.redeem_promo(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  c         public.promo_codes%rowtype;
  v_global  integer;
  v_user_n  integer;
  v_balance bigint;
  v_cur_end timestamptz;
  v_active  text;
  v_end     timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into c from public.promo_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'invalid_code'; end if;
  if not c.active then raise exception 'inactive'; end if;
  if c.expires_at is not null and now() >= c.expires_at then raise exception 'expired'; end if;
  select count(*) into v_global from public.promo_redemptions where code = c.code;
  if c.max_redemptions is not null and v_global >= c.max_redemptions then raise exception 'limit_reached'; end if;
  select count(*) into v_user_n from public.promo_redemptions where code = c.code and user_id = v_user;
  if v_user_n >= coalesce(c.per_user_limit, 1) then raise exception 'per_user_limit_reached'; end if;

  insert into public.promo_redemptions (code, user_id, kind, value) values (c.code, v_user, c.kind, c.value);

  if c.kind = 'credit' then
    if c.value <= 0 then raise exception 'invalid_code'; end if;
    v_balance := public.coin_credit(v_user, c.value, 'bonus', 'promo', 'promo:' || c.code, null, null);
    return jsonb_build_object('kind', 'credit', 'value', c.value, 'balance', v_balance);
  elsif c.kind = 'proDays' then
    -- a már fizetett szintet nem írjuk felül: annál csak a lejáratot toljuk; Free → Haladó
    select current_period_end into v_cur_end from public.subscriptions where user_id = v_user for update;
    v_active := public.active_tier_for(v_user);
    v_end := (case when v_active <> 'free' then v_cur_end else now() end) + (c.value || ' days')::interval;
    insert into public.subscriptions (user_id, tier, status, current_period_end, source)
      values (v_user, 'pro', 'active', v_end, 'promo')
    on conflict (user_id) do update
      set tier = case when v_active <> 'free' then public.subscriptions.tier else 'pro' end,
          status = 'active', current_period_end = v_end, source = 'promo';
    return jsonb_build_object('kind', 'proDays', 'value', c.value, 'pro_until', v_end);
  else
    return jsonb_build_object('kind', 'percent', 'value', c.value);
  end if;
end; $$;
revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;
comment on column public.promo_codes.value is 'credit: cent-Coin (bónusz) · proDays: nap · percent: %';

-- ═══ kifizetés: CSAK a beváltható megkeresett Coinból, min. 20 Coin, heti 1, €-ban ═
alter table public.payout_requests rename column coins to cents;
alter table public.payout_requests alter column cents type bigint;
alter table public.payout_requests rename column amount_huf to amount_eur_cents;
alter table public.payout_requests alter column amount_eur_cents type bigint;
alter table public.payout_requests add column if not exists currency text not null default 'EUR';

drop function if exists public.request_payout_for(uuid, integer);
create or replace function public.request_payout_for(p_user uuid, p_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_avail bigint; v_amount bigint; v_id uuid; v_balance bigint;
begin
  if p_cents is null or p_cents < public.coin_min_payout_cents() then raise exception 'below_min_payout'; end if;
  perform public.coin_settle(p_user);
  select earned_available_cents into v_avail from public.user_credits where user_id = p_user for update;
  if coalesce(v_avail, 0) < p_cents then raise exception 'insufficient_earned'; end if;
  if exists (select 1 from public.payout_requests where user_id = p_user
              and status <> 'failed' and created_at > now() - interval '7 days') then
    raise exception 'payout_weekly_limit';
  end if;

  v_amount := public.coin_payout_eur_cents(p_cents);
  update public.user_credits set earned_available_cents = earned_available_cents - p_cents, updated_at = now()
    where user_id = p_user;
  insert into public.payout_requests (user_id, cents, amount_eur_cents, currency, status)
    values (p_user, p_cents, v_amount, 'EUR', 'pending') returning id into v_id;
  insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
    values (p_user, -p_cents, 'earned_available', 'payout', 'payout_request', v_id);
  select balance into v_balance from public.user_credits where user_id = p_user;
  return jsonb_build_object('request_id', v_id, 'cents', p_cents, 'amount_eur_cents', v_amount, 'balance', v_balance);
end; $$;
revoke all on function public.request_payout_for(uuid, bigint) from public, anon, authenticated;
grant execute on function public.request_payout_for(uuid, bigint) to service_role;

-- sikertelen kifizetés → vissza a BEVÁLTHATÓ egyenlegre
create or replace function public.resolve_payout(p_request uuid, p_status text, p_provider_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests%rowtype;
begin
  if p_status not in ('processing', 'paid', 'failed') then raise exception 'invalid status'; end if;
  select * into r from public.payout_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if r.status not in ('pending', 'processing') then return; end if; -- idempotens
  update public.payout_requests
     set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), updated_at = now()
   where id = p_request;
  if p_status = 'failed' then
    update public.user_credits set earned_available_cents = earned_available_cents + r.cents, updated_at = now()
      where user_id = r.user_id;
    insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
      values (r.user_id, r.cents, 'earned_available', 'refund', 'payout_failed', r.id);
  end if;
end; $$;
revoke all on function public.resolve_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_payout(uuid, text, text) to service_role;
