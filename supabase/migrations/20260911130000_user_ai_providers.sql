-- 🤖 Felhasználói AI-modell konfigurációk (BYOK — bring your own key).
--
-- Minden sor egy provider/modell-beállítás: megjelenített név, provider-típus,
-- API-végpont, modell-azonosító és az API-kulcs. A felhasználó a profilján
-- hozza létre/szerkeszti; egy jelölhető alapértelmezettnek.
--
-- Kulcs-tárolás: a kulcs a DB-ben van, RLS-sel CSAK a tulaj olvashatja/írhatja.
-- (A service_role/DB-admin technikailag hozzáfér — ez a tudatosan vállalt
-- kompromisszum a profil-szintű, eszközök közti szinkronért.)

create table if not exists public.user_ai_providers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null,
  -- 'openai' | 'anthropic' | 'ollama' | 'custom' (OpenAI-kompatibilis végpont)
  provider   text not null default 'custom',
  -- API-végpont; üres/null = a provider alapértelmezett címe
  base_url   text,
  -- modell-azonosító (pl. gpt-4o, claude-opus-4-8, qwen3:14b)
  model      text not null,
  -- API-kulcs (lokális/Ollama esetén lehet üres)
  api_key    text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_ai_providers_user_id_idx
  on public.user_ai_providers (user_id);

-- legfeljebb egy alapértelmezett provider felhasználónként
create unique index if not exists user_ai_providers_one_default
  on public.user_ai_providers (user_id) where is_default;

alter table public.user_ai_providers enable row level security;

drop policy if exists "ai_providers_select_own" on public.user_ai_providers;
create policy "ai_providers_select_own" on public.user_ai_providers
  for select using (auth.uid() = user_id);

drop policy if exists "ai_providers_insert_own" on public.user_ai_providers;
create policy "ai_providers_insert_own" on public.user_ai_providers
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai_providers_update_own" on public.user_ai_providers;
create policy "ai_providers_update_own" on public.user_ai_providers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai_providers_delete_own" on public.user_ai_providers;
create policy "ai_providers_delete_own" on public.user_ai_providers
  for delete using (auth.uid() = user_id);

-- updated_at karbantartása (a set_updated_at() a profiles-migrációból már létezik)
drop trigger if exists user_ai_providers_set_updated_at on public.user_ai_providers;
create trigger user_ai_providers_set_updated_at
  before update on public.user_ai_providers
  for each row execute function public.set_updated_at();
