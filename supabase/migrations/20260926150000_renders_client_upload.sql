-- 🎞️ Kliens-oldali feltöltés a `renders` bucketbe.
--
-- MIÉRT: eddig a `renders` bucket public volt (olvasás), de KLIENS-ÍRÁS policy nélkül —
-- csak a worker töltött fel (service_role/S3), a SAJÁT (lokális dev) storage-ába. A
-- prod-kliens ezt a prod storage-ra írta át (reachableMediaUrl) → ott NINCS a fájl →
-- 404 → a feed-videó nem indult el. Mostantól weben a kliens KÖZVETLENÜL a saját
-- Supabase Storage-ába tölt (supabase-js) → prodon a prod storage-ba, ahonnan a feed
-- ki is szolgálja. Ehhez kell egy INSERT/UPDATE RLS-policy bejelentkezett usernek.
--
-- Olvasás továbbra is a public bucketen át (media_bucket migráció). A path random
-- UUID (`feed/<uuid>.mp4`, `media/<uuid>.<ext>`), így ütközés/találgatás gyakorlatilag
-- kizárt; a write bejelentkezett userhez kötött és a `renders` bucketre szűkített.

drop policy if exists "renders_authenticated_insert" on storage.objects;
create policy "renders_authenticated_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'renders');

drop policy if exists "renders_authenticated_update" on storage.objects;
create policy "renders_authenticated_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'renders')
  with check (bucket_id = 'renders');
