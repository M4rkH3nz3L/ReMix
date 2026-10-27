-- 🌐 Böngészős változat: a „most élőben" lista KIJELENTKEZVE is látható.
--
-- A web nézegető-felület (SEO/AEO + böngészés + Live-nézés) a publikus tartalmat
-- bejelentkezés nélkül mutatja. A live_sessions eddig csak `to authenticated`
-- volt olvasható; az anonim néző CSAK az épp ÉLŐ sessionöket látja (az ended
-- sorok + a host saját előzményei továbbra is a bejelentkezett policy alatt).
-- A sor csak publikus adatot hordoz (cím, denormalizált host-profil, időpontok).

drop policy if exists "live_select_public" on public.live_sessions;
create policy "live_select_public" on public.live_sessions
  for select to anon
  using (status = 'live');
