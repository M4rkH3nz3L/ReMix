-- 🧑‍🎨 AI-modell AVATAR: a felhasználó által összerakott karakter vonásai
-- (bőrszín, haj, arc, kiegészítő, háttér) — SVG-ből renderelve (AvatarSvg).
-- A korábbi persona_emoji marad (opcionális, legacy); az avatar az elsődleges.
-- Opcionális, visszafelé kompatibilis; RLS változatlan (own-only).

alter table public.user_ai_providers
  add column if not exists persona_avatar jsonb;
