-- 🔒 renders bucket — a KLIENS-OLDALI (authenticated) írás OWNER-path-ra szűkítése.
-- (devs/tasks/remix/05 · OWASP API1/BOLA + storage-abuse)
--
-- PROBLÉMA: a korábbi policy (`renders_authenticated_insert/update`, 20260926150000)
-- BÁRMELY bejelentkezett usernek engedte, hogy a publikus `renders` bucketbe
-- BÁRHOVÁ írjon/felülírjon (`with check (bucket_id = 'renders')`). Mivel a bucket
-- PUBLIC olvasásra (feed), ez storage-abuse / idegen-objektum-felülírás felület:
-- egy támadó a saját tokenjével tetszőleges tartalmat tölthetne a mi domainünkről
-- kiszolgált bucketbe.
--
-- MIÉRT BIZTONSÁGOS EZ A SZŰKÍTÉS (nem töri az appot):
--   • Az app a feed-médiát a WORKEREN (`/media/upload`) keresztül tölti, amely
--     `service_role`-lal ír — az MEGKERÜLI az RLS-t, tehát ez a policy NEM érinti.
--     (A worker kulcsa: `<projectId>/<kind>/<fájl>`.)
--   • Az app SEHOL nem ír közvetlenül, `authenticated`-role-ként a `renders`-be
--     (nincs kliens-oldali supabase-storage upload) → a szűkítés semmit sem tör.
--   • A PUBLIC OLVASÁS (a feed lejátszása) külön, változatlan → a meglévő
--     feed-URL-ek és a lejátszás érintetlen.
--
-- Hatás: mostantól egy `authenticated` hívó CSAK a saját uid-prefixe alá írhat
-- (`renders/{auth.uid()}/...`). Ha a jövőben lesz kliens-direkt feltöltés, az
-- eleve owner-scoped lesz.
--
-- DEPLOY: önmagában alkalmazható (`supabase db push`); nincs kliens-koordináció,
-- mert az app nem támaszkodik kliens-direkt `renders` írásra.

drop policy if exists "renders_authenticated_insert" on storage.objects;
drop policy if exists "renders_authenticated_update" on storage.objects;
drop policy if exists "renders_owner_insert" on storage.objects;
drop policy if exists "renders_owner_update" on storage.objects;

create policy "renders_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "renders_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'renders'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
