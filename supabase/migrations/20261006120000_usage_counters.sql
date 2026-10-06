-- 📊 Usage-metering (audit §2.2) — a drága felhő-erőforrások havi mérése + tier-kvóta.
-- A worker (service_role) könyvel az `increment_usage` RPC-vel; a user a SAJÁT
-- havi számlálóit olvashatja (RLS). A havi reset = új `period` (YYYY-MM) → a régi
-- sorok maradnak (történet), az új hónap friss 0-ról indul. (A storage KÜLÖN rendszer.)

create table if not exists public.usage_counters (
  user_id    uuid not null references auth.users (id) on delete cascade,
  period     text not null,                 -- 'YYYY-MM' (UTC)
  metric     text not null,                 -- aiTokens / renderMinutes / exports / cloudJobs
  amount     bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period, metric)
);

alter table public.usage_counters enable row level security;

-- A tulajdonos olvashatja a saját számlálóit; ÍRÁS kizárólag a worker service_role-jával
-- (az megkerüli az RLS-t) — nincs user-írás-policy.
drop policy if exists "own usage read" on public.usage_counters;
create policy "own usage read"
  on public.usage_counters
  for select
  using (auth.uid() = user_id);

-- Atomikus növelés (a worker service_role-lal hívja; a p_user explicit, mert ott nincs
-- auth.uid()). SECURITY DEFINER + fix search_path a biztonságért.
create or replace function public.increment_usage(
  p_user uuid,
  p_period text,
  p_metric text,
  p_amount bigint
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (user_id, period, metric, amount)
  values (p_user, p_period, p_metric, greatest(p_amount, 0))
  on conflict (user_id, period, metric)
  do update set amount = usage_counters.amount + greatest(excluded.amount, 0),
                updated_at = now();
$$;
