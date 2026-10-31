-- 💓 PRO-LIVE L14 — élő-session heartbeat: a host 30 mp-enként frissíti; a szerveres sweep a
-- jel nélküli (crash / app-kill után beragadt) sessiont lezárja, a „Most élő" lista csak a
-- friss adásokat mutatja.
alter table public.live_sessions add column if not exists last_heartbeat timestamptz not null default now();
create index if not exists live_sessions_heartbeat_idx on public.live_sessions (last_heartbeat) where status = 'live';
grant update (last_heartbeat) on public.live_sessions to authenticated;
