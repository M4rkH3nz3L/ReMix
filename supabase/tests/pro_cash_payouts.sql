-- 💸 PRO-CASH C3.3 + C3.4: kifizetés KYC-vel, állapotgéppel, csalásszűréssel és kézi jóváhagyással.
-- Valódi szerepkörrel (authenticated + RLS), tranzakcióban; semmit nem hagy hátra. Futtatás: npm run test:rls
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated, anon, service_role;
create function pg_temp.act(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.note(n text, ok boolean, d text default '') returns void language sql as $$
  insert into t_results values (n, ok, d);
$$;
create function pg_temp.raises(n text, sql text, expect text) returns void language plpgsql as $$
begin
  execute sql;
  perform pg_temp.note(n, false, 'nem dobott hibát');
exception when others then
  perform pg_temp.note(n, sqlerrm ilike '%' || expect || '%', sqlerrm);
end $$;
-- megkeresett, már feloldott Coin a fizetőtől (a valódi coin_credit úton, a tartást visszadátumozva)
create function pg_temp.earn(creator uuid, payer uuid, cents bigint) returns void language plpgsql as $$
begin
  perform public.coin_credit(creator, cents, 'earned', 'gift', 'teszt', gen_random_uuid(), payer);
  update public.coin_lots set available_at = now() - interval '1 minute', created_at = now() - interval '2 days'
   where user_id = creator and payer_id = payer and status = 'pending';
  perform public.coin_settle(creator);
end $$;
create function pg_temp.req_status(uid uuid) returns text language sql as $$
  select status from public.payout_requests where user_id = uid order by created_at desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- K = alkotó, P1–P3 = régi fizetők, N = friss fiók, A = admin, M = moderátor, R/S = gyűrű, D = közös eszköz
insert into auth.users (id, instance_id, aud, role, email, created_at) values
  ('a3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_k@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_p1@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_p2@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_p3@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_n@t.test', now()),
  ('a3000000-0000-0000-0000-0000000000ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_a@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_m@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_r@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_s@t.test', now() - interval '1 year'),
  ('a3000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po_d@t.test', now() - interval '1 year');
insert into public.user_roles (user_id, role) values
  ('a3000000-0000-0000-0000-0000000000ad', 'admin'), ('a3000000-0000-0000-0000-0000000000a0', 'moderator')
on conflict (user_id) do update set role = excluded.role;

-- ═══ KYC ═══════════════════════════════════════════════════════════════════════
select pg_temp.earn('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 1500);
select pg_temp.earn('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002', 1500);
select pg_temp.earn('a3000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000003', 1500);
select pg_temp.raises('C3.3 célszámla nélkül nincs kifizetés', $$select public.request_payout_for('a3000000-0000-0000-0000-00000000000a', 2000)$$, 'no_payout_account');
select pg_temp.act('a3000000-0000-0000-0000-00000000000a');
select public.set_payout_account('paypal', 'k@t.test');
select pg_temp.raises('C3.3 a user nem jelölheti magát ellenőrzöttnek', $$select public.set_kyc_status('a3000000-0000-0000-0000-00000000000a', 'paypal', 'verified')$$, 'permission denied');
select pg_temp.admin();
select pg_temp.raises('C3.3 KYC nélkül nincs kifizetés', $$select public.request_payout_for('a3000000-0000-0000-0000-00000000000a', 2000)$$, 'kyc_required');
select public.set_kyc_status('a3000000-0000-0000-0000-00000000000a', 'paypal', 'verified');

-- ═══ tiszta kérés: automatikusan jóváhagyva, az állapotgépen végig ═══════════════
select pg_temp.note('C3.4 három független, régi fizető → nincs kockázati jelző',
  cardinality(public.payout_risk_flags('a3000000-0000-0000-0000-00000000000a')) = 0);
create temp table t_req as select public.request_payout_for('a3000000-0000-0000-0000-00000000000a', 2000) as r;
grant all on t_req to authenticated;
select pg_temp.note('C3.3 a tiszta kérés automatikusan jóváhagyva (approved)', (select r ->> 'status' = 'approved' from t_req));
select pg_temp.raises('C3.3 jóváhagyottból nem ugorhat fizetettre (processing kell)',
  $$select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'paid')$$, 'invalid_transition');
select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'processing', 'batch-1');
select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'paid', 'batch-1');
select pg_temp.note('C3.3 processing → paid, a napló minden lépést rögzít',
  (select count(*) = 3 from public.payout_events where request_id = (select (r ->> 'request_id')::uuid from t_req)));
select pg_temp.raises('C3.3 a kifizetett nem bukhat el utólag', $$select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'failed')$$, 'invalid_transition');
select pg_temp.note('C3.3 fizetett: a beváltható 45 − 20 = 25 Coin',
  (select earned_available_cents = 2500 from public.user_credits where user_id = 'a3000000-0000-0000-0000-00000000000a'));

-- sikertelen utalás: pontosan egyszer írjuk vissza
update public.payout_requests set created_at = now() - interval '8 days' where user_id = 'a3000000-0000-0000-0000-00000000000a';
delete from t_req;
insert into t_req select public.request_payout_for('a3000000-0000-0000-0000-00000000000a', 2000);
select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'processing');
select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'failed', null, 'paypal: receiver unconfirmed');
select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'failed');
select pg_temp.note('C3.3 a sikertelen utalás egyszer íródik vissza (ismételt hívásra sem kétszer)',
  (select earned_available_cents = 2500 from public.user_credits where user_id = 'a3000000-0000-0000-0000-00000000000a'));
select pg_temp.act('a3000000-0000-0000-0000-00000000000a');
select pg_temp.raises('C3.3 a user nem léptetheti a saját kérését', $$select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'paid')$$, 'permission denied');
select pg_temp.note('C3.3 a user látja a saját kérésének eseménynaplóját',
  (select count(*) >= 3 from public.payout_events where request_id = (select (r ->> 'request_id')::uuid from t_req)));
select public.set_payout_account('paypal', 'uj-cim@t.test');
select pg_temp.admin();
select pg_temp.note('C3.3 új célszámla → a KYC-t újra kell kérni',
  (select kyc_status = 'none' from public.payout_accounts where user_id = 'a3000000-0000-0000-0000-00000000000a'));

-- ═══ C3.4 csalásszűrés ════════════════════════════════════════════════════════
select pg_temp.earn('a3000000-0000-0000-0000-0000000000b1', 'a3000000-0000-0000-0000-0000000000b2', 3000);
select pg_temp.earn('a3000000-0000-0000-0000-0000000000b2', 'a3000000-0000-0000-0000-0000000000b1', 3000);
select pg_temp.note('C3.4 körbeajándékozás (R ↔ S) → ring', 'ring' = any(public.payout_risk_flags('a3000000-0000-0000-0000-0000000000b1')));
select pg_temp.note('C3.4 egyetlen fizető adja a bevételt → concentration', 'concentration' = any(public.payout_risk_flags('a3000000-0000-0000-0000-0000000000b1')));
select pg_temp.earn('a3000000-0000-0000-0000-0000000000d1', 'a3000000-0000-0000-0000-00000000000e', 2500);
select pg_temp.note('C3.4 a bevétel friss fióktól → new_accounts', 'new_accounts' = any(public.payout_risk_flags('a3000000-0000-0000-0000-0000000000d1')));
insert into public.user_devices (user_id, fingerprint) values
  ('a3000000-0000-0000-0000-0000000000d1', 'fp-shared'), ('a3000000-0000-0000-0000-00000000000e', 'fp-shared');
select pg_temp.note('C3.4 fizető és alkotó ugyanazon az eszközön → shared_device', 'shared_device' = any(public.payout_risk_flags('a3000000-0000-0000-0000-0000000000d1')));

select public.set_kyc_status('a3000000-0000-0000-0000-0000000000b1', 'paypal', 'verified');
update public.payout_accounts set email = 'r@t.test' where user_id = 'a3000000-0000-0000-0000-0000000000b1';
delete from t_req;
insert into t_req select public.request_payout_for('a3000000-0000-0000-0000-0000000000b1', 2000);
select pg_temp.note('C3.4 gyanús kérés → under_review, a jelzőkkel',
  (select r ->> 'status' = 'under_review' and r -> 'risk_flags' ? 'ring' from t_req));
select pg_temp.raises('C3.4 ellenőrzés alatt nem utalható', $$select public.payout_transition((select (r ->> 'request_id')::uuid from t_req), 'processing')$$, 'invalid_transition');

-- kézi ellenőrzés
select pg_temp.act('a3000000-0000-0000-0000-0000000000a0');
select pg_temp.raises('C3.4 jog nélkül (moderátor) nem hagyhat jóvá', $$select public.review_payout((select (r ->> 'request_id')::uuid from t_req), true)$$, 'forbidden');
select pg_temp.raises('C3.4 jog nélkül a várólista sem látszik', $$select * from public.payouts_under_review()$$, 'forbidden');
select pg_temp.admin();
select pg_temp.act('a3000000-0000-0000-0000-0000000000ad');
select pg_temp.note('C3.4 az admin látja a várólistát', exists (select 1 from public.payouts_under_review() where user_id = 'a3000000-0000-0000-0000-0000000000b1'));
select public.review_payout((select (r ->> 'request_id')::uuid from t_req), false, 'körbeajándékozás');
select pg_temp.admin();
select pg_temp.note('C3.4 elutasítva: a Coin visszakerül a beválthatóra, az ellenőrző rögzítve',
  (select earned_available_cents = 3000 from public.user_credits where user_id = 'a3000000-0000-0000-0000-0000000000b1')
  and (select reviewed_by = 'a3000000-0000-0000-0000-0000000000ad' and status = 'rejected' from public.payout_requests
        where id = (select (r ->> 'request_id')::uuid from t_req)));

-- saját kérését az admin sem hagyhatja jóvá
select pg_temp.earn('a3000000-0000-0000-0000-0000000000ad', 'a3000000-0000-0000-0000-0000000000b2', 3000);
select public.set_kyc_status('a3000000-0000-0000-0000-0000000000ad', 'paypal', 'verified');
update public.payout_accounts set email = 'ad@t.test' where user_id = 'a3000000-0000-0000-0000-0000000000ad';
delete from t_req;
insert into t_req select public.request_payout_for('a3000000-0000-0000-0000-0000000000ad', 2000);
select pg_temp.act('a3000000-0000-0000-0000-0000000000ad');
select pg_temp.raises('C3.4 a saját kifizetését senki nem hagyhatja jóvá', $$select public.review_payout((select (r ->> 'request_id')::uuid from t_req), true)$$, 'cannot_review_own');
select pg_temp.admin();

select pg_temp.note('invariáns: a napló összege = az egyenleg',
  not exists (select 1 from public.user_credits u where u.user_id::text like 'a3000000-%' and u.balance <>
    coalesce((select sum(delta_cents) from public.credit_transactions t where t.user_id = u.user_id), 0)));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH kifizetés-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
