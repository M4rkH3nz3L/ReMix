-- 🔁 RevenueCat webhook idempotencia (devs/tasks/remix/11).
--
-- A RevenueCat RETRY-olhatja ugyanazt a webhook-eseményt (hálózati hiba, timeout).
-- Enélkül egy retry DUPLA Pro-aktiválást / kredit-jóváírást okozhatna. Ez a tábla
-- a már feldolgozott esemény-id-ket tárolja; a worker (billing.js) a feldolgozás
-- ELŐTT ellenőrzi, és SIKER UTÁN rögzít ide (best-effort).
--
-- Hozzáférés: csak a worker `service_role`-ja ír/olvas (az RLS-t megkerüli); a
-- tábla RLS-sel védett, policy nélkül → kliens (authenticated/anon) nem fér hozzá.

create table if not exists public.billing_webhook_events (
  id text primary key,
  type text,
  received_at timestamptz not null default now()
);

alter table public.billing_webhook_events enable row level security;
