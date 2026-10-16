-- 🎟️ Promo / kupon / creator-kód (Monetization §06.4/§06.5).
--
-- Növekedési + creator-partner alapréteg: beváltható kódok, amelyek koint írnak
-- jóvá (kind='credit'), Pro-napot adnak (kind='proDays'), vagy százalékos
-- checkout-kedvezményt (kind='percent', a vásárláskor alkalmazva). MINDEN beváltás
-- SZERVER-HITELES: a promo_codes tábla RLS-sel zárt (NINCS közvetlen select →
-- nincs kód-enumeráció), a beváltás kizárólag a redeem_promo SECURITY DEFINER
-- függvényen megy, a kliens sosem ad magának kedvezményt. A kliens-UX-előnézetet
-- a preview_promo adja (pontos kódra, nem listáz). A döntés-szabály tükre a pure
-- src/lib/promoCodes.ts (redemptionDecision) — a kettő ugyanazt mondja ki.
-- Lásd [[coin-wallet-payouts]] (kredit-főkönyv), [[pro-subscription-architecture]].

-- ── új főkönyvi ág: promo-jóváírás ────────────────────────────────────────────
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('topup', 'purchase', 'sale', 'refund', 'payout', 'transfer', 'promo'));

-- ── promo-kódok (admin/service_role tölti; a user sosem listázza) ──────────────
create table if not exists public.promo_codes (
  code            text primary key,
  kind            text not null check (kind in ('percent', 'credit', 'proDays')),
  value           integer not null check (value >= 0),
  expires_at      timestamptz,                    -- null = nincs lejárat
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 0),  -- null = korlátlan
  per_user_limit  integer not null default 1 check (per_user_limit >= 0),
  active          boolean not null default true,
  campaign_id     text,                           -- attribúció (növekedés-mérés, §06.5)
  creator_id      uuid references auth.users (id) on delete set null,  -- creator-partner kód
  created_at      timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
-- SZÁNDÉKOSAN nincs select-policy authenticated-re → direkt select üres (anti-enumeráció).
-- Olvasás/beváltás a preview_promo / redeem_promo SECURITY DEFINER függvényeken át.

-- ── beváltások (idempotencia + per-user/globális limit számlálás alapja) ───────
create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null references public.promo_codes (code) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  value       integer not null,
  created_at  timestamptz not null default now()
);
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code);
create index if not exists promo_redemptions_user_code_idx on public.promo_redemptions (user_id, code);
alter table public.promo_redemptions enable row level security;
drop policy if exists "promo_redemptions_select_own" on public.promo_redemptions;
create policy "promo_redemptions_select_own" on public.promo_redemptions
  for select using (auth.uid() = user_id);

-- ── UX-előnézet: EGY pontos kódra ad vissza (nem listáz) ──────────────────────
-- A kliens ebből táplálja a pure redemptionDecision()-t azonnali visszajelzéshez
-- (érvénytelen/lejárt/kimerült), MIELŐTT a redeem_promo-t hívná.
create or replace function public.preview_promo(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  c        public.promo_codes%rowtype;
  v_global integer;
  v_user_n integer;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into c from public.promo_codes where code = upper(trim(p_code));
  if not found then return jsonb_build_object('found', false); end if;

  select count(*) into v_global from public.promo_redemptions where code = c.code;
  select count(*) into v_user_n from public.promo_redemptions where code = c.code and user_id = v_user;

  return jsonb_build_object(
    'found', true,
    'code', c.code,
    'kind', c.kind,
    'value', c.value,
    'expiresAt', c.expires_at,
    'maxRedemptions', c.max_redemptions,
    'perUserLimit', c.per_user_limit,
    'active', c.active,
    'campaignId', c.campaign_id,
    'creatorId', c.creator_id,
    'globalRedemptions', v_global,
    'userRedemptions', v_user_n
  );
end; $$;
revoke all on function public.preview_promo(text) from public, anon;
grant execute on function public.preview_promo(text) to authenticated;

-- ── HITELES beváltás (atomikus, a kódsort zárolva) ────────────────────────────
-- A döntés sorrendje a pure redemptionDecision() tükre: aktív → lejárat →
-- globális limit → per-user limit. Sikerkor jóváír (credit) / Pro-napot ad
-- (proDays) / csak rögzít és visszaad (percent → checkout-kupon). Idempotencia a
-- per-user limiten keresztül: a kódsor FOR UPDATE zárolása serializálja a
-- párhuzamos beváltásokat.
create or replace function public.redeem_promo(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  c         public.promo_codes%rowtype;
  v_global  integer;
  v_user_n  integer;
  v_limit   integer;
  v_balance integer;
  v_cur_end timestamptz;
  v_cur_tier text;
  v_base    timestamptz;
  v_end     timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into c from public.promo_codes where code = upper(trim(p_code)) for update;
  if not found then raise exception 'invalid_code'; end if;
  if not c.active then raise exception 'inactive'; end if;
  if c.expires_at is not null and now() >= c.expires_at then raise exception 'expired'; end if;

  select count(*) into v_global from public.promo_redemptions where code = c.code;
  if c.max_redemptions is not null and v_global >= c.max_redemptions then
    raise exception 'limit_reached';
  end if;

  select count(*) into v_user_n from public.promo_redemptions where code = c.code and user_id = v_user;
  v_limit := coalesce(c.per_user_limit, 1);
  if v_user_n >= v_limit then raise exception 'per_user_limit_reached'; end if;

  insert into public.promo_redemptions (code, user_id, kind, value)
    values (c.code, v_user, c.kind, c.value);

  if c.kind = 'credit' then
    insert into public.user_credits (user_id, balance, updated_at) values (v_user, c.value, now())
      on conflict (user_id) do update
        set balance = public.user_credits.balance + c.value, updated_at = now();
    insert into public.credit_transactions (user_id, delta, kind, note)
      values (v_user, c.value, 'promo', 'promo:' || c.code);
    select balance into v_balance from public.user_credits where user_id = v_user;
    return jsonb_build_object('kind', 'credit', 'value', c.value, 'balance', v_balance);

  elsif c.kind = 'proDays' then
    select current_period_end, tier into v_cur_end, v_cur_tier
      from public.subscriptions where user_id = v_user;
    v_base := case
      when v_cur_tier = 'pro' and v_cur_end is not null and v_cur_end > now() then v_cur_end
      else now() end;
    v_end := v_base + (c.value || ' days')::interval;
    insert into public.subscriptions (user_id, tier, status, current_period_end, source)
      values (v_user, 'pro', 'active', v_end, 'promo')
    on conflict (user_id) do update
      set tier = 'pro', status = 'active', current_period_end = v_end, source = 'promo';
    return jsonb_build_object('kind', 'proDays', 'value', c.value, 'pro_until', v_end);

  else  -- percent: checkout-kupon, nincs azonnali főkönyvi mozgás
    return jsonb_build_object('kind', 'percent', 'value', c.value);
  end if;
end; $$;
revoke all on function public.redeem_promo(text) from public, anon;
grant execute on function public.redeem_promo(text) to authenticated;
