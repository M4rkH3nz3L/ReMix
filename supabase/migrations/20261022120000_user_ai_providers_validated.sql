-- 🧪 AI-provider feladat-vizsga (local-ai 5.3): a user által hozzáadott modell
-- mentés után feladatonként bevizsgázik, és CSAK a sikeres feladataira fogható.
--   validated_tasks  — a bevizsgázott feladatok ('assistant', 'hooks', …);
--                      NULL = még nem vizsgázott (legacy sor, átmeneti kegyelem)
--   validated_at     — a vizsga időpontja
--   validated_model  — a vizsgált konfiguráció ujjlenyomata (provider|baseUrl|model);
--                      a kliens híváskor összeveti — eltérés = érvénytelen vizsga
alter table public.user_ai_providers
  add column if not exists validated_tasks text[] default null,
  add column if not exists validated_at timestamptz default null,
  add column if not exists validated_model text default null;

comment on column public.user_ai_providers.validated_tasks is
  'Feladat-vizsga: mely AI-feladatokra vizsgázott be a modell (NULL = még nem vizsgázott)';
comment on column public.user_ai_providers.validated_model is
  'A vizsgált konfiguráció ujjlenyomata — provider/baseUrl/model váltás érvényteleníti';
