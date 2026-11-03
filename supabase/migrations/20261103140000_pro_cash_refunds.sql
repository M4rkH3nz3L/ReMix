-- 🧾 PRO-CASH C0.5 — áruházi visszatérítés a Coin-főkönyvben.
--
-- Ha egy Coin-csomag vásárlását az áruház visszatéríti (RevenueCat: CANCELLATION +
-- cancel_reason CUSTOMER_SUPPORT), a csomag Coinját és bónuszát vissza kell vonni. Ha a
-- vevő már elköltötte, amennyi van, annyi jön le (vásárolt → bónusz → beváltható → függő),
-- a hiányt pedig a fiók `review_required` jelzője rögzíti: ilyenkor kifizetés nem kérhető,
-- amíg kézi ellenőrzés fel nem oldja (PRO-CASH 2.5 csalásfigyelés).

alter table public.user_credits add column if not exists review_required boolean not null default false;
alter table public.user_credits add column if not exists review_reason text;

alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check check (kind in (
  'topup', 'purchase', 'sale', 'refund', 'payout', 'transfer', 'gift', 'promo',
  'subscription', 'addon', 'bonus', 'release', 'expire', 'reversal', 'conversion', 'clawback'
));

create or replace function public.coin_clawback(p_user uuid, p_cents bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.user_credits%rowtype;
  v_left bigint := p_cents;
  v_purch bigint := 0; v_bonus bigint := 0; v_avail bigint := 0; v_pend bigint := 0;
  v_take bigint;
  lot record;
begin
  if p_user is null or p_cents is null or p_cents <= 0 then raise exception 'invalid clawback'; end if;
  insert into public.user_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  perform public.coin_settle(p_user);
  select * into w from public.user_credits where user_id = p_user for update;

  v_purch := least(v_left, w.purchased_cents); v_left := v_left - v_purch;
  for lot in select id, remaining_cents from public.coin_lots
              where user_id = p_user and bucket = 'bonus' and status = 'pending' and remaining_cents > 0
              order by expires_at desc for update loop
    exit when v_left = 0;
    v_take := least(v_left, lot.remaining_cents);
    update public.coin_lots set remaining_cents = remaining_cents - v_take where id = lot.id;
    v_bonus := v_bonus + v_take; v_left := v_left - v_take;
  end loop;
  v_avail := least(v_left, w.earned_available_cents); v_left := v_left - v_avail;
  for lot in select id, remaining_cents from public.coin_lots
              where user_id = p_user and bucket = 'earned' and status = 'pending' and remaining_cents > 0
              order by available_at desc for update loop
    exit when v_left = 0;
    v_take := least(v_left, lot.remaining_cents);
    update public.coin_lots set remaining_cents = remaining_cents - v_take where id = lot.id;
    v_pend := v_pend + v_take; v_left := v_left - v_take;
  end loop;

  update public.user_credits set
    purchased_cents = purchased_cents - v_purch,
    bonus_cents = bonus_cents - v_bonus,
    earned_available_cents = earned_available_cents - v_avail,
    earned_pending_cents = earned_pending_cents - v_pend,
    review_required = review_required or v_left > 0,
    review_reason = case when v_left > 0 then coalesce(p_note, 'refund') || ':unrecovered:' || v_left else review_reason end,
    updated_at = now()
  where user_id = p_user;

  insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note)
  select p_user, -x.amt, x.b, 'clawback', p_note
    from (values (v_purch, 'purchased'), (v_bonus, 'bonus'), (v_avail, 'earned_available'), (v_pend, 'earned_pending')) as x(amt, b)
   where x.amt > 0;

  return jsonb_build_object('recovered_cents', p_cents - v_left, 'unrecovered_cents', v_left);
end; $$;
revoke all on function public.coin_clawback(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.coin_clawback(uuid, bigint, text) to service_role;

-- kifizetés: ellenőrzésre jelölt fióknál zárva
create or replace function public.request_payout_for(p_user uuid, p_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_avail bigint; v_review boolean; v_amount bigint; v_id uuid; v_balance bigint;
begin
  if p_cents is null or p_cents < public.coin_min_payout_cents() then raise exception 'below_min_payout'; end if;
  perform public.coin_settle(p_user);
  select earned_available_cents, review_required into v_avail, v_review
    from public.user_credits where user_id = p_user for update;
  if coalesce(v_review, false) then raise exception 'payout_under_review'; end if;
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

-- a user lássa, ha a fiókja ellenőrzés alatt áll
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
    'next_release_at', v_next,
    'review_required', coalesce(w.review_required, false)
  );
end; $$;
revoke all on function public.my_wallet() from public, anon;
grant execute on function public.my_wallet() to authenticated;
