-- 🟡 Trust & Safety (devs/tasks/remix/16 §2.3): moderáció-FELLEBBEZÉS (appeals).
--
-- Ha egy posztot moderáció eltávolít (`moderation_status='removed'`, a report-folyamat
-- vagy a globális moderátor révén), a TULAJDONOS fellebbezhet. A fellebbezés a
-- moderation-queue mellé kerül; a `report.review` jog birtokosa elbírálja:
--   • granted → a poszt visszaáll (`moderate_post(post,'ok')`),
--   • denied  → marad removed.
-- Jelenleg POSZTRA szól (csak a posztnak van `moderation_status`); komment-appeal
-- későbbi lépés, ha a kommentre is bevezetjük a moderation_status-t.

create table if not exists public.content_appeals (
  id            uuid primary key default gen_random_uuid(),
  appellant_id  uuid not null references auth.users (id) on delete cascade,
  post_id       uuid not null references public.posts (id) on delete cascade,
  note          text,
  status        text not null default 'open' check (status in ('open', 'granted', 'denied')),
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- egy nyitott fellebbezés posztonként/felhasználónként (dedup)
create unique index if not exists content_appeals_open_uidx
  on public.content_appeals (appellant_id, post_id) where status = 'open';
create index if not exists content_appeals_status_idx
  on public.content_appeals (status, created_at desc);

alter table public.content_appeals enable row level security;

-- INSERT: CSAK a poszt tulajdonosa, és CSAK ha a posztja valóban 'removed'
drop policy if exists "appeals_insert_own" on public.content_appeals;
create policy "appeals_insert_own" on public.content_appeals
  for insert to authenticated
  with check (
    appellant_id = auth.uid()
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.creator_id = auth.uid()
        and p.moderation_status = 'removed'
    )
  );

-- SELECT: a beküldő a sajátját; a `report.review` birtokosa MINDET
drop policy if exists "appeals_select" on public.content_appeals;
create policy "appeals_select" on public.content_appeals
  for select to authenticated
  using (
    appellant_id = auth.uid() or public.has_permission(auth.uid(), 'report.review')
  );

-- UPDATE (elbírálás): CSAK a `report.review` birtokosa
drop policy if exists "appeals_update_reviewer" on public.content_appeals;
create policy "appeals_update_reviewer" on public.content_appeals
  for update to authenticated
  using (public.has_permission(auth.uid(), 'report.review'))
  with check (public.has_permission(auth.uid(), 'report.review'));

-- a `report.review` birtokosa OLVASHASSA a FELLEBBEZETT (removed) posztot, hogy
-- legyen mit elbírálni — szűken: csak amire van appeal-sor (nem minden removed poszt).
drop policy if exists "posts_select_appealed_moderator" on public.posts;
create policy "posts_select_appealed_moderator" on public.posts
  for select to authenticated
  using (
    public.has_permission(auth.uid(), 'report.review')
    and exists (select 1 from public.content_appeals a where a.post_id = posts.id)
  );

-- 🔴 realtime: a moderátor-nézet élő frissítése
alter publication supabase_realtime add table public.content_appeals;
