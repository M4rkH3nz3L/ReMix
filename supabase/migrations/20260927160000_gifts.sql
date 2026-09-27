-- 🎁 Ajándékok (TikTok-modell): koint NEM közvetlen, tetszőleges összegben lehet
-- küldeni, hanem előre definiált AJÁNDÉK formájában (mindegyiknek fix koin-ára van).
-- A küldő koint költ, a címzett a gift teljes koin-értékét kapja (a platform-rés a
-- 5 Ft vétel / 3 Ft kiváltás különbözetében marad — lásd [[coin-wallet-payouts]]).

-- ── új tranzakció-típus: gift ─────────────────────────────────────────────────
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('topup', 'purchase', 'sale', 'refund', 'payout', 'transfer', 'gift'));

-- 🚫 a KÖZVETLEN koin-küldés megszűnik — csak gift formában (send_gift)
revoke execute on function public.send_credits(text, integer) from authenticated;

-- ── ajándék-katalógus ─────────────────────────────────────────────────────────
create table if not exists public.gifts (
  id         text primary key,                  -- 'rose', 'rocket', …
  name       text not null,
  icon       text not null,                     -- emoji
  cost_coins integer not null check (cost_coins > 0),
  sort_order integer not null default 0,
  active     boolean not null default true
);
alter table public.gifts enable row level security;
drop policy if exists "gifts_select_all" on public.gifts;
create policy "gifts_select_all" on public.gifts for select using (true);

insert into public.gifts (id, name, icon, cost_coins, sort_order) values
  ('rose', 'Rózsa', '🌹', 1, 10),
  ('heart', 'Szív', '❤️', 5, 20),
  ('star', 'Csillag', '⭐', 10, 30),
  ('confetti', 'Konfetti', '🎉', 20, 40),
  ('crown', 'Korona', '👑', 50, 50),
  ('rocket', 'Rakéta', '🚀', 100, 60),
  ('diamond', 'Gyémánt', '💎', 200, 70),
  ('sportscar', 'Sportkocsi', '🏎️', 500, 80),
  ('castle', 'Kastély', '🏰', 1000, 90),
  ('universe', 'Univerzum', '🌌', 2000, 100)
on conflict (id) do nothing;

-- ── elküldött ajándékok (napló / kijelzés) ────────────────────────────────────
create table if not exists public.gift_events (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  gift_id    text not null references public.gifts (id),
  coins      integer not null,
  post_id    text,                              -- opcionális: melyik poszton ment
  message    text,
  created_at timestamptz not null default now()
);
create index if not exists gift_events_to_idx on public.gift_events (to_user, created_at desc);
create index if not exists gift_events_from_idx on public.gift_events (from_user, created_at desc);
alter table public.gift_events enable row level security;
drop policy if exists "gift_events_select_own" on public.gift_events;
create policy "gift_events_select_own" on public.gift_events
  for select using (auth.uid() = from_user or auth.uid() = to_user);

-- ── ajándék küldése (atomikus; az ár a KATALÓGUSBÓL, nem a kliens szava) ───────
create or replace function public.send_gift(
  p_to_username text, p_gift_id text, p_post_id text default null, p_message text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from    uuid := auth.uid();
  v_to      uuid;
  v_cost    integer;
  v_balance integer;
begin
  if v_from is null then raise exception 'not authenticated'; end if;

  select cost_coins into v_cost from public.gifts where id = p_gift_id and active;
  if v_cost is null then raise exception 'gift_not_found'; end if;

  select id into v_to from public.profiles where lower(username) = lower(trim(p_to_username));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = v_from then raise exception 'cannot_send_to_self'; end if;

  select balance into v_balance from public.user_credits where user_id = v_from for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_cost then raise exception 'insufficient_credits'; end if;

  update public.user_credits set balance = balance - v_cost, updated_at = now() where user_id = v_from;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_from, -v_cost, 'gift', p_gift_id || ':to:' || p_to_username);
  insert into public.user_credits (user_id, balance, updated_at) values (v_to, v_cost, now())
    on conflict (user_id) do update
      set balance = public.user_credits.balance + v_cost, updated_at = now();
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_to, v_cost, 'gift', p_gift_id || ':from');
  insert into public.gift_events (from_user, to_user, gift_id, coins, post_id, message)
    values (v_from, v_to, p_gift_id, v_cost, p_post_id, p_message);

  select balance into v_balance from public.user_credits where user_id = v_from;
  return jsonb_build_object('balance', v_balance, 'coins', v_cost);
end; $$;
revoke all on function public.send_gift(text, text, text, text) from public, anon;
grant execute on function public.send_gift(text, text, text, text) to authenticated;
