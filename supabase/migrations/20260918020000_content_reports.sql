-- 🚩 Tartalom-bejelentés (report): a felhasználók jelezhetik a jogsértő posztot/
-- kommentet; a `report.review` jog birtokosai (moderátor/admin) áttekintik és
-- lezárják (elutasítás / a tartalom moderálása). Ez adja értelmét a `report.review`
-- RBAC-jognak, és a moderációs/GDPR-panasz-útnak.

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users (id) on delete cascade,
  target_type  text not null check (target_type in ('post', 'comment')),
  post_id      uuid references public.posts (id) on delete cascade,
  comment_id   uuid references public.post_comments (id) on delete cascade,
  reason       text not null,
  note         text,
  status       text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by  uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- pontosan EGY cél (poszt VAGY komment)
  check (
    (target_type = 'post' and post_id is not null and comment_id is null)
    or (target_type = 'comment' and comment_id is not null and post_id is null)
  )
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
-- egy user ne jelenthesse többször UGYANAZT (nyitott bejelentés)
create unique index if not exists reports_dedup_post_idx
  on public.reports (reporter_id, post_id) where post_id is not null and status = 'open';
create unique index if not exists reports_dedup_comment_idx
  on public.reports (reporter_id, comment_id) where comment_id is not null and status = 'open';

alter table public.reports enable row level security;

-- INSERT: bármely bejelentkezett user a SAJÁT nevében jelenthet
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert with check (reporter_id = auth.uid());

-- SELECT: a bejelentő a sajátját; a `report.review` birtokosa MINDET
drop policy if exists "reports_select" on public.reports;
create policy "reports_select" on public.reports
  for select using (
    reporter_id = auth.uid() or public.has_permission(auth.uid(), 'report.review')
  );

-- UPDATE (lezárás/elutasítás): CSAK a `report.review` birtokosa
drop policy if exists "reports_update_reviewer" on public.reports;
create policy "reports_update_reviewer" on public.reports
  for update using (public.has_permission(auth.uid(), 'report.review'))
  with check (public.has_permission(auth.uid(), 'report.review'));

-- 🔴 realtime: a moderátor-nézet élő frissítése
alter publication supabase_realtime add table public.reports;
