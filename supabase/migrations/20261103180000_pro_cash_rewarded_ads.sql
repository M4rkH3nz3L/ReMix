-- 🎬 PRO-CASH C2.2 — jutalmazott reklám → bónusz Coin (PRO-CASH 4.3).
--
-- A jutalmat NEM a kliens kéri: az AdMob szerveroldali ellenőrzése (SSV) hívja a workert,
-- az ECDSA-aláírást a worker ellenőrzi, és csak utána ír jóvá ez a függvény (service_role).
-- Szabályok: 0,02 bónusz Coin / megnézett reklám, naponta (UTC) legfeljebb 5, egy AdMob-
-- tranzakció csak egyszer (az SSV ismételhet). A bónusz nem váltható pénzre és 12 hónap
-- után lejár (coin_credit 'bonus').

create table if not exists public.ad_rewards (
  transaction_id text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  ad_unit        text,
  reward_cents   bigint not null,
  created_at     timestamptz not null default now()
);
create index if not exists ad_rewards_user_day_idx on public.ad_rewards (user_id, created_at desc);
alter table public.ad_rewards enable row level security;
drop policy if exists "ad_rewards_select_own" on public.ad_rewards;
create policy "ad_rewards_select_own" on public.ad_rewards for select using (auth.uid() = user_id);

create or replace function public.ad_reward_cents()
returns bigint language sql immutable set search_path = '' as $$ select 2::bigint; $$;
create or replace function public.ad_reward_daily_limit()
returns integer language sql immutable set search_path = '' as $$ select 5; $$;

create or replace function public.grant_ad_reward(p_user uuid, p_transaction text, p_ad_unit text default null, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_today integer; v_balance bigint;
begin
  if p_user is null or coalesce(p_transaction, '') = '' then raise exception 'invalid reward'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'unknown_user'; end if;
  if exists (select 1 from public.ad_rewards where transaction_id = p_transaction) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  -- a napi számlálás a user sorát zárolja (párhuzamos SSV-hívások ellen)
  insert into public.user_credits (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from public.user_credits where user_id = p_user for update;
  select count(*) into v_today from public.ad_rewards
   where user_id = p_user and created_at >= date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  if v_today >= public.ad_reward_daily_limit() then
    return jsonb_build_object('status', 'daily_limit');
  end if;
  insert into public.ad_rewards (transaction_id, user_id, ad_unit, reward_cents, created_at)
    values (p_transaction, p_user, p_ad_unit, public.ad_reward_cents(), p_now);
  v_balance := public.coin_credit(p_user, public.ad_reward_cents(), 'bonus', 'bonus', 'rewarded_ad', null, null);
  return jsonb_build_object('status', 'granted', 'cents', public.ad_reward_cents(), 'balance', v_balance,
                            'today', v_today + 1);
end; $$;
revoke all on function public.grant_ad_reward(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.grant_ad_reward(uuid, text, text, timestamptz) to service_role;
