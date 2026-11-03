-- 💰 PRO-CASH C4.1–C4.3: szervezet, tagok, ülésszám, fejenkénti ár, közös keretek taghatárral.
-- Valódi szerepkörrel, tranzakcióban; semmit nem hagy hátra. Futtatás: npm run test:rls
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
create function pg_temp.mkuser(uid uuid, uname text) returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', uname || '@t.test', now() - interval '1 year');
  update public.profiles set username = uname where id = uid;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
create temp table t_kv (k text primary key, v text) on commit drop;
grant all on t_kv to authenticated;
-- O = tulaj, M1/M2 = tagok, M3 = negyedik, X = kívülálló, A = pénzügyi admin
select pg_temp.mkuser('a5000000-0000-0000-0000-000000000001', 'org_owner');
select pg_temp.mkuser('a5000000-0000-0000-0000-000000000002', 'org_m1');
select pg_temp.mkuser('a5000000-0000-0000-0000-000000000003', 'org_m2');
select pg_temp.mkuser('a5000000-0000-0000-0000-000000000004', 'org_m3');
select pg_temp.mkuser('a5000000-0000-0000-0000-000000000005', 'org_x');
select pg_temp.mkuser('a5000000-0000-0000-0000-0000000000ad', 'org_admin');
insert into public.user_roles (user_id, role) values ('a5000000-0000-0000-0000-0000000000ad', 'admin')
  on conflict (user_id) do update set role = excluded.role;
select public.grant_coins('a5000000-0000-0000-0000-000000000001', 20000, 'purchased', 'topup', 'teszt');

-- ═══ C4.1 létrehozás, ellenőrzés, előfizetés ══════════════════════════════════
select pg_temp.act('a5000000-0000-0000-0000-000000000001');
insert into t_kv select 'org', public.create_organization('Teszt Kft.', 'hu', 'HU 1234 5678', '01-09-123456', 'Teszt.hu', 'szamla@teszt.hu')::text;
select pg_temp.note('C4.1 a szervezet pending, az adószám normalizálva',
  (select status = 'pending' and vat_id = 'HU12345678' and country = 'HU' and domain = 'teszt.hu' from public.organizations where id = (select v::uuid from t_kv where k = 'org')));
select pg_temp.raises('C4.2 ellenőrzés nélkül nem lehet előfizetni', $$select public.org_subscribe_with_coins((select v::uuid from t_kv where k = 'org'), 1, 3)$$, 'org_not_verified');
select pg_temp.raises('C4.5 a várólista csak pénzügyi adminnak', $$select * from public.orgs_pending_review()$$, 'forbidden');
select pg_temp.raises('C4.2 a tulaj nem hagyhatja jóvá a saját cégét', $$select public.admin_review_org((select v::uuid from t_kv where k = 'org'), true)$$, 'forbidden');
select pg_temp.raises('C4.1 magánszemély szervezet nélkül nem vehet Vállalatit', $$select public.subscribe_with_coins('business', 1, 3)$$, 'use_org_subscription');
select pg_temp.note('C4.1 …és a sikertelen kísérlet nem terhelt', (select purchased_cents = 20000 from public.user_credits where user_id = 'a5000000-0000-0000-0000-000000000001'));
select pg_temp.admin();
select pg_temp.act('a5000000-0000-0000-0000-0000000000ad');
select pg_temp.note('C4.5 a pénzügyi admin látja a jóváhagyásra váró céget', exists (select 1 from public.orgs_pending_review() where name = 'Teszt Kft.'));
select public.admin_review_org((select v::uuid from t_kv where k = 'org'), true);
select pg_temp.admin();
select pg_temp.act('a5000000-0000-0000-0000-000000000001');
select public.org_subscribe_with_coins((select v::uuid from t_kv where k = 'org'), 1, 3);
select pg_temp.note('C4.1 3 fő × 10 Coin = 30 Coin', (select purchased_cents = 17000 from public.user_credits where user_id = 'a5000000-0000-0000-0000-000000000001'));
select pg_temp.raises('C4.1 min. 2 ülés', $$select public.org_subscribe_with_coins((select v::uuid from t_kv where k = 'org'), 1, 1)$$, 'invalid seats');

-- ═══ C4.1 tagok és ülések ═════════════════════════════════════════════════════
select public.org_add_member((select v::uuid from t_kv where k = 'org'), 'org_m1');
select public.org_add_member((select v::uuid from t_kv where k = 'org'), 'org_m2', 'admin');
select pg_temp.raises('C4.1 az ülésszámnál több tag nem vehető fel', $$select public.org_add_member((select v::uuid from t_kv where k = 'org'), 'org_m3')$$, 'no_free_seat');
select pg_temp.admin();
select pg_temp.note('C4.1 a tag a szervezettől Vállalatit kap', public.active_tier_for('a5000000-0000-0000-0000-000000000002') = 'business');
select pg_temp.note('C4.1 a kívülálló Free marad', public.active_tier_for('a5000000-0000-0000-0000-000000000005') = 'free');
select pg_temp.act('a5000000-0000-0000-0000-000000000002');
select pg_temp.raises('C4.1 sima tag nem vehet fel tagot', $$select public.org_add_member((select v::uuid from t_kv where k = 'org'), 'org_x')$$, 'forbidden');
select pg_temp.note('C4.1 a tag látja a saját szervezetét és tagjait', (select count(*) = 3 from public.org_members) and (select count(*) = 1 from public.organizations));
select pg_temp.note('C4.1 a konzol-nézet a tagnak is jár', (select (o ->> 'seats')::int = 3 and jsonb_array_length(o -> 'members') = 3 from (select public.my_org() as o) x));
select pg_temp.admin();
select pg_temp.act('a5000000-0000-0000-0000-000000000005');
select pg_temp.note('C4.1 RLS: a kívülálló semmit nem lát', (select count(*) = 0 from public.organizations) and (select count(*) = 0 from public.org_members));
select pg_temp.raises('C4.1 kívülálló nem írhat a tagságba', $$insert into public.org_members (org_id, user_id) values ((select v::uuid from t_kv where k = 'org'), 'a5000000-0000-0000-0000-000000000005')$$, 'row-level security');
select pg_temp.admin();

-- ülésszám: fel azonnal (időarányos díj), le a következő ciklustól
select pg_temp.act('a5000000-0000-0000-0000-000000000003');  -- org-admin
select pg_temp.raises('C4.1 a tagok száma alá nem csökkenthető', $$select public.org_set_seats((select v::uuid from t_kv where k = 'org'), 2)$$, 'seats_below_members');
select pg_temp.admin();
select public.grant_coins('a5000000-0000-0000-0000-000000000003', 5000, 'purchased', 'topup', 'teszt');
select pg_temp.act('a5000000-0000-0000-0000-000000000003');
select public.org_set_seats((select v::uuid from t_kv where k = 'org'), 5);
select pg_temp.note('C4.1 +2 ülés a periódus elején: 2 × 10 Coin az admin egyenlegéből', (select purchased_cents = 3000 from public.user_credits where user_id = 'a5000000-0000-0000-0000-000000000003'));
select public.org_set_seats((select v::uuid from t_kv where k = 'org'), 4);
select pg_temp.admin();
select pg_temp.note('C4.1 a csökkentés függő (a ciklus végéig 5 ülés)',
  (select seats = 5 and pending_seats = 4 from public.subscriptions where user_id = 'a5000000-0000-0000-0000-000000000001'));

-- ár: mennyiségi lépcső és szerződéses ár
select pg_temp.note('C4.1 fejenkénti ár: 10 / 9 (10 fő felett) / 8 Coin (50 fő felett)',
  public.org_seat_price_cents((select v::uuid from t_kv where k = 'org'), 10) = 1000
  and public.org_seat_price_cents((select v::uuid from t_kv where k = 'org'), 11) = 900
  and public.org_seat_price_cents((select v::uuid from t_kv where k = 'org'), 51) = 800);

-- ═══ C4.3 közös tárhely taghatárral ═══════════════════════════════════════════
insert into public.storage_objects (user_id, key, bytes) values
  ('a5000000-0000-0000-0000-000000000002', 'org/m1', public.gib(50)), ('a5000000-0000-0000-0000-000000000003', 'org/m2', public.gib(50));
select pg_temp.note('C4.3 a keret 100 GB × 5 ülés, a használat az egész szervezeté',
  (select (u ->> 'quota_bytes')::bigint = public.gib(500) and (u ->> 'used_bytes')::bigint = public.gib(100)
     from (select public.storage_usage_for('a5000000-0000-0000-0000-000000000002') as u) x));
select pg_temp.act('a5000000-0000-0000-0000-000000000003');
select public.org_set_member_limits((select v::uuid from t_kv where k = 'org'), 'a5000000-0000-0000-0000-000000000002', 60, 500000, 30);
select pg_temp.admin();
select pg_temp.raises('C4.3 a taghatár (60 GB) fölé nem tölthet', $$select public.record_storage_object_for('a5000000-0000-0000-0000-000000000002', 'renders', 'org/m1b', 21474836480, null, 'server')$$, 'quota_exceeded');
select pg_temp.note('C4.3 a határon belül igen (+5 GB)',
  (select (public.record_storage_object_for('a5000000-0000-0000-0000-000000000002', 'renders', 'org/m1c', 5368709120, null, 'server') ->> 'self_bytes')::bigint = public.gib(55)));
select pg_temp.note('C4.3 a másik tagot a határ nem köti (+100 GB a közös keretből)',
  (select (public.record_storage_object_for('a5000000-0000-0000-0000-000000000003', 'renders', 'org/m2b', 107374182400, null, 'server') ->> 'used_bytes')::bigint = public.gib(205)));

-- AI-/render-keret: összesített fogyasztás + taghatár
select public.increment_usage('a5000000-0000-0000-0000-000000000002', to_char(now(), 'YYYY-MM'), 'aiTokens', 400000);
select public.increment_usage('a5000000-0000-0000-0000-000000000003', to_char(now(), 'YYYY-MM'), 'aiTokens', 700000);
select pg_temp.note('C4.3 a szervezet fogyasztása összeadódik, a saját külön látszik',
  (select (u ->> 'pool')::bigint = 1100000 and (u ->> 'self')::bigint = 400000
     from (select public.usage_for_quota('a5000000-0000-0000-0000-000000000002', to_char(now(), 'YYYY-MM'), 'aiTokens') as u) x));
select pg_temp.note('C4.3 a worker kvótája: 5 ülés, a tag határaival',
  (select (q ->> 'seats')::int = 5 and (q -> 'memberLimits' ->> 'aiTokens')::bigint = 500000 and q ->> 'tier' = 'business'
     from (select public.subscription_quota_for('a5000000-0000-0000-0000-000000000002') as q) x));

-- megújítás a fejenkénti árral és a függő ülésszámmal
select public.renew_due_subscriptions(now() + interval '1 month' + interval '1 minute');
select pg_temp.note('C4.1 megújításkor a függő ülésszám (4) lép életbe: 4 × 10 Coin',
  (select seats = 4 and pending_seats is null from public.subscriptions where user_id = 'a5000000-0000-0000-0000-000000000001')
  and (select purchased_cents = 17000 - 4000 from public.user_credits where user_id = 'a5000000-0000-0000-0000-000000000001'));

-- kilépés: a volt tag visszaesik a saját szintjére
select pg_temp.act('a5000000-0000-0000-0000-000000000002');
select public.org_remove_member((select v::uuid from t_kv where k = 'org'), 'a5000000-0000-0000-0000-000000000002');
select pg_temp.admin();
select pg_temp.note('C4.1 a kilépett tag Free-re esik', public.active_tier_for('a5000000-0000-0000-0000-000000000002') = 'free');
select pg_temp.act('a5000000-0000-0000-0000-000000000003');
select pg_temp.raises('C4.1 a tulaj nem távolítható el', $$select public.org_remove_member((select v::uuid from t_kv where k = 'org'), 'a5000000-0000-0000-0000-000000000001')$$, 'cannot_remove_owner');
select pg_temp.admin();

-- ═══ C4.4 céges számla, átutalás ══════════════════════════════════════════════
insert into t_kv select 'inv1', public.issue_org_invoice((select v::uuid from t_kv where k = 'org'), 1, 4, 27, 'HU_DOMESTIC', '{"name":"Teszt Kft."}') ->> 'id';
insert into t_kv select 'inv2', public.issue_org_invoice((select v::uuid from t_kv where k = 'org'), 12, 4, 0, 'EU_REVERSE_CHARGE', '{"name":"Teszt Kft."}') ->> 'id';
select pg_temp.note('C4.4 4 fő × 10 Coin × 5 € = 200 € nettó + 27% ÁFA, 15 napos határidő',
  (select net_cents = 20000 and vat_cents = 5400 and gross_cents = 25400 and due_at = now() + interval '15 days' and status = 'open'
     from public.invoices where id = (select v::uuid from t_kv where k = 'inv1')));
select pg_temp.note('C4.4 a sorszám évente folyamatos, hézag nélkül',
  (select array_agg(number order by number) = array['RMX-' || extract(year from now()) || '-' || lpad((min(c.last) - 1)::text, 6, '0'),
                                                   'RMX-' || extract(year from now()) || '-' || lpad(min(c.last)::text, 6, '0')]
     from public.invoices i, public.invoice_counters c where c.year = extract(year from now())::int and i.org_id = (select v::uuid from t_kv where k = 'org')));
select pg_temp.note('C4.4 éves, fordított adózás: 10 havi díj, 0% ÁFA',
  (select net_cents = 200000 and vat_cents = 0 from public.invoices where id = (select v::uuid from t_kv where k = 'inv2')));
select pg_temp.act('a5000000-0000-0000-0000-000000000003');
select pg_temp.note('C4.4 az org-admin látja a szervezet számláit', (select count(*) = 2 from public.invoices));
select pg_temp.raises('C4.4 jog nélkül nem állítható fizetettre', $$select public.invoice_mark_paid((select v::uuid from t_kv where k = 'inv1'))$$, 'forbidden');
select pg_temp.admin();
select pg_temp.act('a5000000-0000-0000-0000-000000000005');
select pg_temp.note('C4.4 kívülálló nem látja a számlákat', (select count(*) = 0 from public.invoices));
select pg_temp.admin();
select pg_temp.act('a5000000-0000-0000-0000-0000000000ad');
select pg_temp.note('C4.5 a pénzügyi admin látja a nyitott számlákat', (select count(*) = 2 from public.invoices_open() where org_name = 'Teszt Kft.'));
select public.invoice_mark_paid((select v::uuid from t_kv where k = 'inv1'));
select pg_temp.admin();
select pg_temp.note('C4.4 a kifizetett számla aktiválja / meghosszabbítja az előfizetést (forrás: invoice), Coin nélkül',
  (select source = 'invoice' and seats = 4 and tier = 'business' and current_period_end > now() + interval '1 month'
     from public.subscriptions where user_id = 'a5000000-0000-0000-0000-000000000001')
  and (select purchased_cents = 13000 from public.user_credits where user_id = 'a5000000-0000-0000-0000-000000000001'));
select pg_temp.note('C4.4 a tag továbbra is Vállalati', public.active_tier_for('a5000000-0000-0000-0000-000000000003') = 'business');

select pg_temp.note('invariáns: a napló összege = az egyenleg',
  not exists (select 1 from public.user_credits u where u.user_id::text like 'a5000000-%' and u.balance <>
    coalesce((select sum(delta_cents) from public.credit_transactions t where t.user_id = u.user_id), 0)));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH szervezet-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
