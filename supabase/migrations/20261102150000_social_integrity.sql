-- 🔐 PRO-SOCIAL S19, S22, S23, S25, S27: nézettség, remix-eredet, felfüggesztés, felhasználónév, élő adás.

-- ── S19: egy néző naponta egyszer számít, csak látható posztra ────────────
create table if not exists public.post_view_seen (
  post_id uuid not null references public.posts (id) on delete cascade,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  primary key (post_id, viewer_id, day)
);
alter table public.post_view_seen enable row level security;

create or replace function public.record_post_view(p_post uuid)
returns void language plpgsql security definer set search_path to ''
as $$
declare
  promo record;
  v_me uuid := auth.uid();
  v_new int;
begin
  -- kijelentkezve nincs mihez kötni a számolást: a promóciós keretet ne terhelje script
  if v_me is null then
    return;
  end if;
  if not exists (
    select 1 from public.posts p
    where p.id = p_post and p.creator_id <> v_me and p.moderation_status <> 'removed'
      and (p.visibility = 'public' or (p.visibility = 'followers' and public.viewer_follows(p.creator_id)))
      and not public.is_deleted(p.creator_id) and not public.blocked_between(v_me, p.creator_id)
  ) then
    return;
  end if;
  insert into public.post_view_seen (post_id, viewer_id) values (p_post, v_me) on conflict do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return;
  end if;

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

drop policy if exists view_events_insert_own on public.post_view_events;
create policy view_events_insert_own on public.post_view_events for insert to authenticated
  with check (viewer_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_view_events.post_id));

-- az alkotó statisztikát kap, azt nem, hogy ki nézte
drop policy if exists view_events_select_owner_or_self on public.post_view_events;
create policy view_events_select_own on public.post_view_events for select to authenticated
  using (viewer_id = auth.uid());

create or replace function public.post_view_stats(p_post uuid)
returns table (post_id uuid, viewer_key uuid, watched_ms int, duration_ms int)
language sql stable security definer set search_path to ''
as $$
  select e.post_id, md5(e.post_id::text || e.viewer_id::text)::uuid, e.watched_ms::int, e.duration_ms::int
    from public.post_view_events e
    join public.posts p on p.id = e.post_id
   where e.post_id = p_post and p.creator_id = auth.uid();
$$;
revoke all on function public.post_view_stats(uuid) from public, anon;
grant execute on function public.post_view_stats(uuid) to authenticated;

-- ── S22: moderátori döntés nem írható felül, az eredet neve valódi ────────
alter table public.posts add column if not exists removed_by_moderator boolean not null default false;

create or replace function public.moderate_remix(p_remix uuid, p_status text)
returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_source uuid;
  v_mod boolean;
begin
  if p_status not in ('ok', 'removed') then
    raise exception 'moderate_remix: érvénytelen státusz %', p_status;
  end if;
  select remix_of_post_id, removed_by_moderator into v_source, v_mod from public.posts where id = p_remix;
  if v_source is null then
    raise exception 'moderate_remix: a poszt nem remix';
  end if;
  if not exists (select 1 from public.posts where id = v_source and creator_id = auth.uid()) then
    raise exception 'moderate_remix: nincs jogosultság';
  end if;
  if v_mod then
    raise exception 'moderate_remix: moderátori döntés nem módosítható';
  end if;
  update public.posts set moderation_status = p_status where id = p_remix;
end;
$$;

create or replace function public.posts_mark_moderated()
returns trigger language plpgsql
as $$
begin
  -- a moderate_post a report/post jogosultsággal fut; a forrás-tulaj útja a moderate_remix
  if new.moderation_status = 'removed' and old.moderation_status <> 'removed'
     and public.has_permission(auth.uid(), 'post.moderate') then
    new.removed_by_moderator := true;
  elsif new.moderation_status = 'ok' and old.moderation_status <> 'ok' then
    new.removed_by_moderator := false;
  end if;
  return new;
end $$;

drop trigger if exists posts_mark_moderated on public.posts;
create trigger posts_mark_moderated before update of moderation_status on public.posts
  for each row execute function public.posts_mark_moderated();

create or replace function public.posts_server_fields()
returns trigger language plpgsql
as $$
declare v record;
begin
  if not public.is_client_request() then
    return new;
  end if;
  select * into v from public.profile_identity(new.creator_id);
  new.creator_username := v.username;
  new.creator_name := v.name;
  new.creator_avatar := v.avatar;
  new.moderation_status := 'ok';
  new.removed_by_moderator := false;
  new.promoted := false;
  new.likes := 0;
  new.comments := 0;
  new.saves := 0;
  new.views := 0;
  new.remixes := 0;
  new.created_at := now();
  new.remix_of_creator := case
    when new.remix_of_post_id is null then null
    else public.post_creator_name(new.remix_of_post_id)
  end;
  return new;
end $$;

create or replace function public.post_creator_name(p_post uuid)
returns text language sql stable security definer set search_path to ''
as $$ select creator_name from public.posts where id = p_post $$;

create or replace function public.enforce_remix_permission()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  src_creator uuid;
  src_remixable boolean;
  src_visibility text;
begin
  if new.remix_of_post_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.remix_of_post_id is not distinct from old.remix_of_post_id then
    return new;
  end if;
  select p.creator_id, p.remixable, p.visibility
    into src_creator, src_remixable, src_visibility
    from public.posts p
   where p.id = new.remix_of_post_id;
  if not found then
    return new; -- a forrás törölve (az FK on delete set null kezeli)
  end if;
  if src_creator = new.creator_id then
    return new; -- saját poszt remixe
  end if;
  if src_remixable is not true or src_visibility = 'private' or public.blocked_between(new.creator_id, src_creator) then
    raise exception 'remix_not_allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ── S23: a felfüggesztés valódi hatású ────────────────────────────────────
alter table public.profiles add column if not exists suspended_at timestamptz;

create or replace function public.is_deleted(p_uid uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and (deleted_at is not null or suspended_at is not null)
  );
$$;

create table if not exists public.admin_actions (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now()
);
alter table public.admin_actions enable row level security;
create policy admin_actions_read on public.admin_actions for select to authenticated
  using (public.has_permission(auth.uid(), 'user.suspend'));

create or replace function public.admin_set_user_suspended(p_user uuid, p_suspended boolean)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  if not public.has_permission(auth.uid(), 'user.suspend') then
    raise exception 'admin_set_user_suspended: nincs jogosultság';
  end if;
  if p_user = auth.uid() then
    raise exception 'admin_set_user_suspended: magadat nem függesztheted fel';
  end if;
  update auth.users
     set banned_until = case when p_suspended then now() + interval '100 years' else null end
   where id = p_user;
  update public.profiles set suspended_at = case when p_suspended then now() end where id = p_user;
  if p_suspended then
    -- a kiadott munkamenet nem újítható tovább
    delete from auth.sessions where user_id = p_user;
  end if;
  insert into public.admin_actions (actor_id, action, target_id)
    values (auth.uid(), case when p_suspended then 'user.suspend' else 'user.unsuspend' end, p_user);
end;
$$;

-- ── S25: felhasználónév a szerveren ───────────────────────────────────────
create or replace function public.valid_username(p_name text)
returns boolean language sql immutable
as $$
  select p_name ~ '^[a-zA-Z][a-zA-Z0-9_]{2,19}$'
    and lower(p_name) not in ('admin', 'administrator', 'remix', 'support', 'moderator', 'system', 'root', 'help', 'official', 'staff');
$$;

-- a profil védett mezői; a régi, szabálytalan név a többi mező szerkesztését nem akadályozza
create or replace function public.profiles_guard()
returns trigger language plpgsql
as $$
begin
  if not public.is_client_request() then
    return new;
  end if;
  if new.suspended_at is distinct from old.suspended_at then
    raise exception 'A felfüggesztés nem módosítható.';
  end if;
  if new.username is distinct from old.username and not public.valid_username(new.username) then
    raise exception 'Érvénytelen felhasználónév.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.gen_unique_username(p_base text)
returns text language plpgsql set search_path to ''
as $$
declare
  v_base text;
  v_try  text;
  v_i    int := 0;
begin
  v_base := lower(regexp_replace(coalesce(p_base, ''), '[^a-zA-Z0-9_]', '', 'g'));
  if v_base !~ '^[a-z]' then
    v_base := 'user' || v_base;
  end if;
  if length(v_base) < 3 then
    v_base := v_base || '_user';
  end if;
  v_base := left(v_base, 15);
  v_try := v_base;
  loop
    exit when public.valid_username(v_try) and not exists (
      select 1 from public.profiles where lower(username) = lower(v_try)
    );
    v_i := v_i + 1;
    v_try := v_base || v_i::text;
  end loop;
  return v_try;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare
  v_username text := nullif(new.raw_user_meta_data ->> 'username', '');
begin
  -- a foglalt vagy szabálytalan név nem buktathatja el a regisztrációt
  if v_username is null or not public.valid_username(v_username)
     or exists (select 1 from public.profiles where lower(username) = lower(v_username)) then
    v_username := public.gen_unique_username(coalesce(v_username, split_part(coalesce(new.email, ''), '@', 1)));
  end if;

  insert into public.profiles (id, full_name, phone, birthday, country, city, username)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'birthday', '')::date,
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    v_username
  )
  on conflict (id) do nothing;

  -- 📜 GDPR: a regisztrációkor adott hozzájárulás rögzítése (ha a kliens küldte)
  if nullif(new.raw_user_meta_data ->> 'consent_version', '') is not null then
    insert into public.user_consents (user_id, kind, version)
    values (new.id, 'terms_privacy', new.raw_user_meta_data ->> 'consent_version');
  end if;

  return new;
end;
$$;

-- ── S27: élő adás láthatósága ─────────────────────────────────────────────
alter table public.live_sessions
  add column if not exists visibility text not null default 'public' check (visibility in ('public', 'followers', 'unlisted'));

drop policy if exists live_select on public.live_sessions;
drop policy if exists live_select_public on public.live_sessions;
create policy live_select on public.live_sessions for select
  using (
    host_id = auth.uid()
    or (status = 'live' and (visibility <> 'followers' or public.viewer_follows(host_id)))
  );
