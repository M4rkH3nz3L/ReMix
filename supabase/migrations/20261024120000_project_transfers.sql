-- 📲 Átviteli tár (eszköz → eszköz, felhő-előfizetés nélkül): a projekt .rp
-- csomagjának TRANZIENS továbbítása a saját eszközeim közt. NEM tárhely-termék:
-- projektenként EGY csomag, 24 órás TTL (a kliens lejártnak tekinti, a worker a
-- következő feltöltéskor söpri), ezért kvótán kívüli — a méret-plafon a workeren
-- (TRANSFER_MAX_BYTES). RLS: mindenki csak a sajátját látja/kezeli; a sort a
-- worker írja (service-role), a kliens olvassa/törli.

create table if not exists public.project_transfers (
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  text not null,
  url         text not null,
  storage_key text not null,
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, project_id)
);
alter table public.project_transfers enable row level security;

drop policy if exists "transfers_own" on public.project_transfers;
create policy "transfers_own" on public.project_transfers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
