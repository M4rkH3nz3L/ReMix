-- 🤝 PRO-CASH C3.6 (maradék) — ajánlói jutalék az ÁRUHÁZI (App Store / Play) előfizetés után is.
--
-- A jutalék alapja áruházi vásárlásnál a szint Coin-ára (a webes legolcsóbb út), nem a bruttó
-- áruházi ár — így a jutalék csatornától független. A logika egy helyen: `referral_reward_for`,
-- ezt hívja a Coin-terhelés triggere és a RevenueCat webhook is.

create or replace function public.referral_reward_for(p_user uuid, p_cents bigint, p_months integer, p_ref uuid, p_at timestamptz default now())
returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.referrals%rowtype; v_idx integer; v_reward bigint;
begin
  select * into r from public.referrals where referred_id = p_user for update;
  if not found or p_cents is null or p_cents <= 0 then return 0; end if;
  if r.first_paid_at is null then
    update public.referrals set first_paid_at = p_at where referred_id = p_user;
    r.first_paid_at := p_at;
  end if;
  v_idx := (extract(year from age(p_at, r.first_paid_at)) * 12 + extract(month from age(p_at, r.first_paid_at)))::int;
  v_reward := floor(p_cents * public.referral_rate(v_idx, greatest(coalesce(p_months, 1), 1)))::bigint;
  if v_reward > 0 then
    perform public.coin_credit(r.referrer_id, v_reward, 'earned', 'referral', 'referral:' || p_months || 'mo', p_ref, p_user);
    update public.referrals set earned_cents = earned_cents + v_reward where referred_id = p_user;
  end if;
  return v_reward;
end; $$;
revoke all on function public.referral_reward_for(uuid, bigint, integer, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.referral_on_subscription_tx()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.referral_reward_for(new.user_id, -new.delta_cents,
    case when coalesce(new.note, '') like '%:year:%' then 12 else 1 end, new.id, new.created_at);
  return new;
end; $$;

-- áruházi fizetés (RevenueCat INITIAL_PURCHASE / RENEWAL) — a worker hívja
create or replace function public.referral_on_store_payment(p_user uuid, p_tier text, p_period text)
returns bigint language sql security definer set search_path = '' as $$
  select public.referral_reward_for(p_user,
    public.tier_price_cents(p_tier) * (case when p_period = 'annual' then 10 else 1 end),
    case when p_period = 'annual' then 12 else 1 end, null, now());
$$;
revoke all on function public.referral_on_store_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.referral_on_store_payment(uuid, text, text) to service_role;
