-- 🤖 Feladat → AI-modell hozzárendelés.
--
-- Melyik AI-feladat (asszisztens, auto-edit, feliratok, hookok, borítócímek)
-- melyik user_ai_providers modellt használja. Ami nincs itt → az alapértelmezett
-- (is_default) providerre, majd a worker saját env-AI-jára esik vissza.
--
-- Így különböző feladatok különböző (gyorsabb/olcsóbb) modelleket kaphatnak, és
-- párhuzamosan, külön végpontokon futhatnak.

create table if not exists public.user_ai_task_providers (
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'assistant' | 'autoEdit' | 'captionStudio' | 'hooks' | 'thumbHeadlines'
  task        text not null,
  provider_id uuid not null references public.user_ai_providers (id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (user_id, task)
);

alter table public.user_ai_task_providers enable row level security;

drop policy if exists "ai_tasks_select_own" on public.user_ai_task_providers;
create policy "ai_tasks_select_own" on public.user_ai_task_providers
  for select using (auth.uid() = user_id);

drop policy if exists "ai_tasks_insert_own" on public.user_ai_task_providers;
create policy "ai_tasks_insert_own" on public.user_ai_task_providers
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai_tasks_update_own" on public.user_ai_task_providers;
create policy "ai_tasks_update_own" on public.user_ai_task_providers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai_tasks_delete_own" on public.user_ai_task_providers;
create policy "ai_tasks_delete_own" on public.user_ai_task_providers
  for delete using (auth.uid() = user_id);

-- updated_at karbantartása (a set_updated_at() a profiles-migrációból már létezik)
drop trigger if exists user_ai_task_providers_set_updated_at on public.user_ai_task_providers;
create trigger user_ai_task_providers_set_updated_at
  before update on public.user_ai_task_providers
  for each row execute function public.set_updated_at();
