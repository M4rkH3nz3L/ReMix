-- 🪙 Koin-pénztárca: a pénzkeresés alaprendszere.
--
-- Ráták (a rendszerbe égetve): 1 koin = 5 Ft VÉTELÁRON, 1 koin = 3 Ft KIVÁLTÁSKOR
-- (a platform a különbözetet tartja). Aki koint gyűjt (shop-eladás / kapott
-- utalás), 3 Ft/koinon válthatja pénzre. A Pro előfizetés koinnal is fizethető
-- (500 koin / hó). Minden pénzmozgás SZERVER-HITELES (user_credits RLS csak
-- olvasás; írás kizárólag SECURITY DEFINER függvényből). Lásd [[shop-marketplace-
-- architecture]] (kredit-alap), [[pro-subscription-architecture]] (Pro-forrás).

-- ── új tranzakció-típus: user↔user utalás ─────────────────────────────────────
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('topup', 'purchase', 'sale', 'refund', 'payout', 'transfer'));

-- ── új előfizetés-forrás: koinból fizetett Pro ────────────────────────────────
alter table public.subscriptions drop constraint if exists subscriptions_source_check;
alter table public.subscriptions add constraint subscriptions_source_check
  check (source in ('manual', 'revenuecat', 'stripe', 'promo', 'credits'));

-- ── kifizetési célszámla (userenként) ─────────────────────────────────────────
create table if not exists public.payout_accounts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  provider   text not null check (provider in ('paypal', 'stripe')),
  email      text,                              -- PayPal e-mail (recipient)
  account_ref text,                             -- Stripe connected account id (későbbre)
  updated_at timestamptz not null default now()
);
alter table public.payout_accounts enable row level security;
drop policy if exists "payout_accounts_select_own" on public.payout_accounts;
create policy "payout_accounts_select_own" on public.payout_accounts
  for select using (auth.uid() = user_id);
-- ÍRÁS csak a set_payout_account SECURITY DEFINER függvényből.

-- ── kifizetési kérelmek / tranzakciók ─────────────────────────────────────────
create table if not exists public.payout_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  coins       integer not null check (coins > 0),
  amount_huf  integer not null,                 -- coins × 3
  status      text not null default 'pending'
                check (status in ('pending', 'processing', 'paid', 'failed')),
  provider    text,
  provider_ref text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists payout_requests_user_idx on public.payout_requests (user_id, created_at desc);
alter table public.payout_requests enable row level security;
drop policy if exists "payout_requests_select_own" on public.payout_requests;
create policy "payout_requests_select_own" on public.payout_requests
  for select using (auth.uid() = user_id);

-- ── Pro előfizetés fizetése KOINNAL (500 koin / hó) ───────────────────────────
create or replace function public.subscribe_pro_with_credits(p_months integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_cost    integer;
  v_balance integer;
  v_cur_end timestamptz;
  v_cur_tier text;
  v_base    timestamptz;
  v_end     timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_months is null or p_months < 1 or p_months > 12 then raise exception 'invalid months'; end if;
  v_cost := 500 * p_months;

  select balance into v_balance from public.user_credits where user_id = v_user for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_cost then raise exception 'insufficient_credits'; end if;

  update public.user_credits set balance = balance - v_cost, updated_at = now() where user_id = v_user;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_user, -v_cost, 'purchase', 'pro_credits:' || p_months || 'mo');

  -- Pro aktiválás/megújítás (mint a billing.activatePro: érvényes Pro → onnan tol)
  select current_period_end, tier into v_cur_end, v_cur_tier
    from public.subscriptions where user_id = v_user;
  v_base := case
    when v_cur_tier = 'pro' and v_cur_end is not null and v_cur_end > now() then v_cur_end
    else now() end;
  v_end := v_base + (p_months || ' months')::interval;
  insert into public.subscriptions (user_id, tier, status, current_period_end, source)
    values (v_user, 'pro', 'active', v_end, 'credits')
  on conflict (user_id) do update
    set tier = 'pro', status = 'active', current_period_end = v_end, source = 'credits';

  select balance into v_balance from public.user_credits where user_id = v_user;
  return jsonb_build_object('balance', v_balance, 'pro_until', v_end);
end; $$;
revoke all on function public.subscribe_pro_with_credits(integer) from public, anon;
grant execute on function public.subscribe_pro_with_credits(integer) to authenticated;

-- ── koin-küldés user↔user (username alapján, atomikus) ────────────────────────
create or replace function public.send_credits(p_to_username text, p_amount integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from    uuid := auth.uid();
  v_to      uuid;
  v_balance integer;
begin
  if v_from is null then raise exception 'not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid amount'; end if;

  select id into v_to from public.profiles where lower(username) = lower(trim(p_to_username));
  if v_to is null then raise exception 'recipient_not_found'; end if;
  if v_to = v_from then raise exception 'cannot_send_to_self'; end if;

  select balance into v_balance from public.user_credits where user_id = v_from for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < p_amount then raise exception 'insufficient_credits'; end if;

  update public.user_credits set balance = balance - p_amount, updated_at = now() where user_id = v_from;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_from, -p_amount, 'transfer', 'to:' || p_to_username);
  insert into public.user_credits (user_id, balance, updated_at) values (v_to, p_amount, now())
    on conflict (user_id) do update
      set balance = public.user_credits.balance + p_amount, updated_at = now();
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (v_to, p_amount, 'transfer', 'from');

  select balance into v_balance from public.user_credits where user_id = v_from;
  return jsonb_build_object('balance', v_balance);
end; $$;
revoke all on function public.send_credits(text, integer) from public, anon;
grant execute on function public.send_credits(text, integer) to authenticated;

-- ── kifizetési célszámla beállítása (saját) ───────────────────────────────────
create or replace function public.set_payout_account(p_provider text, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_provider not in ('paypal', 'stripe') then raise exception 'invalid provider'; end if;
  insert into public.payout_accounts (user_id, provider, email, updated_at)
    values (v_user, p_provider, p_email, now())
  on conflict (user_id) do update
    set provider = p_provider, email = p_email, updated_at = now();
end; $$;
revoke all on function public.set_payout_account(text, text) from public, anon;
grant execute on function public.set_payout_account(text, text) to authenticated;

-- ── kifizetési kérelem (service_role: a worker hívja a levonáshoz) ─────────────
-- Min. 100 koin. Levon (koin), naplóz, és 'pending' payout-sort hoz létre; az
-- összeg coins×3 Ft. A tényleges provider-utalást a worker intézi, majd a
-- resolve_payout-tal zárja (siker/bukás → bukáskor koin-visszatérítés).
create or replace function public.request_payout_for(p_user uuid, p_coins integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_balance integer; v_amount integer; v_id uuid;
begin
  if p_coins is null or p_coins < 100 then raise exception 'below_min_payout'; end if;
  select balance into v_balance from public.user_credits where user_id = p_user for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < p_coins then raise exception 'insufficient_credits'; end if;

  v_amount := p_coins * 3;  -- 3 Ft / koin kiváltáskor
  update public.user_credits set balance = balance - p_coins, updated_at = now() where user_id = p_user;
  insert into public.credit_transactions (user_id, delta, kind, note)
    values (p_user, -p_coins, 'payout', 'payout_request');
  insert into public.payout_requests (user_id, coins, amount_huf, status)
    values (p_user, p_coins, v_amount, 'pending') returning id into v_id;

  select balance into v_balance from public.user_credits where user_id = p_user;
  return jsonb_build_object('request_id', v_id, 'coins', p_coins, 'amount_huf', v_amount, 'balance', v_balance);
end; $$;
revoke all on function public.request_payout_for(uuid, integer) from public, anon, authenticated;
grant execute on function public.request_payout_for(uuid, integer) to service_role;

-- ── kifizetés lezárása (service_role): siker/bukás; bukáskor koin-visszatérítés ─
create or replace function public.resolve_payout(p_request uuid, p_status text, p_provider_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests%rowtype;
begin
  if p_status not in ('processing', 'paid', 'failed') then raise exception 'invalid status'; end if;
  select * into r from public.payout_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if r.status not in ('pending', 'processing') then return; end if; -- idempotens

  update public.payout_requests
    set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), updated_at = now()
    where id = p_request;

  if p_status = 'failed' then
    insert into public.user_credits (user_id, balance, updated_at) values (r.user_id, r.coins, now())
      on conflict (user_id) do update
        set balance = public.user_credits.balance + r.coins, updated_at = now();
    insert into public.credit_transactions (user_id, delta, kind, note)
      values (r.user_id, r.coins, 'refund', 'payout_failed');
  end if;
end; $$;
revoke all on function public.resolve_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_payout(uuid, text, text) to service_role;
