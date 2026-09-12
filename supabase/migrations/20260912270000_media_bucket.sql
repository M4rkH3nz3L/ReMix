-- 🎞️ Publikus média-bucket a renderelt videókhoz / borítókhoz (feed + cross-
-- device lejátszás). A worker (service-szintű S3-kulcsokkal) ide tölt fel; a
-- publikus URL (.../storage/v1/object/public/renders/<key>) auth nélkül szolgál
-- ki. A feltöltés service_role/S3 → nincs szükség kliens-írás policyre.
insert into storage.buckets (id, name, public)
values ('renders', 'renders', true)
on conflict (id) do update set public = true;
