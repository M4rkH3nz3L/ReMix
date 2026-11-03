-- 🔁 PRO-CASH C1.1–C1.3: szintváltás jóváírással, add-on, megújítás és értesítés Coinból.
-- Egy tranzakció → a now() végig ugyanaz; az időt a periódus-határok eltolásával és a
-- p_now paraméterrel injektáljuk. Semmit nem hagy hátra. Futtatás: npm run test:rls
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated, anon, service_role;
insert into auth.users (id, instance_id, aud, role, email) values
  ('a2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cy1@t.test'),
  ('b2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cy2@t.test'),
  ('c2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cy3@t.test'),
  ('d2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'cy4@t.test');

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
create function pg_temp.purchased(uid uuid) returns bigint language sql as $$
  select purchased_cents from public.user_credits where user_id = uid;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
create temp table t_kv (k text primary key, v jsonb) on commit drop;
grant all on t_kv to authenticated, service_role;

select public.grant_coins('a2000000-0000-0000-0000-000000000001', 5000, 'purchased', 'topup', 'teszt');
select public.grant_coins('b2000000-0000-0000-0000-000000000002', 250, 'purchased', 'topup', 'teszt');
select public.grant_coins('c2000000-0000-0000-0000-000000000003', 1000, 'purchased', 'topup', 'teszt');
select public.grant_coins('d2000000-0000-0000-0000-000000000004', 5000, 'purchased', 'topup', 'teszt');

-- ═══ C1.1 szintváltás ═════════════════════════════════════════════════════════
select pg_temp.act('a2000000-0000-0000-0000-000000000001');
insert into t_kv select 'start', public.subscribe_with_coins('basic', 1);
select pg_temp.note('C1.1 indulás Free-ről: Amatőr 2 Coin', (select v ->> 'kind' = 'start' and (v ->> 'cost')::int = 200 from t_kv where k = 'start'));
select pg_temp.raises('C1.2 Amatőrhöz nem vehető a 100 GB-os add-on', $$select public.add_addon('storage_100gb')$$, 'tier_too_low');
select pg_temp.admin();
update public.subscriptions set period_start = now() - interval '15 days', current_period_end = now() + interval '15 days'
 where user_id = 'a2000000-0000-0000-0000-000000000001';
select pg_temp.act('a2000000-0000-0000-0000-000000000001');
insert into t_kv select 'up', public.subscribe_with_coins('ultra', 1);
select pg_temp.note('C1.1 felfelé félidőben: a fel nem használt 1 Coin jóváírva, 7 Coin fizetendő',
  (select v ->> 'kind' = 'change' and (v ->> 'credit')::int = 100 and (v ->> 'cost')::int = 700 from t_kv where k = 'up'));
select pg_temp.note('C1.1 felfelé: azonnal Profi, új teljes periódus mostantól',
  (select tier = 'ultra' and period_start = now() and current_period_end = now() + interval '1 month' and tier_charge_cents = 800
     from public.subscriptions where user_id = 'a2000000-0000-0000-0000-000000000001'));
insert into t_kv select 'down', public.subscribe_with_coins('pro', 1);
select pg_temp.note('C1.1 lefelé: díj nélkül, a következő ciklustól (addig Profi marad)',
  (select v ->> 'kind' = 'downgrade' and (v ->> 'cost')::int = 0 from t_kv where k = 'down')
  and (select tier = 'ultra' and pending_tier = 'pro' from public.subscriptions where user_id = 'a2000000-0000-0000-0000-000000000001'));

-- ═══ C1.2 add-on ══════════════════════════════════════════════════════════════
insert into t_kv select 'a100', public.add_addon('storage_100gb', 1);
select pg_temp.note('C1.2 add-on a periódus elején: teljes havi ár (6 Coin)', (select (v ->> 'cost')::int = 600 from t_kv where k = 'a100'));
insert into t_kv select 'a10', public.add_addon('storage_10gb', 2);
select pg_temp.note('C1.2 2 × 10 GB: 2 Coin', (select (v ->> 'cost')::int = 200 from t_kv where k = 'a10'));
select public.remove_addon((select (v ->> 'id')::uuid from t_kv where k = 'a10'));
select pg_temp.note('C1.2 a levett add-on a periódus végéig él, a megújítás már nem számolja',
  (select (s ->> 'renewal_cost')::int = 400 + 600 and jsonb_array_length(s -> 'addons') = 2
     from (select public.my_subscription() as s) x));
select pg_temp.admin();
select pg_temp.note('C1.2 a tárhely-add-on a keretbe számít (100 GB + 100 GB + 20 GB)',
  (select (u ->> 'quota_bytes')::bigint = public.gib(220) from (select public.storage_usage_for('a2000000-0000-0000-0000-000000000001') as u) x));
select pg_temp.note('C1.1–C1.2 eddig levont: 2 + 7 + 6 + 2 Coin', pg_temp.purchased('a2000000-0000-0000-0000-000000000001') = 5000 - 200 - 700 - 600 - 200);

-- ═══ C1.3 megújítás ═══════════════════════════════════════════════════════════
insert into t_kv select 'renew1', public.renew_due_subscriptions(now() + interval '1 month' + interval '1 minute');
select pg_temp.note('C1.3 megújítás: a függő lefelé váltás életbe lép (Haladó), 4 + 6 Coin levonva',
  (select tier = 'pro' and pending_tier is null and status = 'active' and current_period_end = now() + interval '2 months'
     from public.subscriptions where user_id = 'a2000000-0000-0000-0000-000000000001')
  and pg_temp.purchased('a2000000-0000-0000-0000-000000000001') = 3300 - 1000);
select pg_temp.note('C1.3 a levett add-on a ciklusváltáskor lekerül',
  (select count(*) = 1 from public.subscription_addons where user_id = 'a2000000-0000-0000-0000-000000000001' and status = 'active'));
insert into t_kv select 'renew_again', public.renew_due_subscriptions(now() + interval '1 month' + interval '1 minute');
select pg_temp.note('C1.3 ugyanarra az időpontra másodszor nem terhel (idempotens)', pg_temp.purchased('a2000000-0000-0000-0000-000000000001') = 2300);

-- kevés egyenleg: értesítés 3 nappal előtte, egyszer; lejáratkor past_due → Free
select pg_temp.act('b2000000-0000-0000-0000-000000000002');
select public.subscribe_with_coins('basic', 1);
select pg_temp.admin();
select pg_temp.note('C1.3 4 nappal előtte még nincs értesítés',
  not exists (select 1 from public.take_renewal_notices(now() + interval '1 month' - interval '4 days') where user_id = 'b2000000-0000-0000-0000-000000000002'));
select pg_temp.note('C1.3 3 nappal a lejárat előtt értesítés (kevés Coin)',
  exists (select 1 from public.take_renewal_notices(now() + interval '1 month' - interval '2 days')
           where user_id = 'b2000000-0000-0000-0000-000000000002' and cost_cents = 200 and balance_cents = 50));
select pg_temp.note('C1.3 periódusonként csak egyszer',
  not exists (select 1 from public.take_renewal_notices(now() + interval '1 month' - interval '1 day') where user_id = 'b2000000-0000-0000-0000-000000000002'));
select public.renew_due_subscriptions(now() + interval '1 month' + interval '1 minute');
select pg_temp.note('C1.3 kevés Coin a lejáratkor: past_due → Free, nem megy mínuszba',
  (select status = 'past_due' from public.subscriptions where user_id = 'b2000000-0000-0000-0000-000000000002')
  and public.active_tier_for('b2000000-0000-0000-0000-000000000002') = 'free'
  and pg_temp.purchased('b2000000-0000-0000-0000-000000000002') = 50);

-- lemondás: egy koppintás, a periódus végéig él, utána lejár
select pg_temp.act('c2000000-0000-0000-0000-000000000003');
select public.subscribe_with_coins('pro', 1);
select public.set_auto_renew(false);
select pg_temp.admin();
select pg_temp.note('C1.3 lemondás után a periódus végéig aktív', public.active_tier_for('c2000000-0000-0000-0000-000000000003') = 'pro');
select public.renew_due_subscriptions(now() + interval '1 month' + interval '1 minute');
select pg_temp.note('C1.3 lemondott előfizetés lejár, nem terhel',
  (select status = 'expired' from public.subscriptions where user_id = 'c2000000-0000-0000-0000-000000000003')
  and pg_temp.purchased('c2000000-0000-0000-0000-000000000003') = 600);

-- áruházi előfizetést nem írunk át Coinnal
update public.subscriptions set tier = 'pro', source = 'iap', status = 'active', current_period_end = now() + interval '20 days'
 where user_id = 'd2000000-0000-0000-0000-000000000004';
select pg_temp.act('d2000000-0000-0000-0000-000000000004');
select pg_temp.raises('C1.1 áruházi előfizetés nem váltható Coinnal', $$select public.subscribe_with_coins('ultra', 1)$$, 'managed_by_store');
select pg_temp.raises('C1.2 add-on csak Coin-számlázásnál', $$select public.add_addon('ai_1m')$$, 'addon_requires_coin_billing');
select pg_temp.admin();
update public.subscriptions set source = 'coins', period_start = now(), current_period_end = now() + interval '1 month'
 where user_id = 'd2000000-0000-0000-0000-000000000004';
select pg_temp.act('d2000000-0000-0000-0000-000000000004');
select public.add_addon('ai_1m', 2);
select public.add_addon('render_60', 1);
select pg_temp.admin();
select pg_temp.note('C1.2 az AI- és render-add-on a worker kvótájába számít',
  (select (q ->> 'aiTokens')::bigint = 2000000 and (q ->> 'renderMinutes')::int = 60 and q ->> 'tier' = 'pro'
     from (select public.subscription_quota_for('d2000000-0000-0000-0000-000000000004') as q) x));

-- jogosultság
select pg_temp.act('d2000000-0000-0000-0000-000000000004');
select pg_temp.raises('C1.3 a kliens nem futtathat megújítást', $$select public.renew_due_subscriptions(now())$$, 'permission denied');
select pg_temp.raises('C1.3 a kliens nem kérheti le az értesítéseket', $$select * from public.take_renewal_notices(now())$$, 'permission denied');
select pg_temp.raises('C1.2 más add-onját nem veheti le', $$select public.remove_addon((select id from public.subscription_addons where user_id = 'a2000000-0000-0000-0000-000000000001' limit 1))$$, 'addon_not_found');
select pg_temp.admin();
select pg_temp.act('b2000000-0000-0000-0000-000000000002');
select pg_temp.raises('C1.2 Free nem vehet add-ont', $$select public.add_addon('ai_1m')$$, 'paid_tier_required');
select pg_temp.admin();

select pg_temp.note('invariáns: a napló összege = az egyenleg',
  not exists (select 1 from public.user_credits u where u.user_id::text like '_2000000-%' and u.balance <>
    coalesce((select sum(delta_cents) from public.credit_transactions t where t.user_id = u.user_id), 0)));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH ciklus-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
