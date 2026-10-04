-- 💰 LIVE.md Fázis F — egress költségkontroll tracking.
-- A futó multistream-egresseket követi: max párhuzamos/user + max adás-hossz
-- (auto-stop) a szerveroldali egress-költség (komponálás+enkódolás) kordában
-- tartásához. CSAK a worker írja (service_role); a user a sajátjait olvashatja.

create table if not exists public.live_egress (
  egress_id    text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  room         text not null,
  status       text not null default 'active' check (status in ('active', 'stopped')),
  destinations int  not null default 0,
  started_at   timestamptz not null default now(),
  stopped_at   timestamptz
);

create index if not exists live_egress_user_active_idx
  on public.live_egress (user_id, status);

create index if not exists live_egress_active_started_idx
  on public.live_egress (status, started_at);

alter table public.live_egress enable row level security;

-- A tulajdonos olvashatja a saját (futó/korábbi) adásait. Írás KIZÁRÓLAG a
-- worker service_role-jával (az megkerüli az RLS-t) — nincs user-írás-policy.
drop policy if exists "own egress read" on public.live_egress;
create policy "own egress read"
  on public.live_egress
  for select
  using (auth.uid() = user_id);
