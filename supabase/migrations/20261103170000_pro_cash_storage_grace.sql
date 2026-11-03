-- 🗄️ PRO-CASH C1.6 — türelmi idő és megőrzés, ha a felhő-tárhely a kereten túl van.
--
-- Lefelé váltás vagy lejárat után a meglévő média túllógathat az új kereten. Ilyenkor:
--   • AUTOMATIKUS TÖRLÉS NINCS (adatvesztés-tilalom, ADR-013);
--   • a tárhely CSAK OLVASHATÓ: új feltöltés nem megy (a record_storage_object_for eddig is
--     keményen tiltott), letölteni, törölni, a saját felhőbe költöztetni lehet;
--   • 30 nap türelmi idő (`grace_until`), utána a fölösleg letölthető marad; 90 nap után
--     archívnak jelöljük (`archive_at`) — értesítéssel, továbbra sem törlünk.
-- A túllépés kezdetét az `over_quota_since` rögzíti; ha a használat a keret alá kerül, törlődik.

alter table public.storage_quotas add column if not exists over_quota_since timestamptz;
alter table public.storage_quotas add column if not exists grace_notified_at timestamptz;

create or replace function public.storage_grace_days()
returns integer language sql immutable set search_path = '' as $$ select 30; $$;
create or replace function public.storage_archive_days()
returns integer language sql immutable set search_path = '' as $$ select 90; $$;

-- a keret-számítás (változatlan logika) + a túllépés állapota
create or replace function public.storage_usage_for(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_used  bigint;
  v_tier  text;
  v_seats integer;
  v_base  bigint;
  v_addon bigint := 0;
  v_bonus bigint := 0;
  v_exp   timestamptz;
  v_quota bigint;
  v_since timestamptz;
begin
  select coalesce(sum(bytes), 0) into v_used from public.storage_objects where user_id = p_user;
  v_tier := public.active_tier_for(p_user);
  select seats into v_seats from public.subscriptions where user_id = p_user;
  v_seats := case when v_tier = 'business' then greatest(coalesce(v_seats, 2), 2) else 1 end;
  v_base := case
    when v_tier = 'free' then public.free_post_allowance_bytes()
    else public.gib(public.tier_storage_gb(v_tier)) * v_seats
  end;
  if v_tier <> 'free' then
    v_addon := public.gib(public.addon_storage_gb(p_user));
  end if;
  select bonus_bytes, bonus_expires_at, over_quota_since into v_bonus, v_exp, v_since
    from public.storage_quotas where user_id = p_user;
  if v_exp is null or v_exp <= now() then
    v_bonus := 0;
    v_exp := null;
  end if;
  v_bonus := coalesce(v_bonus, 0);
  v_quota := v_base + v_addon + v_bonus;

  -- a túllépés kezdetének karbantartása (az első észleléskor rögzül, a keret alatt törlődik)
  if v_used > v_quota and v_since is null then
    v_since := now();
    insert into public.storage_quotas (user_id, over_quota_since) values (p_user, v_since)
      on conflict (user_id) do update set over_quota_since = v_since, grace_notified_at = null;
  elsif v_used <= v_quota and v_since is not null then
    v_since := null;
    update public.storage_quotas set over_quota_since = null, grace_notified_at = null where user_id = p_user;
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'used_bytes', v_used,
    'base_bytes', v_base,
    'addon_bytes', v_addon,
    'bonus_bytes', v_bonus,
    'quota_bytes', v_quota,
    'bonus_expires_at', v_exp,
    'over_quota', v_used > v_quota,
    'over_quota_since', v_since,
    'grace_until', case when v_since is null then null else v_since + (public.storage_grace_days() || ' days')::interval end,
    'archive_at', case when v_since is null then null else v_since + (public.storage_archive_days() || ' days')::interval end
  );
end;
$$;
revoke all on function public.storage_usage_for(uuid) from public, anon, authenticated;
grant execute on function public.storage_usage_for(uuid) to service_role;

-- értesítés: a türelmi idő vége előtt 7 nappal (egyszer); a worker ütemezője hívja
create or replace function public.take_storage_grace_notices(p_now timestamptz default now())
returns table (user_id uuid, grace_until timestamptz, over_bytes bigint)
language plpgsql security definer set search_path = '' as $$
declare r record; u jsonb;
begin
  for r in select q.user_id, q.over_quota_since from public.storage_quotas q
            where q.over_quota_since is not null and q.grace_notified_at is null
              and q.over_quota_since + (public.storage_grace_days() || ' days')::interval <= p_now + interval '7 days'
            for update skip locked loop
    u := public.storage_usage_for(r.user_id);
    if (u ->> 'over_quota')::boolean then
      update public.storage_quotas set grace_notified_at = p_now where storage_quotas.user_id = r.user_id;
      user_id := r.user_id;
      grace_until := (u ->> 'grace_until')::timestamptz;
      over_bytes := (u ->> 'used_bytes')::bigint - (u ->> 'quota_bytes')::bigint;
      return next;
    end if;
  end loop;
end; $$;
revoke all on function public.take_storage_grace_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.take_storage_grace_notices(timestamptz) to service_role;
