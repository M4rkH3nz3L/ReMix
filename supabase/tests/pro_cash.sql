-- 💠 PRO-CASH: előfizetés, Coin-főkönyv és kifizetés valódi szerepkörrel (authenticated + RLS).
-- Tranzakcióban fut, semmit nem hagy hátra. Futtatás: npm run test:rls
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated, anon, service_role;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pc_alice@t.test', '{"full_name":"Alice"}'),
  ('b1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pc_bob@t.test', '{"full_name":"Bob"}'),
  ('c1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pc_carol@t.test', '{"full_name":"Carol"}');
update public.profiles set username = 'pc_alice' where id = 'a1000000-0000-0000-0000-000000000001';
update public.profiles set username = 'pc_bob' where id = 'b1000000-0000-0000-0000-000000000002';
update public.profiles set username = 'pc_carol' where id = 'c1000000-0000-0000-0000-000000000003';

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
create function pg_temp.denied(n text, sql text) returns void language plpgsql as $$
declare c int;
begin
  execute sql;
  get diagnostics c = row_count;
  perform pg_temp.note(n, c = 0, format('%s sor változott', c));
exception when others then
  perform pg_temp.note(n, true, sqlerrm);
end $$;
-- hibát VÁR, adott szöveggel
create function pg_temp.raises(n text, sql text, expect text) returns void language plpgsql as $$
begin
  execute sql;
  perform pg_temp.note(n, false, 'nem dobott hibát');
exception when others then
  perform pg_temp.note(n, sqlerrm ilike '%' || expect || '%', sqlerrm);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ═══ C0.1 — szintek ═══════════════════════════════════════════════════════════
select pg_temp.note('C0.1 új user Free-sort kap', (select tier = 'free' and seats = 1 from public.subscriptions where user_id = 'a1000000-0000-0000-0000-000000000001'));

update public.subscriptions set tier = 'basic', current_period_end = now() + interval '10 days' where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 az Amatőr (basic) beírható', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'basic');
update public.subscriptions set tier = 'ultra' where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 a Profi (ultra) beírható', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'ultra');
select pg_temp.raises('C0.1 Vállalati 1 fővel nem lehet', $$update public.subscriptions set tier = 'business', seats = 1 where user_id = 'a1000000-0000-0000-0000-000000000001'$$, 'seats_check');
update public.subscriptions set tier = 'business', seats = 3 where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 Vállalati 3 fővel beírható', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'business');
select pg_temp.raises('C0.1 ismeretlen szint nem írható', $$update public.subscriptions set tier = 'gold' where user_id = 'a1000000-0000-0000-0000-000000000001'$$, 'tier_check');
select pg_temp.raises('C0.1 a régi revenuecat-forrás már nem írható', $$update public.subscriptions set source = 'revenuecat' where user_id = 'a1000000-0000-0000-0000-000000000001'$$, 'source_check');

update public.subscriptions set current_period_end = now() - interval '1 second' where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 lejárt periódus → free', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'free');
update public.subscriptions set current_period_end = null where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 lejárat nélküli sor → free (fail-closed)', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'free');
update public.subscriptions set current_period_end = now() + interval '1 day', status = 'canceled' where user_id = 'a1000000-0000-0000-0000-000000000001';
select pg_temp.note('C0.1 lemondott státusz → free', public.active_tier_for('a1000000-0000-0000-0000-000000000001') = 'free');
update public.subscriptions set status = 'active' where user_id = 'a1000000-0000-0000-0000-000000000001';

select pg_temp.act('b1000000-0000-0000-0000-000000000002');
select pg_temp.denied('C0.1 a kliens nem írhatja a saját szintjét', $$update public.subscriptions set tier = 'ultra' where user_id = 'b1000000-0000-0000-0000-000000000002'$$);
select pg_temp.denied('C0.1 a kliens nem szúrhat be előfizetést', $$insert into public.subscriptions (user_id, tier) values ('c1000000-0000-0000-0000-000000000003', 'pro')$$);
select pg_temp.raises('C0.1 a kliens nem hívhatja az active_tier_for-t', $$select public.active_tier_for('a1000000-0000-0000-0000-000000000001')$$, 'permission denied');
select pg_temp.admin();

-- ═══ C0.2 — egy forrás a tárhely-kerethez ════════════════════════════════════
select pg_temp.note('C0.2 Free: csak a feed-poszt-keret (1 GiB)', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(1));
update public.subscriptions set tier = 'basic', seats = 1, current_period_end = now() + interval '30 days' where user_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.note('C0.2 Amatőr: 3 GB', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(3));
update public.subscriptions set tier = 'pro' where user_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.note('C0.2 Haladó: 25 GB', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(25));
update public.subscriptions set tier = 'ultra' where user_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.note('C0.2 Profi: 100 GB', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(100));
update public.subscriptions set tier = 'business', seats = 5 where user_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.note('C0.2 Vállalati 5 fő: 500 GB közös keret', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(500));
update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = 'b1000000-0000-0000-0000-000000000002';
select pg_temp.note('C0.2 lejárt előfizetés: vissza a Free-keretre', (public.storage_usage_for('b1000000-0000-0000-0000-000000000002') ->> 'base_bytes')::bigint = public.gib(1));

-- ═══ C0.3 — Coin-főkönyv: alegyenlegek, költési sorrend, tartás ═════════════
-- A = alkotó (alice), B = bob, C = vevő (carol)
create temp table t_ids (k text primary key, v uuid) on commit drop;
grant all on t_ids to authenticated, anon, service_role;
update public.subscriptions set tier = 'free', seats = 1, current_period_end = null where user_id in
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
select public.grant_coins('c1000000-0000-0000-0000-000000000003', 20000, 'purchased', 'topup', 'teszt');
select public.grant_coins('c1000000-0000-0000-0000-000000000003', 300, 'bonus', 'bonus', 'teszt');
insert into public.shop_items (id, seller_id, title, kind, price_cents, status) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Sablon', 'template', 500, 'published');

select pg_temp.act('c1000000-0000-0000-0000-000000000003');
select pg_temp.denied('C0.3 a kliens nem írhatja az alegyenlegét', $$update public.user_credits set earned_available_cents = 999999 where user_id = 'c1000000-0000-0000-0000-000000000003'$$);
select pg_temp.raises('C0.3 a kliens nem hívhat jóváírást', $$select public.coin_credit('c1000000-0000-0000-0000-000000000003', 100, 'earned', 'sale')$$, 'permission denied');
select pg_temp.raises('C0.3 a kliens nem hívhat terhelést más nevében', $$select public.coin_debit('a1000000-0000-0000-0000-000000000001', 1, 'purchase')$$, 'permission denied');
select pg_temp.raises('C0.3 a kliens nem írhat jóvá magának (grant_coins)', $$select public.grant_coins('c1000000-0000-0000-0000-000000000003', 100)$$, 'permission denied');
select pg_temp.raises('C0.3 a közvetlen koin-küldés megszűnt', $$select public.send_credits('pc_alice', 1)$$, 'does not exist');
select public.purchase_shop_item('e1000000-0000-0000-0000-000000000001');
select pg_temp.note('C0.3 költési sorrend: előbb a bónusz (300), aztán a vásárolt (200)',
  (select bonus_cents = 0 and purchased_cents = 19800 from public.user_credits where user_id = 'c1000000-0000-0000-0000-000000000003'));
select pg_temp.admin();
select pg_temp.note('C0.3 bolt 70/30: az eladó 350-et kap, TARTÁSBAN',
  (select earned_pending_cents = 350 and earned_available_cents = 0 from public.user_credits where user_id = 'a1000000-0000-0000-0000-000000000001'));
select pg_temp.note('C0.3 a tartás 30 nap',
  (select available_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
     from public.coin_lots where user_id = 'a1000000-0000-0000-0000-000000000001' and kind = 'sale'));

-- ajándék 80/20
select pg_temp.act('c1000000-0000-0000-0000-000000000003');
select pg_temp.raises('C3.2 magadnak nem küldhetsz ajándékot', $$select public.send_gift('pc_carol', 'rose')$$, 'cannot_send_to_self');
insert into t_ids select 'gift1', null;
select public.send_gift('pc_alice', 'universe');
select pg_temp.admin();
update t_ids set v = (select id from public.gift_events where gift_id = 'universe' and to_user = 'a1000000-0000-0000-0000-000000000001') where k = 'gift1';
select pg_temp.note('C3.2 ajándék 80/20: 100 Coin-ból 80 az alkotóé (tartásban)',
  (select earned_pending_cents = 350 + 8000 from public.user_credits where user_id = 'a1000000-0000-0000-0000-000000000001'));
select pg_temp.note('C3.2 a vevőtől a teljes ár ment le', (select purchased_cents = 9800 from public.user_credits where user_id = 'c1000000-0000-0000-0000-000000000003'));

-- kifizetés: függőből nem, a tartás után igen
select pg_temp.raises('C0.3 tartásban lévő Coin nem váltható', $$select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 2000)$$, 'insufficient_earned');
update public.coin_lots set available_at = now() - interval '1 minute' where user_id = 'a1000000-0000-0000-0000-000000000001' and kind = 'sale';
select pg_temp.act('a1000000-0000-0000-0000-000000000001');
select pg_temp.note('C0.3 a tartás leteltével beválthatóvá válik (my_wallet)',
  (select (w ->> 'earned_available')::bigint = 350 and (w ->> 'earned_pending')::bigint = 8000 and (w ->> 'next_release_at') is not null
     from (select public.my_wallet() as w) x));
select pg_temp.admin();
update public.coin_lots set available_at = now() - interval '1 minute' where user_id = 'a1000000-0000-0000-0000-000000000001' and kind = 'gift';
select pg_temp.note('C0.3 az ütemező (coin_release_due) is felold', public.coin_release_due() >= 1);
select pg_temp.note('C0.3 a feloldás után 83,50 Coin beváltható',
  (select earned_available_cents = 8350 and earned_pending_cents = 0 from public.user_credits where user_id = 'a1000000-0000-0000-0000-000000000001'));
select public.grant_coins('a1000000-0000-0000-0000-000000000001', 50000, 'purchased', 'topup', 'teszt');
select pg_temp.raises('C0.3 a VÁSÁROLT Coin nem váltható (csak a megkeresett)', $$select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 9000)$$, 'insufficient_earned');
select pg_temp.raises('2.5 a minimum 20 Coin', $$select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 1999)$$, 'below_min_payout');
select pg_temp.note('2.5 20 Coin kifizetése: 60 €',
  (select (r ->> 'amount_eur_cents')::bigint = 6000 from (select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 2000) as r) x));
select pg_temp.raises('2.5 hetente legfeljebb 1 kifizetés', $$select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 2000)$$, 'payout_weekly_limit');
select public.resolve_payout((select id from public.payout_requests where user_id = 'a1000000-0000-0000-0000-000000000001'), 'failed');
select pg_temp.note('2.5 sikertelen kifizetés: vissza a beválthatóra',
  (select earned_available_cents = 8350 from public.user_credits where user_id = 'a1000000-0000-0000-0000-000000000001'));
select pg_temp.act('a1000000-0000-0000-0000-000000000001');
select pg_temp.raises('2.5 a kliens nem kérhet kifizetést közvetlenül', $$select public.request_payout_for('a1000000-0000-0000-0000-000000000001', 2000)$$, 'permission denied');
select pg_temp.admin();

-- visszaterhelés (C3.1): függő tétel visszavonása
select pg_temp.act('c1000000-0000-0000-0000-000000000003');
select public.send_gift('pc_bob', 'castle');
select pg_temp.admin();
select pg_temp.note('C3.1 visszaterhelés: a függő 40 Coin visszavonva',
  (select (r ->> 'reversed_cents')::bigint = 4000 and (r ->> 'unrecovered_cents')::bigint = 0
     from (select public.coin_reverse_earning((select id from public.gift_events where gift_id = 'castle')) as r) x));
select pg_temp.note('C3.1 a visszavonás után Bob függő egyenlege 0',
  (select earned_pending_cents = 0 from public.user_credits where user_id = 'b1000000-0000-0000-0000-000000000002'));

-- bónusz-lejárat
select public.grant_coins('b1000000-0000-0000-0000-000000000002', 700, 'bonus', 'promo', 'teszt');
update public.coin_lots set expires_at = now() - interval '1 second' where user_id = 'b1000000-0000-0000-0000-000000000002' and bucket = 'bonus';
select public.coin_release_due();
select pg_temp.note('C0.3 a bónusz 12 hónap után lejár',
  (select bonus_cents = 0 from public.user_credits where user_id = 'b1000000-0000-0000-0000-000000000002'));

-- előfizetés Coinból
select public.grant_coins('b1000000-0000-0000-0000-000000000002', 2500, 'purchased', 'topup', 'teszt');
select pg_temp.act('b1000000-0000-0000-0000-000000000002');
select public.subscribe_with_coins('basic', 1);
select pg_temp.note('C0.4 Amatőr havidíj 2 Coin', (select purchased_cents = 2300 from public.user_credits where user_id = 'b1000000-0000-0000-0000-000000000002'));
select public.subscribe_with_coins('basic', 12);
select pg_temp.note('C0.4 éves díj = 10 havi (20 Coin), a lejárat 12 hónappal tolódik',
  (select purchased_cents = 300 from public.user_credits where user_id = 'b1000000-0000-0000-0000-000000000002')
  and (select current_period_end > now() + interval '12 months' from public.subscriptions where user_id = 'b1000000-0000-0000-0000-000000000002'));
select pg_temp.raises('C0.4 kevés Coin: nem megy mínuszba', $$select public.subscribe_with_coins('basic', 12)$$, 'insufficient_credits');
select pg_temp.raises('C0.4 szintváltás a C1.1-ig nem engedett', $$select public.subscribe_with_coins('pro', 1)$$, 'tier_change_not_supported');
select pg_temp.raises('C0.4 Vállalati 1 fővel nem vehető', $$select public.subscribe_with_coins('business', 1, 1)$$, 'invalid seats');
select pg_temp.admin();
select pg_temp.note('C0.4 az előfizetés aktív, forrás: coins',
  (select tier = 'basic' and source = 'coins' from public.subscriptions where user_id = 'b1000000-0000-0000-0000-000000000002'));

-- invariánsok: a tételek összege = az alegyenleg, egyik sem negatív
select pg_temp.note('C0.3 invariáns: bónusz-tételek = bónusz-egyenleg (minden tesztfiók)',
  not exists (select 1 from public.user_credits u where u.user_id::text like '_1000000-%' and u.bonus_cents <>
    coalesce((select sum(remaining_cents) from public.coin_lots l where l.user_id = u.user_id and l.bucket = 'bonus' and l.status = 'pending'), 0)));
select pg_temp.note('C0.3 invariáns: függő tételek = függő egyenleg (minden tesztfiók)',
  not exists (select 1 from public.user_credits u where u.user_id::text like '_1000000-%' and u.earned_pending_cents <>
    coalesce((select sum(remaining_cents) from public.coin_lots l where l.user_id = u.user_id and l.bucket = 'earned' and l.status = 'pending'), 0)));
select pg_temp.note('C0.3 invariáns: a napló összege = az egyenleg (minden tesztfiók)',
  not exists (select 1 from public.user_credits u where u.user_id::text like '_1000000-%' and u.balance <>
    coalesce((select sum(delta_cents) from public.credit_transactions t where t.user_id = u.user_id), 0)));

-- ═══ eredmény ═════════════════════════════════════════════════════════════════
select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
