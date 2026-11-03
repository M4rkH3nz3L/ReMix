-- 🎁 PRO-CASH C2.4 — 7 napos Amatőr-próba kártya és Coin nélkül (PRO-CASH 4.4).
--
-- Fiókonként EGYSZER indítható, csak Free-ről. A próba `trialing` státuszú, `trial` forrású,
-- automatikus megújítás és terhelés NINCS: a 7. nap után az `active_tier_for` magától Free-t
-- ad. A vége előtt 2 nappal értesítés megy (`take_trial_notices`, egyszer).

create table if not exists public.subscription_trials (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  tier        text not null default 'basic',
  started_at  timestamptz not null default now(),
  ends_at     timestamptz not null,
  notified_at timestamptz
);
alter table public.subscription_trials enable row level security;
drop policy if exists "subscription_trials_select_own" on public.subscription_trials;
create policy "subscription_trials_select_own" on public.subscription_trials for select using (auth.uid() = user_id);

create or replace function public.trial_days()
returns integer language sql immutable set search_path = '' as $$ select 7; $$;

create or replace function public.start_trial()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_end timestamptz;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  insert into public.subscriptions (user_id) values (v_user) on conflict (user_id) do nothing;
  perform 1 from public.subscriptions where user_id = v_user for update;
  if public.active_tier_for(v_user) <> 'free' then raise exception 'already_subscribed'; end if;
  if exists (select 1 from public.subscription_trials where user_id = v_user) then raise exception 'trial_used'; end if;

  v_end := now() + (public.trial_days() || ' days')::interval;
  insert into public.subscription_trials (user_id, tier, ends_at) values (v_user, 'basic', v_end);
  update public.subscriptions set
    tier = 'basic', seats = 1, status = 'trialing', source = 'trial', billing_period = 'month',
    period_start = now(), current_period_end = v_end, auto_renew = false, pending_tier = null, tier_charge_cents = 0
  where user_id = v_user;
  return jsonb_build_object('tier', 'basic', 'until', v_end);
end; $$;
revoke all on function public.start_trial() from public, anon;
grant execute on function public.start_trial() to authenticated;

create or replace function public.take_trial_notices(p_now timestamptz default now())
returns table (user_id uuid, ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.subscription_trials t set notified_at = p_now
    from public.subscriptions s
   where s.user_id = t.user_id and s.source = 'trial' and s.status = 'trialing'
     and t.notified_at is null and t.ends_at > p_now and t.ends_at <= p_now + interval '2 days'
  returning t.user_id, t.ends_at;
end; $$;
revoke all on function public.take_trial_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.take_trial_notices(timestamptz) to service_role;

-- a kliens látja, kérhet-e még próbát
create or replace function public.my_subscription()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); s public.subscriptions%rowtype; v_active text;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select * into s from public.subscriptions where user_id = v_user;
  v_active := public.active_tier_for(v_user);
  return jsonb_build_object(
    'tier', v_active, 'status', s.status, 'source', s.source, 'seats', coalesce(s.seats, 1),
    'billing_period', coalesce(s.billing_period, 'month'), 'period_start', s.period_start,
    'until', s.current_period_end, 'auto_renew', coalesce(s.auto_renew, false), 'pending_tier', s.pending_tier,
    'renewal_cost', case when v_active = 'free' then 0 else
      public.period_price_cents(coalesce(s.pending_tier, s.tier), s.billing_period, s.seats)
      + public.addons_period_cents(v_user, s.billing_period, true) end,
    'trial_available', v_active = 'free' and not exists (select 1 from public.subscription_trials where user_id = v_user),
    'addons', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'addon', a.addon, 'qty', a.qty,
                          'cancel_at_period_end', a.cancel_at_period_end) order by a.created_at)
                          from public.subscription_addons a where a.user_id = v_user and a.status = 'active'), '[]'::jsonb)
  );
end; $$;
revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;
