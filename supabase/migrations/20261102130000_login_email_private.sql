-- 🔐 PRO-SOCIAL S2: az e-mail-feloldás csak a workeré. Kijelentkezve eddig bárki lekérdezhette
-- felhasználónév vagy telefonszám alapján az e-mail-címet. A belépés a POST /auth/login-on megy.
revoke execute on function public.resolve_login_email(text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text) to service_role;
