-- 📊 PRO-CASH C3.5 — bevételi panel, éves kimutatás, DAC7-export (PRO-CASH 6.3, 8.4).
--
-- A bevétel forrása a megkeresett tételek (`coin_lots`, bucket = earned) — eladás, ajándék,
-- remix-jutalék, ajánló, alkotói alap —, a visszavontak nélkül. Euróban a beváltási áron
-- (1 megkeresett Coin = 3 €) számolunk: ez az alkotónak fizetett ellenérték (DAC7).
-- DAC7 (8.4): a platform évente jelenti az eladók bevételét negyedévenként és darabszámmal;
-- kivétel, akinek 30-nál kevesebb eladása ÉS 2000 € alatti bevétele van.

-- a saját bevételem havonta és forrásonként (a panelhez)
create or replace function public.my_earnings(p_months integer default 12)
returns table (month text, kind text, cents bigint, items bigint)
language sql stable security definer set search_path = '' as $$
  select to_char(date_trunc('month', l.created_at), 'YYYY-MM'), l.kind, sum(l.amount_cents)::bigint, count(*)
    from public.coin_lots l
   where l.user_id = auth.uid() and l.bucket = 'earned' and l.status <> 'reversed'
     and l.created_at >= date_trunc('month', now()) - make_interval(months => greatest(coalesce(p_months, 12), 1) - 1)
   group by 1, 2 order by 1 desc, 2;
$$;
revoke all on function public.my_earnings(integer) from public, anon;
grant execute on function public.my_earnings(integer) to authenticated;

-- éves kimutatás (a user adózik — PRO-CASH 2.5): bevétel forrásonként + kifizetések
create or replace function public.earnings_statement_for(p_user uuid, p_year integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'year', p_year,
    'by_kind', coalesce((select jsonb_object_agg(kind, cents) from (
        select kind, sum(amount_cents)::bigint cents from public.coin_lots
         where user_id = p_user and bucket = 'earned' and status <> 'reversed'
           and extract(year from created_at) = p_year group by kind) k), '{}'::jsonb),
    'earned_cents', coalesce((select sum(amount_cents) from public.coin_lots
         where user_id = p_user and bucket = 'earned' and status <> 'reversed' and extract(year from created_at) = p_year), 0),
    'transactions', coalesce((select count(*) from public.coin_lots
         where user_id = p_user and bucket = 'earned' and status <> 'reversed' and extract(year from created_at) = p_year), 0),
    'paid_out_eur_cents', coalesce((select sum(amount_eur_cents) from public.payout_requests
         where user_id = p_user and status = 'paid' and extract(year from updated_at) = p_year), 0),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('date', updated_at::date, 'eur_cents', amount_eur_cents, 'provider', provider) order by updated_at)
         from public.payout_requests where user_id = p_user and status = 'paid' and extract(year from updated_at) = p_year), '[]'::jsonb)
  );
$$;
revoke all on function public.earnings_statement_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.earnings_statement_for(uuid, integer) to service_role;

create or replace function public.my_earnings_statement(p_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return public.earnings_statement_for(auth.uid(), p_year);
end; $$;
revoke all on function public.my_earnings_statement(integer) from public, anon;
grant execute on function public.my_earnings_statement(integer) to authenticated;

create or replace function public.dac7_min_transactions()
returns integer language sql immutable set search_path = '' as $$ select 30; $$;
create or replace function public.dac7_min_eur_cents()
returns bigint language sql immutable set search_path = '' as $$ select 200000::bigint; $$;

-- DAC7: eladónként a negyedéves ellenérték (euró-cent) és tranzakciószám; a KYC-azonosító a
-- partnernél (account_ref) — a személyes adatokat a partner exportjából párosítjuk (8.6)
create or replace function public.dac7_report(p_year integer)
returns table (user_id uuid, username text, provider text, account_ref text, kyc_status text,
               q1_eur_cents bigint, q2_eur_cents bigint, q3_eur_cents bigint, q4_eur_cents bigint,
               q1_tx bigint, q2_tx bigint, q3_tx bigint, q4_tx bigint,
               total_eur_cents bigint, total_tx bigint, reportable boolean)
language sql stable security definer set search_path = '' as $$
  with t as (
    select l.user_id, extract(quarter from l.created_at)::int q, public.coin_payout_eur_cents(l.amount_cents) eur
      from public.coin_lots l
     where l.bucket = 'earned' and l.status <> 'reversed' and extract(year from l.created_at) = p_year
       and l.kind in ('sale', 'gift', 'commission')   -- személyes szolgáltatás/eladás ellenértéke
  ), a as (
    select t.user_id,
           sum(eur) filter (where q = 1) q1e, sum(eur) filter (where q = 2) q2e,
           sum(eur) filter (where q = 3) q3e, sum(eur) filter (where q = 4) q4e,
           count(*) filter (where q = 1) q1n, count(*) filter (where q = 2) q2n,
           count(*) filter (where q = 3) q3n, count(*) filter (where q = 4) q4n,
           sum(eur) tot, count(*) n
      from t group by t.user_id
  )
  select a.user_id, p.username, pa.provider, pa.account_ref, coalesce(pa.kyc_status, 'none'),
         coalesce(q1e, 0)::bigint, coalesce(q2e, 0)::bigint, coalesce(q3e, 0)::bigint, coalesce(q4e, 0)::bigint,
         q1n, q2n, q3n, q4n, tot::bigint, n,
         not (n < public.dac7_min_transactions() and tot < public.dac7_min_eur_cents())
    from a left join public.profiles p on p.id = a.user_id left join public.payout_accounts pa on pa.user_id = a.user_id
   order by a.user_id;
$$;
revoke all on function public.dac7_report(integer) from public, anon, authenticated;
grant execute on function public.dac7_report(integer) to service_role;
