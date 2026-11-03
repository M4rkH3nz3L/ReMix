-- 🗄️ PRO-CASH 8.6 — a pénzügyi napló megőrzése fióktörlés után (számviteli törvény: 8 év).
--
-- A GDPR-törlés (hard-erase) a fiókot és a személyes adatokat törli, a pénzmozgások naplóját
-- azonban meg kell őrizni. Ezért a fiók törlésekor a pénzügyi sorok NEM törlődnek: a user-
-- azonosító helyére egy felhasználónként egységes, VÉLETLEN álnév kerül (`subject_ref`,
-- „erased:<uuid>”) — a sorok összetartoznak (egy alany), de a személyhez nem köthetők vissza.
-- Érintett: credit_transactions, coin_lots (DAC7), payout_requests (+ eseményei), gift_events,
-- shop_purchases, ad_rewards. Az egyenleg (user_credits) és a tagságok a fiókkal törlődnek.

do $$
declare t record;
begin
  for t in select * from (values
    ('credit_transactions', 'user_id'), ('coin_lots', 'user_id'), ('payout_requests', 'user_id'),
    ('gift_events', 'from_user'), ('gift_events', 'to_user'), ('shop_purchases', 'buyer_id'), ('ad_rewards', 'user_id')
  ) as x(tbl, col) loop
    execute format('alter table public.%I alter column %I drop not null', t.tbl, t.col);
    execute format('alter table public.%I drop constraint if exists %I', t.tbl, t.tbl || '_' || t.col || '_fkey');
    execute format('alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
                   t.tbl, t.tbl || '_' || t.col || '_fkey', t.col);
  end loop;
end $$;

alter table public.credit_transactions add column if not exists subject_ref text;
alter table public.coin_lots add column if not exists subject_ref text;
alter table public.payout_requests add column if not exists subject_ref text;
alter table public.gift_events add column if not exists from_ref text;
alter table public.gift_events add column if not exists to_ref text;
alter table public.shop_purchases add column if not exists buyer_ref text;
alter table public.ad_rewards add column if not exists subject_ref text;

create or replace function public.pseudonymize_ledger_on_user_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ref text := 'erased:' || gen_random_uuid();
begin
  update public.credit_transactions set subject_ref = v_ref where user_id = old.id;
  update public.coin_lots set subject_ref = v_ref where user_id = old.id;
  update public.payout_requests set subject_ref = v_ref where user_id = old.id;
  update public.gift_events set from_ref = v_ref where from_user = old.id;
  update public.gift_events set to_ref = v_ref where to_user = old.id;
  update public.shop_purchases set buyer_ref = v_ref where buyer_id = old.id;
  update public.ad_rewards set subject_ref = v_ref where user_id = old.id;
  return old;
end; $$;
drop trigger if exists on_auth_user_deleted_pseudonymize_ledger on auth.users;
create trigger on_auth_user_deleted_pseudonymize_ledger before delete on auth.users
  for each row execute function public.pseudonymize_ledger_on_user_delete();
