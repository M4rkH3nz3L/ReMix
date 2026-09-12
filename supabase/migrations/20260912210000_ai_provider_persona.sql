-- 👤 AI-modell PERSONA (karakter): a BYOK-provider személyesebb arcot kap —
-- név, emoji-avatar, rövid sztori és „mire való" (képességek). Így a felhasználó
-- meghittebb hangulatban használhatja (mintha a saját asszisztensét szólítaná).
--
-- Mind opcionális, visszafelé kompatibilis (a meglévő providerek persona nélkül
-- működnek tovább). RLS változatlan (a user_ai_providers own-only policyi élnek).

alter table public.user_ai_providers
  add column if not exists persona_name  text,
  add column if not exists persona_emoji text,
  add column if not exists persona_story text,
  -- mire való: 'text' | 'image' | 'video' | 'audio' | 'captions' | 'music' | 'ideas'
  add column if not exists capabilities  text[] not null default '{}';
