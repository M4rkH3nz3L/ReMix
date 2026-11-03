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

-- ═══ eredmény ═════════════════════════════════════════════════════════════════
select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
