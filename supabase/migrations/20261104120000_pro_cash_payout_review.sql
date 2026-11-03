-- 💸 PRO-CASH C3.3 + C3.4 — kifizetés KYC-vel, állapotgéppel és csalásszűréssel.
--
-- KYC (2.5, 8.3–8.4): kifizetést csak ellenőrzött fiók kérhet (`payout_accounts.kyc_status =
-- 'verified'`). Az ellenőrzést a partner végzi (Stripe Connect Express: account.updated webhook;
-- PayPal: a fiókos azonosítás), nálunk csak az azonosító és az állapot van (8.6).
--
-- ÁLLAPOTGÉP (`payout_transition`, service_role):
--   requested ──► approved ──► processing ──► paid
--       │             │             └──────► failed  ──► (visszaírás a beválthatóra)
--       └► under_review ─► approved / rejected ──► (visszaírás)
-- Minden más átmenet tilos; a visszaírás pontosan egyszer történik.
--
-- CSALÁSSZŰRÉS (2.5, C3.4, `payout_risk_flags`): a kérés NEM megy automatikusan, ha
--   • ring          — a 30 napos bevétel olyan fizetőtől jön, akinek ő is fizetett (körbeajándékozás);
--   • new_accounts  — a bevétel több mint fele 7 napnál fiatalabb fiókoktól;
--   • concentration — egyetlen fizető adja a bevétel 80%-át (min. 20 Coin felett);
--   • shared_device — fizető és alkotó ugyanazt az eszközt használta (ujjlenyomat);
--   • review        — a fiók ellenőrzésre jelölt (visszatérített, elköltött Coin).
-- Jelzővel a kérés `under_review`, és `payout.review` jogú admin hagyja jóvá vagy utasítja el.

-- ═══ jogosultság ═══════════════════════════════════════════════════════════════
insert into public.app_permissions (key, label, description, sort)
  values ('payout.review', 'Kifizetések ellenőrzése', 'Gyanús kifizetési kérelmek jóváhagyása vagy elutasítása', 110)
on conflict (key) do nothing;
insert into public.role_permissions (role_slug, permission_key) values ('admin', 'payout.review')
on conflict do nothing;

-- ═══ KYC-állapot ═══════════════════════════════════════════════════════════════
alter table public.payout_accounts add column if not exists kyc_status text not null default 'none';
alter table public.payout_accounts drop constraint if exists payout_accounts_kyc_status_check;
alter table public.payout_accounts add constraint payout_accounts_kyc_status_check
  check (kyc_status in ('none', 'pending', 'verified', 'rejected'));
alter table public.payout_accounts add column if not exists kyc_verified_at timestamptz;
alter table public.payout_accounts alter column provider drop not null;

-- a user a PayPal-címét állíthatja — a KYC-állapotot NEM (az a partner webhookjáé)
create or replace function public.set_payout_account(p_provider text, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_provider not in ('paypal', 'stripe') then raise exception 'invalid provider'; end if;
  insert into public.payout_accounts (user_id, provider, email, updated_at)
    values (v_user, p_provider, p_email, now())
  on conflict (user_id) do update
    set provider = p_provider, email = p_email, updated_at = now(),
        -- másik célszámla → az ellenőrzést újra kell kérni
        kyc_status = case when public.payout_accounts.email is distinct from p_email
                            or public.payout_accounts.provider is distinct from p_provider
                          then 'none' else public.payout_accounts.kyc_status end;
end; $$;

-- KYC-állapot írása (service_role: Stripe Connect / PayPal webhook, kézi ellenőrzés)
create or replace function public.set_kyc_status(p_user uuid, p_provider text, p_status text, p_account_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('none', 'pending', 'verified', 'rejected') then raise exception 'invalid status'; end if;
  insert into public.payout_accounts (user_id, provider, account_ref, kyc_status, kyc_verified_at, updated_at)
    values (p_user, p_provider, p_account_ref, p_status, case when p_status = 'verified' then now() end, now())
  on conflict (user_id) do update
    set provider = coalesce(p_provider, public.payout_accounts.provider),
        account_ref = coalesce(p_account_ref, public.payout_accounts.account_ref),
        kyc_status = p_status,
        kyc_verified_at = case when p_status = 'verified' then now() else public.payout_accounts.kyc_verified_at end,
        updated_at = now();
end; $$;
revoke all on function public.set_kyc_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_kyc_status(uuid, text, text, text) to service_role;

-- ═══ állapotok ═════════════════════════════════════════════════════════════════
alter table public.payout_requests drop constraint if exists payout_requests_status_check;
update public.payout_requests set status = 'requested' where status = 'pending';
alter table public.payout_requests add constraint payout_requests_status_check check (status in
  ('requested', 'under_review', 'approved', 'processing', 'paid', 'failed', 'rejected'));
alter table public.payout_requests alter column status set default 'requested';
alter table public.payout_requests add column if not exists risk_flags text[] not null default '{}';
alter table public.payout_requests add column if not exists reviewed_by uuid references auth.users (id) on delete set null;
alter table public.payout_requests add column if not exists review_note text;
alter table public.payout_requests add column if not exists refunded boolean not null default false;

create table if not exists public.payout_events (
  id         bigserial primary key,
  request_id uuid not null references public.payout_requests (id) on delete cascade,
  from_status text,
  to_status  text not null,
  actor      uuid,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists payout_events_request_idx on public.payout_events (request_id, id);
alter table public.payout_events enable row level security;
drop policy if exists "payout_events_select_own" on public.payout_events;
create policy "payout_events_select_own" on public.payout_events for select using (
  exists (select 1 from public.payout_requests r where r.id = request_id and r.user_id = auth.uid())
);

-- ═══ C3.4: kockázati jelzők ═══════════════════════════════════════════════════
create or replace function public.payout_risk_flags(p_user uuid, p_now timestamptz default now())
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_flags text[] := '{}';
  v_total bigint;
  v_new bigint;
  v_top bigint;
begin
  -- az elmúlt 30 nap megkeresett tételei (fizetővel)
  select coalesce(sum(amount_cents), 0) into v_total from public.coin_lots
   where user_id = p_user and bucket = 'earned' and status <> 'reversed' and created_at > p_now - interval '30 days';

  if exists (
    select 1 from public.coin_lots mine
     where mine.user_id = p_user and mine.bucket = 'earned' and mine.created_at > p_now - interval '30 days'
       and mine.payer_id is not null
       and exists (select 1 from public.coin_lots back where back.user_id = mine.payer_id and back.payer_id = p_user
                     and back.bucket = 'earned' and back.created_at > p_now - interval '30 days')
  ) then
    v_flags := array_append(v_flags, 'ring');
  end if;

  select coalesce(sum(l.amount_cents), 0) into v_new from public.coin_lots l join auth.users u on u.id = l.payer_id
   where l.user_id = p_user and l.bucket = 'earned' and l.status <> 'reversed' and l.created_at > p_now - interval '30 days'
     and l.created_at - u.created_at < interval '7 days';
  if v_total > 0 and v_new * 2 > v_total then
    v_flags := array_append(v_flags, 'new_accounts');
  end if;

  select coalesce(max(s), 0) into v_top from (
    select sum(amount_cents) s from public.coin_lots
     where user_id = p_user and bucket = 'earned' and status <> 'reversed' and payer_id is not null
       and created_at > p_now - interval '30 days'
     group by payer_id) x;
  if v_total >= 2000 and v_top * 10 >= v_total * 8 then
    v_flags := array_append(v_flags, 'concentration');
  end if;

  if exists (
    select 1 from public.user_devices mine join public.user_devices theirs on theirs.fingerprint = mine.fingerprint
     where mine.user_id = p_user and theirs.user_id <> p_user and mine.fingerprint is not null
       and theirs.user_id in (select payer_id from public.coin_lots where user_id = p_user and bucket = 'earned')
  ) then
    v_flags := array_append(v_flags, 'shared_device');
  end if;

  if coalesce((select review_required from public.user_credits where user_id = p_user), false) then
    v_flags := array_append(v_flags, 'review');
  end if;
  return v_flags;
end; $$;
revoke all on function public.payout_risk_flags(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.payout_risk_flags(uuid, timestamptz) to service_role;

-- ═══ kérés: KYC + minimum + heti 1 + beváltható; jelzővel kézi ellenőrzésre ════
drop function if exists public.request_payout_for(uuid, bigint);
create or replace function public.request_payout_for(p_user uuid, p_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_avail bigint; v_acct public.payout_accounts%rowtype; v_amount bigint; v_id uuid; v_balance bigint;
  v_flags text[]; v_status text;
begin
  if p_cents is null or p_cents < public.coin_min_payout_cents() then raise exception 'below_min_payout'; end if;
  select * into v_acct from public.payout_accounts where user_id = p_user;
  if not found or (v_acct.email is null and v_acct.account_ref is null) then raise exception 'no_payout_account'; end if;
  if v_acct.kyc_status <> 'verified' then raise exception 'kyc_required'; end if;
  perform public.coin_settle(p_user);
  select earned_available_cents into v_avail from public.user_credits where user_id = p_user for update;
  if coalesce(v_avail, 0) < p_cents then raise exception 'insufficient_earned'; end if;
  if exists (select 1 from public.payout_requests where user_id = p_user
              and status not in ('failed', 'rejected') and created_at > now() - interval '7 days') then
    raise exception 'payout_weekly_limit';
  end if;

  v_flags := public.payout_risk_flags(p_user);
  v_status := case when cardinality(v_flags) > 0 then 'under_review' else 'approved' end;
  v_amount := public.coin_payout_eur_cents(p_cents);
  update public.user_credits set earned_available_cents = earned_available_cents - p_cents, updated_at = now()
    where user_id = p_user;
  insert into public.payout_requests (user_id, cents, amount_eur_cents, currency, status, provider, risk_flags)
    values (p_user, p_cents, v_amount, 'EUR', v_status, v_acct.provider, v_flags) returning id into v_id;
  insert into public.payout_events (request_id, from_status, to_status, note)
    values (v_id, null, v_status, case when cardinality(v_flags) > 0 then array_to_string(v_flags, ',') end);
  insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
    values (p_user, -p_cents, 'earned_available', 'payout', 'payout_request', v_id);
  select balance into v_balance from public.user_credits where user_id = p_user;
  return jsonb_build_object('request_id', v_id, 'status', v_status, 'risk_flags', to_jsonb(v_flags), 'cents', p_cents,
                            'amount_eur_cents', v_amount, 'provider', v_acct.provider, 'balance', v_balance);
end; $$;
revoke all on function public.request_payout_for(uuid, bigint) from public, anon, authenticated;
grant execute on function public.request_payout_for(uuid, bigint) to service_role;

-- ═══ állapotgép ════════════════════════════════════════════════════════════════
create or replace function public.payout_transition(
  p_request uuid, p_to text, p_provider_ref text default null, p_note text default null, p_actor uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests%rowtype; v_ok boolean;
begin
  select * into r from public.payout_requests where id = p_request for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = p_to then
    return jsonb_build_object('status', r.status, 'unchanged', true);  -- idempotens
  end if;
  v_ok := (r.status, p_to) in (
    ('requested', 'approved'), ('requested', 'under_review'), ('requested', 'rejected'),
    ('under_review', 'approved'), ('under_review', 'rejected'),
    ('approved', 'processing'), ('approved', 'failed'),
    ('processing', 'paid'), ('processing', 'failed'));
  if not v_ok then raise exception 'invalid_transition:%->%', r.status, p_to; end if;

  update public.payout_requests set status = p_to, provider_ref = coalesce(p_provider_ref, provider_ref),
         reviewed_by = coalesce(p_actor, reviewed_by), review_note = coalesce(p_note, review_note), updated_at = now()
   where id = p_request;
  insert into public.payout_events (request_id, from_status, to_status, actor, note) values (p_request, r.status, p_to, p_actor, p_note);

  if p_to in ('failed', 'rejected') and not r.refunded then
    update public.user_credits set earned_available_cents = earned_available_cents + r.cents, updated_at = now()
      where user_id = r.user_id;
    insert into public.credit_transactions (user_id, delta_cents, bucket, kind, note, ref_item)
      values (r.user_id, r.cents, 'earned_available', 'refund', 'payout_' || p_to, r.id);
    update public.payout_requests set refunded = true where id = p_request;
  end if;
  return jsonb_build_object('status', p_to);
end; $$;
revoke all on function public.payout_transition(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.payout_transition(uuid, text, text, text, uuid) to service_role;

-- a régi lezáró a gépen át (kompatibilitás a worker korábbi hívásaival)
create or replace function public.resolve_payout(p_request uuid, p_status text, p_provider_ref text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.payout_requests%rowtype;
begin
  select * into r from public.payout_requests where id = p_request;
  if not found then raise exception 'not_found'; end if;
  if p_status = 'paid' and r.status = 'approved' then
    perform public.payout_transition(p_request, 'processing', p_provider_ref);
  end if;
  perform public.payout_transition(p_request, p_status, p_provider_ref);
end; $$;
revoke all on function public.resolve_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_payout(uuid, text, text) to service_role;

-- ═══ kézi ellenőrzés: `payout.review` jogú admin (a kliensről, saját tokennel) ═══
create or replace function public.review_payout(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin uuid := auth.uid(); r public.payout_requests%rowtype;
begin
  if v_admin is null then raise exception 'not authenticated'; end if;
  if not public.has_permission(v_admin, 'payout.review') then raise exception 'forbidden'; end if;
  select * into r from public.payout_requests where id = p_request;
  if not found then raise exception 'not_found'; end if;
  if r.user_id = v_admin then raise exception 'cannot_review_own'; end if;
  if r.status <> 'under_review' then raise exception 'not_under_review'; end if;
  return public.payout_transition(p_request, case when p_approve then 'approved' else 'rejected' end, null, p_note, v_admin);
end; $$;
revoke all on function public.review_payout(uuid, boolean, text) from public, anon;
grant execute on function public.review_payout(uuid, boolean, text) to authenticated;

-- az ellenőrzésre váró kérelmek (admin-lista)
create or replace function public.payouts_under_review()
returns table (id uuid, user_id uuid, username text, cents bigint, amount_eur_cents bigint, risk_flags text[], created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'payout.review') then raise exception 'forbidden'; end if;
  return query select r.id, r.user_id, p.username, r.cents, r.amount_eur_cents, r.risk_flags, r.created_at
    from public.payout_requests r left join public.profiles p on p.id = r.user_id
   where r.status = 'under_review' order by r.created_at;
end; $$;
revoke all on function public.payouts_under_review() from public, anon;
grant execute on function public.payouts_under_review() to authenticated;
