-- 📣 Poszt-promóció (reklám / kiemelés) — kredit-alapú, NÉZŐNKÉNTI költés. A
-- szponzor bead egy büdzsét (kredit) + egy nézőnkénti összeget (cost_per_view);
-- a poszt „kiemelt" lesz (feed-előre + jelvény), és minden kiszolgált megtekintés
-- levon `cost_per_view`-t, amíg a büdzsé kifogy. Ez a hirdetési bevételi lánc.
--
-- Szerver-hiteles: a büdzsé levonása escrow-ként az atomikus `promote_post` RPC-n
-- megy (a user_credits írás service_role/RPC-only), a nézőnkénti költést a
-- `record_post_view` intézi (tranzakcióban, FOR UPDATE-tel).

alter table public.posts add column if not exists promoted boolean not null default false;
create index if not exists posts_promoted_idx on public.posts (promoted, created_at desc);

create table if not exists public.post_promotions (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null references public.posts (id) on delete cascade,
  sponsor_id      uuid not null references auth.users (id) on delete cascade,
  budget_credits  integer not null check (budget_credits > 0),
  cost_per_view   integer not null default 1 check (cost_per_view > 0),
  views_target    integer not null,
  views_delivered integer not null default 0,
  spent_credits   integer not null default 0,
  status          text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists post_promotions_active_idx on public.post_promotions (post_id, status);
create index if not exists post_promotions_sponsor_idx on public.post_promotions (sponsor_id, created_at desc);
alter table public.post_promotions enable row level security;

-- a szponzor a sajátjait látja; a poszt tulaja a saját posztja promócióit
drop policy if exists "promotions_select" on public.post_promotions;
create policy "promotions_select" on public.post_promotions
  for select using (
    sponsor_id = auth.uid()
    or exists (select 1 from public.posts p where p.id = post_id and p.creator_id = auth.uid())
  );
-- ÍRÁS-policy szándékosan NINCS: a promóció a promote_post RPC-n megy (escrow).

-- ── promóció indítása (atomikus, escrow) — a BEJELENTKEZETT szponzor hívja ─────
create or replace function public.promote_post(p_post uuid, p_budget integer, p_cost_per_view integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sponsor uuid := auth.uid();
  v_cpv int := greatest(1, coalesce(p_cost_per_view, 1));
  v_budget int := coalesce(p_budget, 0);
  v_balance int;
  v_target int;
  v_id uuid;
begin
  if v_sponsor is null then
    raise exception 'not authenticated';
  end if;
  if v_budget < v_cpv then
    raise exception 'budget too small';
  end if;
  if not exists (select 1 from public.posts where id = p_post and moderation_status <> 'removed') then
    raise exception 'post not available';
  end if;

  select balance into v_balance from public.user_credits where user_id = v_sponsor;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_budget then
    raise exception 'insufficient_credits';
  end if;

  -- büdzsé levonása (escrow) + napló
  update public.user_credits set balance = balance - v_budget, updated_at = now() where user_id = v_sponsor;
  insert into public.credit_transactions (user_id, delta, kind, ref_item, note)
    values (v_sponsor, -v_budget, 'purchase', p_post, 'promotion');

  v_target := floor(v_budget / v_cpv)::int;
  insert into public.post_promotions (post_id, sponsor_id, budget_credits, cost_per_view, views_target)
    values (p_post, v_sponsor, v_budget, v_cpv, v_target)
    returning id into v_id;

  update public.posts set promoted = true where id = p_post;
  return jsonb_build_object('promotionId', v_id, 'viewsTarget', v_target);
end;
$$;
revoke all on function public.promote_post(uuid, integer, integer) from public, anon;
grant execute on function public.promote_post(uuid, integer, integer) to authenticated;

-- ── megtekintés-számláló + NÉZŐNKÉNTI promóció-költés (a social-migráció bővítése) ─
create or replace function public.record_post_view(p_post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare promo record;
begin
  update public.posts set views = views + 1 where id = p_post;

  select * into promo
    from public.post_promotions
   where post_id = p_post and status = 'active'
   order by created_at
   limit 1
   for update;

  if found then
    update public.post_promotions
       set views_delivered = views_delivered + 1,
           spent_credits = promo.spent_credits + promo.cost_per_view,
           status = case when promo.spent_credits + promo.cost_per_view >= promo.budget_credits
                         then 'done' else 'active' end,
           updated_at = now()
     where id = promo.id;

    if promo.spent_credits + promo.cost_per_view >= promo.budget_credits then
      if not exists (
        select 1 from public.post_promotions
         where post_id = p_post and status = 'active' and id <> promo.id
      ) then
        update public.posts set promoted = false where id = p_post;
      end if;
    end if;
  end if;
end;
$$;
grant execute on function public.record_post_view(uuid) to authenticated;

-- ── alkotó összesített statisztikái (publikus aggregátum a csatornához) ────────
create or replace function public.creator_totals(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_build_object(
    'views',    sum(views),
    'likes',    sum(likes),
    'saves',    sum(saves),
    'comments', sum(comments),
    'remixes',  sum(remixes)
  ), '{}'::jsonb)
  from public.posts
  where creator_id = p_user and visibility = 'public' and moderation_status <> 'removed';
$$;
grant execute on function public.creator_totals(uuid) to authenticated, anon;
