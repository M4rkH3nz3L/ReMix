-- 💳 Per-user előfizetés — a Pro szint EGYETLEN szerver-oldali forrása.
--
-- A Pro (free|pro) felhasználónként ITT él; a kliens (entitlementStore) ezt
-- szinkronizálja bejelentkezéskor, és offline-cache-eli. A billing
-- (RevenueCat/Stripe) KÉSŐBB ír ide (source + current_period_end); egyelőre a
-- sort admin / service_role állítja (Supabase Studio vagy webhook).
--
-- BIZTONSÁG: a user CSAK a SAJÁT sorát OLVASHATJA — írni NEM tud, így nem
-- grantelheti magának a Pro-t. Az írás service_role-lal megy (megkerüli az RLS-t).

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  tier               text not null default 'free' check (tier in ('free', 'pro')),
  status             text not null default 'active'
                       check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  -- meddig érvényes a Pro; null = lejárat nélkül (dev / örökös / promo)
  current_period_end timestamptz,
  source             text not null default 'manual'
                       check (source in ('manual', 'revenuecat', 'stripe', 'promo')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- csak olvasás, csak a sajátját; ÍRÁS-policy szándékosan nincs (service_role kell)
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- updated_at karbantartása (a profiles-migrációban definiált set_updated_at újrahasznosítva)
drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── új usernek 'free' sor ─────────────────────────────────────────────────────
-- Így az admin MINDEN felhasználót lát a táblában, és egy sor-módosítással
-- válthat tiert. A trigger a profil-triggertől független (mindkettő after-insert).
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (user_id, tier, source)
  values (new.id, 'free', 'manual')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

-- ── meglévő userek backfill ───────────────────────────────────────────────────
-- A trigger csak új insertnél fut; a már létező fiókoknak most hozunk 'free' sort.
insert into public.subscriptions (user_id, tier, source)
select id, 'free', 'manual' from auth.users
on conflict (user_id) do nothing;
