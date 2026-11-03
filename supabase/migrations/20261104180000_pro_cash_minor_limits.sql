-- 🧒 PRO-CASH 8.5 / D9 — kiskorúak: havi költési limit és kifizetés-tilalom.
--
-- 18 év alatt (a profil születési dátuma szerint) a Coin-költés naptári hónaponként legfeljebb
-- 10 Coin (vásárlás, ajándék, előfizetés, bővítés), és kifizetés NEM kérhető (a kiskorú alkotó a
-- 2. fázisban szülői fiókon át). Ismeretlen születési dátumnál nincs korlát (a regisztráció
-- kötelezően bekéri; a 13 év alatti fiók eleve nem jöhet létre).
-- A korlát a napló BEFORE INSERT triggerében van, így minden költési út (coin_debit) egy helyen
-- fogva — a túllépés az egész műveletet visszagördíti.

create or replace function public.minor_monthly_limit_cents()
returns bigint language sql immutable set search_path = '' as $$ select 1000::bigint; $$;

create or replace function public.is_minor(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select birthday > (current_date - interval '18 years') from public.profiles where id = p_user), false);
$$;

create or replace function public.credit_tx_minor_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_spent bigint;
begin
  if new.user_id is null or not public.is_minor(new.user_id) then
    return new;
  end if;
  select coalesce(-sum(delta_cents), 0) into v_spent from public.credit_transactions
   where user_id = new.user_id and kind in ('purchase', 'gift', 'subscription', 'addon') and delta_cents < 0
     and created_at >= date_trunc('month', now());
  if v_spent - new.delta_cents > public.minor_monthly_limit_cents() then
    raise exception 'minor_monthly_limit';
  end if;
  return new;
end; $$;
drop trigger if exists credit_tx_minor_limit on public.credit_transactions;
create trigger credit_tx_minor_limit before insert on public.credit_transactions
  for each row when (new.delta_cents < 0 and new.kind in ('purchase', 'gift', 'subscription', 'addon'))
  execute function public.credit_tx_minor_limit();

create or replace function public.payout_minor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.is_minor(new.user_id) then
    raise exception 'minor_no_payout';
  end if;
  return new;
end; $$;
drop trigger if exists payout_minor_guard on public.payout_requests;
create trigger payout_minor_guard before insert on public.payout_requests
  for each row execute function public.payout_minor_guard();
