-- 🔧 Javítás: az `owns_remix_source` SECURITY DEFINER függvényt az `anon`
-- (kijelentkezett) szerep is hívhassa. A `posts_select` RLS-policy hivatkozik rá,
-- és a publikus feed / komment OLVASÁS anon szerepként fut — enélkül minden
-- posts-érintő lekérés 42501 „permission denied for function" hibával elhal
-- (a feed és a kommentek üresek / hibásak kijelentkezve).
--
-- (A 20260917000000 migráció eredetileg csak `authenticated`-nek adta meg; ez a
-- külön migráció a MÁR ALKALMAZOTT lokális/éles DB-t is javítja `db reset` nélkül.)
grant execute on function public.owns_remix_source(uuid) to anon;
