-- 💰 PRO-CASH C3.6 + C3.7: ajánlói jutalék, remix-jutalék, alkotói alap (determinisztikus szétosztás).
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
create function pg_temp.earned(uid uuid, k text) returns bigint language sql as $$
  select coalesce(sum(amount_cents), 0) from public.coin_lots where user_id = uid and bucket = 'earned' and kind = k;
$$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

create function pg_temp.mkuser(uid uuid, uname text, age interval default interval '1 year') returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', uname || '@t.test', now() - age);
  update public.profiles set username = uname where id = uid;
end $$;
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000001', 'ern_ref');
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000002', 'ern_new', interval '1 day');
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000003', 'ern_new2', interval '2 days');
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000004', 'ern_old');
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000005', 'ern_x', interval '1 day');
select pg_temp.mkuser('a4000000-0000-0000-0000-000000000006', 'ern_y', interval '1 day');

-- ═══ C3.6 ajánló ══════════════════════════════════════════════════════════════
select pg_temp.act('a4000000-0000-0000-0000-000000000002');
select pg_temp.raises('C3.6 magát nem ajánlhatja', $$select public.claim_referral('ern_new')$$, 'cannot_refer_self');
select public.claim_referral('ERN_REF');
select pg_temp.raises('C3.6 az ajánló egyszer adható meg', $$select public.claim_referral('ern_old')$$, 'referral_already_set');
select pg_temp.admin();
select pg_temp.act('a4000000-0000-0000-0000-000000000004');
select pg_temp.raises('C3.6 7 nap után nem adható meg ajánló', $$select public.claim_referral('ern_ref')$$, 'referral_window_closed');
select pg_temp.admin();
select pg_temp.act('a4000000-0000-0000-0000-000000000005');
select public.claim_referral('ern_y');
select pg_temp.admin();
select pg_temp.act('a4000000-0000-0000-0000-000000000006');
select pg_temp.raises('C3.6 körbe-ajánlás tilos', $$select public.claim_referral('ern_x')$$, 'referral_loop');
select pg_temp.admin();

select public.grant_coins('a4000000-0000-0000-0000-000000000002', 5000, 'purchased', 'topup', 'teszt');
select pg_temp.act('a4000000-0000-0000-0000-000000000002');
select public.subscribe_with_coins('basic', 1);
select pg_temp.admin();
select pg_temp.note('C3.6 az első fizetett hónapból 50% (2 Coin → 1 Coin), tartásban',
  pg_temp.earned('a4000000-0000-0000-0000-000000000001', 'referral') = 100
  and (select earned_pending_cents = 100 from public.user_credits where user_id = 'a4000000-0000-0000-0000-000000000001'));
select pg_temp.note('C3.6 a fizető a meghívott (a csalásszűréshez)',
  exists (select 1 from public.coin_lots where user_id = 'a4000000-0000-0000-0000-000000000001' and payer_id = 'a4000000-0000-0000-0000-000000000002'));
update public.referrals set first_paid_at = now() - interval '2 months' where referred_id = 'a4000000-0000-0000-0000-000000000002';
select pg_temp.act('a4000000-0000-0000-0000-000000000002');
select public.subscribe_with_coins('basic', 1);
select pg_temp.admin();
select pg_temp.note('C3.6 a következő hónapokban 10% (2 Coin → 0,20 Coin)', pg_temp.earned('a4000000-0000-0000-0000-000000000001', 'referral') = 120);
update public.referrals set first_paid_at = now() - interval '14 months' where referred_id = 'a4000000-0000-0000-0000-000000000002';
select pg_temp.act('a4000000-0000-0000-0000-000000000002');
select public.subscribe_with_coins('basic', 1);
select pg_temp.admin();
select pg_temp.note('C3.6 a 13. hónap után már nincs jutalék', pg_temp.earned('a4000000-0000-0000-0000-000000000001', 'referral') = 120);

select pg_temp.act('a4000000-0000-0000-0000-000000000003');
select public.claim_referral('ern_ref');
select pg_temp.admin();
select public.grant_coins('a4000000-0000-0000-0000-000000000003', 5000, 'purchased', 'topup', 'teszt');
select pg_temp.act('a4000000-0000-0000-0000-000000000003');
select public.subscribe_with_coins('basic', 12);
select pg_temp.admin();
select pg_temp.note('C3.6 éves fizetés: (50% + 11 × 10%) / 12 a 20 Coinból = 2,66 Coin',
  pg_temp.earned('a4000000-0000-0000-0000-000000000001', 'referral') = 120 + 266);
select pg_temp.act('a4000000-0000-0000-0000-000000000001');
select pg_temp.note('C3.6 az ajánló látja a meghívottjait', (select count(*) = 2 from public.referrals));
select pg_temp.admin();

-- ═══ C3.6 remix-jutalék ═══════════════════════════════════════════════════════
insert into public.shop_items (id, seller_id, title, kind, price_cents, status) values
  ('e4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004', 'Eredeti sablon', 'template', 100, 'published'),
  ('e4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002', 'Remixelt sablon', 'template', 1000, 'published');
select pg_temp.act('a4000000-0000-0000-0000-000000000002');
select pg_temp.raises('C3.6 csak megvett eredetire hivatkozhat', $$select public.set_item_origin('e4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001')$$, 'origin_not_purchased');
select public.purchase_shop_item('e4000000-0000-0000-0000-000000000001');
select public.set_item_origin('e4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001');
select pg_temp.raises('C3.6 saját tételre nem hivatkozhat eredetként', $$select public.set_item_origin('e4000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000002')$$, 'origin_is_own');
select pg_temp.raises('C3.6 az eredet közvetlenül (RLS-update) nem írható', $$update public.shop_items set origin_item_id = null where id = 'e4000000-0000-0000-0000-000000000002'$$, 'origin_via_set_item_origin_only');
select pg_temp.admin();
select pg_temp.act('a4000000-0000-0000-0000-000000000003');
select public.purchase_shop_item('e4000000-0000-0000-0000-000000000002');
select pg_temp.admin();
select pg_temp.note('C3.6 remix-jutalék: a 10 Coinos eladásból 1 Coin az eredeti alkotóé',
  pg_temp.earned('a4000000-0000-0000-0000-000000000004', 'commission') = 100);
select pg_temp.note('C3.6 …az eladó 6 Coint kap (70% − 10%), a platform 30% marad',
  pg_temp.earned('a4000000-0000-0000-0000-000000000002', 'sale') = 600);

-- ═══ C3.7 alkotói alap ════════════════════════════════════════════════════════
-- F1: 1200 minőségi nézés eredeti poszton · F2: 1000 nézés remixen (0,5) · F3: csak 99 követő
select pg_temp.mkuser('a4000000-0000-0000-0000-0000000000f1', 'fund_f1');
select pg_temp.mkuser('a4000000-0000-0000-0000-0000000000f2', 'fund_f2');
select pg_temp.mkuser('a4000000-0000-0000-0000-0000000000f3', 'fund_f3');
insert into auth.users (id, instance_id, aud, role, email)
  select ('b4000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'fan' || g || '@t.test' from generate_series(1, 100) g;
insert into public.follows (follower_id, following_id)
  select ('b4000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, c
    from generate_series(1, 100) g, unnest(array['a4000000-0000-0000-0000-0000000000f1', 'a4000000-0000-0000-0000-0000000000f2']::uuid[]) c;
insert into public.follows (follower_id, following_id)
  select ('b4000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'a4000000-0000-0000-0000-0000000000f3' from generate_series(1, 99) g;
insert into public.posts (id, creator_id, title, visibility, moderation_status) values
  ('14000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 'eredeti', 'public', 'ok'),
  ('14000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-0000000000f3', 'f3', 'public', 'ok');
insert into public.posts (id, creator_id, title, visibility, moderation_status, remix_of_post_id) values
  ('14000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-0000000000f2', 'remix', 'public', 'ok', '14000000-0000-0000-0000-000000000001');
update public.posts set likes = 0, saves = 0, remixes = 0, views = 0 where id::text like '14000000-%';
insert into public.post_view_events (post_id, viewer_id, watched_ms, created_at)
  select '14000000-0000-0000-0000-000000000001', ('b4000000-0000-0000-0000-' || lpad((g % 100 + 1)::text, 12, '0'))::uuid, 5000, now() - interval '1 day'
    from generate_series(1, 1200) g;
insert into public.post_view_events (post_id, viewer_id, watched_ms, created_at)
  select '14000000-0000-0000-0000-000000000001', ('b4000000-0000-0000-0000-' || lpad((g % 100 + 1)::text, 12, '0'))::uuid, 1000, now() - interval '1 day'
    from generate_series(1, 500) g;   -- 3 mp alatti: nem számít
insert into public.post_view_events (post_id, viewer_id, watched_ms, created_at)
  select '14000000-0000-0000-0000-000000000002', ('b4000000-0000-0000-0000-' || lpad((g % 100 + 1)::text, 12, '0'))::uuid, 5000, now() - interval '2 days'
    from generate_series(1, 1000) g;
insert into public.post_view_events (post_id, viewer_id, watched_ms, created_at)
  select '14000000-0000-0000-0000-000000000003', ('b4000000-0000-0000-0000-' || lpad((g % 99 + 1)::text, 12, '0'))::uuid, 5000, now() - interval '1 day'
    from generate_series(1, 3000) g;
insert into public.post_view_events (post_id, viewer_id, watched_ms, created_at)
  select '14000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', 5000, now() from generate_series(1, 500) g;  -- saját nézés: nem számít

select pg_temp.note('C3.7 pontszám: F1 = 1200, F2 = 1000 × 0,5 = 500; a 99 követős F3 nem jogosult',
  (select array_agg(user_id::text || '=' || score::text order by user_id) = array[
     'a4000000-0000-0000-0000-0000000000f1=1200.000000', 'a4000000-0000-0000-0000-0000000000f2=500.000000']
     from public.creator_fund_scores() where user_id::text like 'a4000000-%'));
select public.run_creator_fund('2099-01', 1000);
select pg_temp.note('C3.7 1000 cent: F1 706, F2 294 — legnagyobb maradék, egy cent sem vész el',
  (select array_agg(cents order by user_id) = array[706, 294]::bigint[] and sum(cents) = 1000
     from public.creator_fund_shares where period = '2099-01' and user_id::text like 'a4000000-%'));
select pg_temp.note('C3.7 a rész megkeresett Coin, tartásban', pg_temp.earned('a4000000-0000-0000-0000-0000000000f1', 'fund') = 706);
select pg_temp.note('C3.7 ugyanarra a hónapra másodszor nem oszt',
  (select (r ->> 'duplicate')::boolean from (select public.run_creator_fund('2099-01', 1000) as r) x)
  and pg_temp.earned('a4000000-0000-0000-0000-0000000000f1', 'fund') = 706);
select pg_temp.act('a4000000-0000-0000-0000-0000000000f1');
select pg_temp.raises('C3.7 a kliens nem futtathat szétosztást', $$select public.run_creator_fund('2099-02', 1000000)$$, 'permission denied');
select pg_temp.note('C3.7 az alkotó csak a saját részét látja', (select count(*) = 1 from public.creator_fund_shares));
select pg_temp.raises('C3.7 jog nélkül adminból sem futtatható', $$select public.admin_run_creator_fund('2099-02', 1)$$, 'forbidden');
select pg_temp.admin();

select pg_temp.note('invariáns: a napló összege = az egyenleg',
  not exists (select 1 from public.user_credits u where u.user_id::text like 'a4000000-%' and u.balance <>
    coalesce((select sum(delta_cents) from public.credit_transactions t where t.user_id = u.user_id), 0)));

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'PRO-CASH kereset-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
