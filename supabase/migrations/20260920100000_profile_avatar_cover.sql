-- 🖼️ Profil- és borítókép a csatornához.
--
-- A `profiles`-ra teszünk egy publikus Storage-URL-t az avatarhoz és a borítóhoz.
-- A képfájlt a kliens a worker /media/upload-ján tölti fel (publikus renders bucket),
-- és az URL-t ide menti. A feed a posztra denormalizált `creator_avatar`-t mutatja
-- (publikáláskor innen másolva), a csatorna-fejléc pedig közvetlenül innen.
--
-- RLS: a profiles meglévő policy-jét használjuk (mindenki csak a SAJÁTJÁT írja;
-- olvasni a csatorna-megjelenítéshez mások sorát is lehet) — új oszlop, nincs
-- külön policy szükség.

alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists cover_url text;
