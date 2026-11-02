-- 🔐 Közösségi jogosultságok valódi szerepkörrel (authenticated + RLS). Tranzakcióban fut, semmit nem hagy hátra.
-- Futtatás: npm run test:rls
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table t_results (name text, ok boolean, detail text) on commit drop;
grant all on t_results to authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@t.test', '{"full_name":"Alice"}'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@t.test', '{"full_name":"Bob"}'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carol@t.test', '{"full_name":"Carol"}'),
  ('d0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dan@t.test', '{"full_name":"Dan"}');
update public.profiles set full_name = 'Alice', username = 'alice_t', avatar_url = 'https://x/a.png' where id = 'a0000000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Bob', username = 'bob_t' where id = 'b0000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Carol', username = 'carol_t' where id = 'c0000000-0000-0000-0000-000000000003';
update public.profiles set full_name = 'Dan', username = 'dan_t' where id = 'd0000000-0000-0000-0000-000000000004';

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
-- tiltottnak kell lennie: hiba, vagy nem érintett sort
create function pg_temp.denied(n text, sql text) returns void language plpgsql as $$
declare c int;
begin
  execute sql;
  get diagnostics c = row_count;
  perform pg_temp.note(n, c = 0, format('%s sor változott', c));
exception when others then
  perform pg_temp.note(n, true, sqlerrm);
end $$;
create function pg_temp.allowed(n text, sql text) returns void language plpgsql as $$
declare c int;
begin
  execute sql;
  get diagnostics c = row_count;
  perform pg_temp.note(n, c > 0, format('%s sor', c));
exception when others then
  perform pg_temp.note(n, false, sqlerrm);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
grant all on t_results to anon, service_role;

insert into public.posts (id, creator_id, title, visibility, moderation_status) values
  ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alice eltávolított', 'public', 'removed'),
  ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Alice nyilvános', 'public', 'ok'),
  ('10000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Carol privát', 'private', 'ok');
insert into public.conversations (id, kind) values
  ('20000000-0000-0000-0000-000000000001', 'dm'),
  ('20000000-0000-0000-0000-000000000002', 'dm'),
  ('20000000-0000-0000-0000-000000000003', 'group');
insert into public.conversations (id, kind, owner_id, project_id) values
  ('20000000-0000-0000-0000-000000000004', 'project', 'a0000000-0000-0000-0000-000000000001', 'prj1');
insert into public.conversation_members (conversation_id, user_id) values
  ('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002');
insert into public.cloud_projects (user_id, project_id, name, data) values
  ('a0000000-0000-0000-0000-000000000001', 'prj1', 'p', '{}');
insert into public.project_members (owner_id, project_id, member_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'prj1', 'b0000000-0000-0000-0000-000000000002', 'editor');
update public.project_members set status = 'active' where project_id = 'prj1';
insert into public.messages (id, conversation_id, sender_id, body) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'Carol titka');
insert into public.post_comments (id, post_id, author_id, body) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Bob kommentje');
insert into public.user_blocks (blocker_id, blocked_id) values
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001');

-- S1 poszt: a tulaj csak a saját szerkeszthető mezőit írhatja
select pg_temp.act('a0000000-0000-0000-0000-000000000001');
select pg_temp.denied('S1 moderátori eltávolítás visszavonása', $$update public.posts set moderation_status = 'ok' where id = '10000000-0000-0000-0000-000000000001'$$);
select pg_temp.denied('S1 számláló hamisítása', $$update public.posts set likes = 9999 where id = '10000000-0000-0000-0000-000000000002'$$);
select pg_temp.denied('S1 ingyen promóció', $$update public.posts set promoted = true where id = '10000000-0000-0000-0000-000000000002'$$);
select pg_temp.denied('S1 más alkotó nevében', $$update public.posts set creator_name = 'Carol', creator_username = 'carol_t' where id = '10000000-0000-0000-0000-000000000002'$$);
select pg_temp.allowed('S1 a cím szerkeszthető marad', $$update public.posts set title = 'Új cím' where id = '10000000-0000-0000-0000-000000000002'$$);
select pg_temp.allowed('S1 új poszt írható', $$insert into public.posts (id, creator_id, title, creator_name, creator_username, creator_avatar, moderation_status, likes, views, created_at) values ('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Hamis', 'Carol', 'carol_t', 'https://x/hamis.png', 'ok', 999, 999, '2000-01-01')$$);
select pg_temp.admin();
select pg_temp.note('S1 az új poszt adatai szerveroldaliak', creator_name = 'Alice' and creator_username = 'alice_t' and creator_avatar = 'https://x/a.png' and likes = 0 and views = 0 and created_at > now() - interval '1 hour', format('%s/%s/%s', creator_name, likes, created_at))
  from public.posts where id = '10000000-0000-0000-0000-000000000009';

-- S3 tagság: a saját sor nem költöztethető más beszélgetésbe
select pg_temp.act('a0000000-0000-0000-0000-000000000001');
select pg_temp.denied('S3 belépés idegen beszélgetésbe', $$update public.conversation_members set conversation_id = '20000000-0000-0000-0000-000000000002' where conversation_id = '20000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-000000000001'$$);
select pg_temp.allowed('S3 az olvasottság frissíthető', $$update public.conversation_members set last_read_at = now() where conversation_id = '20000000-0000-0000-0000-000000000001' and user_id = 'a0000000-0000-0000-0000-000000000001'$$);

-- S4 meghívás: csak csoportba, blokkolót nem
select pg_temp.denied('S4 kívülálló a DM-be', $$select public.add_group_member('20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003')$$);
select pg_temp.denied('S4 kívülálló a projekt-chatbe', $$select public.add_group_member('20000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003')$$);
select pg_temp.denied('S4 a blokkoló nem húzható csoportba', $$select public.add_group_member('20000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004')$$);
select pg_temp.allowed('S4 csoportba hívás működik', $$select public.add_group_member('20000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002')$$);
select pg_temp.admin();
select pg_temp.note('S4 a kívülálló tényleg nem került a DM-be', not exists (select 1 from public.conversation_members where conversation_id = '20000000-0000-0000-0000-000000000001' and user_id = 'c0000000-0000-0000-0000-000000000003'));

-- S6 projekt: a szerkesztő nem veheti át
select pg_temp.act('b0000000-0000-0000-0000-000000000002');
select pg_temp.denied('S6 projekt elrablása', $$update public.cloud_projects set user_id = 'b0000000-0000-0000-0000-000000000002' where project_id = 'prj1'$$);
select pg_temp.allowed('S6 a szerkesztő dolgozhat', $$update public.cloud_projects set name = 'új' where project_id = 'prj1'$$);

-- S10 üzenet: a feladó adatai és az idő szerveroldali
select pg_temp.allowed('S10 üzenet küldhető', $$insert into public.messages (id, conversation_id, sender_id, body, sender_name, sender_username, created_at) values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Hali', 'Admin', 'admin', '2099-01-01')$$);
select pg_temp.denied('S10 hamis rendszerüzenet DM-ben', $$insert into public.messages (conversation_id, sender_id, body, kind) values ('20000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'A fiókod lejárt', 'system')$$);
select pg_temp.allowed('S10 a projekt-napló írható', $$insert into public.messages (conversation_id, sender_id, body, kind) values ('20000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Bob mentett', 'system')$$);
select pg_temp.admin();
select pg_temp.note('S10 a név és a dátum nem hamisítható', sender_name = 'Bob' and sender_username = 'bob_t' and created_at < now() + interval '1 hour', format('%s/%s', sender_name, created_at))
  from public.messages where id = '30000000-0000-0000-0000-000000000002';

-- S11 komment: csak a szöveg szerkeszthető
select pg_temp.act('b0000000-0000-0000-0000-000000000002');
select pg_temp.denied('S11 komment átmozgatása', $$update public.post_comments set post_id = '10000000-0000-0000-0000-000000000003' where id = '40000000-0000-0000-0000-000000000001'$$);
select pg_temp.denied('S11 szerző átírása', $$update public.post_comments set author_name = 'Alice' where id = '40000000-0000-0000-0000-000000000001'$$);
select pg_temp.allowed('S11 a szöveg szerkeszthető', $$update public.post_comments set body = 'Javítva' where id = '40000000-0000-0000-0000-000000000001'$$);
select pg_temp.allowed('S11 új komment', $$insert into public.post_comments (id, post_id, author_id, body, author_name, author_username) values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'x', 'Alice', 'alice_t')$$);
select pg_temp.admin();
select pg_temp.note('S11 a szerző neve szerveroldali', author_name = 'Bob', author_name) from public.post_comments where id = '40000000-0000-0000-0000-000000000002';

-- S12/S13 blokk: két irányban véd, a blokkoló oldalán is
insert into public.conversations (id, kind) values ('20000000-0000-0000-0000-000000000005', 'dm');
insert into public.conversation_members (conversation_id, user_id) values
  ('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004');
select pg_temp.act('a0000000-0000-0000-0000-000000000001');
select pg_temp.denied('S12 a blokkolt nem írhat a blokkolónak', $$insert into public.messages (conversation_id, sender_id, body) values ('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Zaklatás')$$);
select pg_temp.admin();
insert into public.user_blocks (blocker_id, blocked_id) values ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002');
select pg_temp.act('b0000000-0000-0000-0000-000000000002');
select pg_temp.denied('S13 a blokkolt nem nyithat új DM-et', $$select public.get_or_create_dm('c0000000-0000-0000-0000-000000000003')$$);
select pg_temp.act('a0000000-0000-0000-0000-000000000001');

-- S16 jelentés: csak látott üzenet, státusz nélkül
select pg_temp.denied('S16 idegen üzenet jelentése', $$insert into public.reports (reporter_id, target_type, message_id, reason) values ('a0000000-0000-0000-0000-000000000001', 'message', '30000000-0000-0000-0000-000000000001', 'spam')$$);
select pg_temp.denied('S16 a jelentő nem zárhatja le', $$insert into public.reports (reporter_id, target_type, post_id, reason, status) values ('a0000000-0000-0000-0000-000000000001', 'post', '10000000-0000-0000-0000-000000000002', 'spam', 'resolved')$$);
select pg_temp.allowed('S16 látható poszt jelenthető', $$insert into public.reports (reporter_id, target_type, post_id, reason) values ('a0000000-0000-0000-0000-000000000001', 'post', '10000000-0000-0000-0000-000000000002', 'spam')$$);

-- S20 lájk és mentés: csak látható posztra
select pg_temp.denied('S20 lájk nem látható posztra', $$insert into public.post_likes (post_id, user_id) values ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001')$$);
select pg_temp.denied('S20 mentés nem látható posztra', $$insert into public.post_saves (post_id, user_id) values ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001')$$);
select pg_temp.allowed('S20 látható poszt lájkolható', $$insert into public.post_likes (post_id, user_id) values ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001') on conflict (post_id, user_id) do update set post_id = excluded.post_id$$);
select pg_temp.allowed('S20 a lájk visszavonható', $$delete from public.post_likes where post_id = '10000000-0000-0000-0000-000000000002' and user_id = 'a0000000-0000-0000-0000-000000000001'$$);

-- S5 kirúgott tag nem marad a projekt-chatben; a profilkép követi a posztokat
select pg_temp.act('a0000000-0000-0000-0000-000000000001');
select pg_temp.allowed('S5 a tulaj eltávolíthat tagot', $$delete from public.project_members where project_id = 'prj1' and member_id = 'b0000000-0000-0000-0000-000000000002'$$);
update public.profiles set avatar_url = 'https://x/uj.png' where id = 'a0000000-0000-0000-0000-000000000001';
select pg_temp.admin();
select pg_temp.note('S5 a kirúgott tag kikerül a projekt-chatből', not exists (select 1 from public.conversation_members where conversation_id = '20000000-0000-0000-0000-000000000004' and user_id = 'b0000000-0000-0000-0000-000000000002'));
select pg_temp.note('S1 az új profilkép a korábbi posztokon is látszik', creator_avatar = 'https://x/uj.png', creator_avatar) from public.posts where id = '10000000-0000-0000-0000-000000000002';

-- S2: az e-mail nem kérdezhető le, sem kijelentkezve, sem belépve
select set_config('role', 'anon', true);
select pg_temp.denied('S2 kijelentkezve nem kérhető e-mail', $$select public.resolve_login_email('alice_t')$$);
select pg_temp.act('b0000000-0000-0000-0000-000000000002');
select pg_temp.denied('S2 belépve sem kérhető e-mail', $$select public.resolve_login_email('alice_t')$$);
select pg_temp.admin();
select set_config('role', 'service_role', true);
select pg_temp.note('S2 a worker feloldhatja', public.resolve_login_email('alice_t') = 'alice@t.test');
select pg_temp.admin();

-- S18 meghívás: elfogadásig nem tag, a tulaj sem teheti azzá
insert into public.cloud_projects (user_id, project_id, name, data) values ('a0000000-0000-0000-0000-000000000001', 'prj2', 'p2', '{"titok":1}');
select pg_temp.act('a0000000-0000-0000-0000-000000000001');
select pg_temp.allowed('S18 a tulaj meghívhat', $$insert into public.project_members (owner_id, project_id, member_id, role) values ('a0000000-0000-0000-0000-000000000001', 'prj2', 'c0000000-0000-0000-0000-000000000003', 'editor')$$);
select pg_temp.act('c0000000-0000-0000-0000-000000000003');
select pg_temp.note('S18 elfogadás előtt a projekt nem látszik', not exists (select 1 from public.cloud_projects where project_id = 'prj2'));
select pg_temp.denied('S18 elfogadás előtt nem írható', $$update public.cloud_projects set name = 'x' where project_id = 'prj2'$$);
select pg_temp.denied('S18 a státusz nem írható át kézzel', $$update public.project_members set status = 'active' where project_id = 'prj2' and member_id = 'c0000000-0000-0000-0000-000000000003'$$);
select pg_temp.denied('S18 más meghívója nem fogadható el', $$select public.respond_project_invite('a0000000-0000-0000-0000-000000000001', 'prj1', true)$$);
select pg_temp.allowed('S18 a meghívott elfogadhatja', $$select public.respond_project_invite('a0000000-0000-0000-0000-000000000001', 'prj2', true)$$);
select pg_temp.note('S18 elfogadás után látszik a projekt', exists (select 1 from public.cloud_projects where project_id = 'prj2'));
select pg_temp.admin();

select (case when ok then 'PASS ' else 'FAIL ' end) || name || coalesce(' — ' || nullif(detail, ''), '') from t_results;
select count(*) filter (where ok) || ' / ' || count(*) || ' rendben' from t_results;
do $$ begin
  if exists (select 1 from t_results where not ok) then
    raise exception 'RLS-teszt: % hibás ellenőrzés', (select count(*) from t_results where not ok);
  end if;
end $$;
rollback;
