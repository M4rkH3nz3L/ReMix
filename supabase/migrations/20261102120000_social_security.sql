-- 🔐 PRO-SOCIAL S1, S3–S6, S10–S13, S16, S20: a kliens csak a saját, szerkeszthető adatát írhatja.
-- Elv: a szerver-oldali mezők (számlálók, moderáció, szerző neve, időbélyeg) nem jöhetnek a klienstől.
-- A triggerek a kliens-szerepkörre hatnak; a SECURITY DEFINER függvények és a service_role érintetlen.

create or replace function public.is_client_request()
returns boolean language sql stable
as $$ select current_user in ('authenticated', 'anon') $$;

create or replace function public.blocked_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- a szerző nyilvános adatai mindig a profilból jönnek
create or replace function public.profile_identity(p_user uuid, out username text, out name text, out avatar text)
language sql stable security definer set search_path to ''
as $$
  select p.username, coalesce(nullif(trim(p.full_name), ''), p.username), p.avatar_url
  from public.profiles p where p.id = p_user;
$$;

-- ── S1: poszt ─────────────────────────────────────────────────────────────
revoke update on public.posts from anon, authenticated;
grant update (title, description, hashtags, visibility, remixable, music) on public.posts to authenticated;

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
  new.promoted := false;
  new.likes := 0;
  new.comments := 0;
  new.saves := 0;
  new.views := 0;
  new.remixes := 0;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists posts_server_fields on public.posts;
create trigger posts_server_fields before insert on public.posts
  for each row execute function public.posts_server_fields();

-- a profil változása a korábbi posztokon és kommenteken is látszik (a kliens már nem írhatja)
create or replace function public.profile_sync_identity()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_name text := coalesce(nullif(trim(new.full_name), ''), new.username);
begin
  update public.posts
     set creator_username = new.username, creator_name = v_name, creator_avatar = new.avatar_url
   where creator_id = new.id;
  update public.post_comments
     set author_username = new.username, author_name = v_name, author_avatar = new.avatar_url
   where author_id = new.id;
  return new;
end $$;

drop trigger if exists profile_sync_identity on public.profiles;
create trigger profile_sync_identity after update of full_name, username, avatar_url on public.profiles
  for each row
  when (old.full_name is distinct from new.full_name or old.username is distinct from new.username or old.avatar_url is distinct from new.avatar_url)
  execute function public.profile_sync_identity();

-- ── S3: tagság ────────────────────────────────────────────────────────────
revoke update on public.conversation_members from anon, authenticated;
grant update (last_read_at) on public.conversation_members to authenticated;

-- ── S4 + S13: meghívás ────────────────────────────────────────────────────
create or replace function public.add_group_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  if not public.is_conversation_member(p_conv) then
    raise exception 'add_group_member: nem vagy a beszélgetés tagja';
  end if;
  if p_user is null then
    return;
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conv and c.kind = 'group') then
    raise exception 'add_group_member: csak csoportba lehet meghívni';
  end if;
  if public.blocked_between(auth.uid(), p_user) then
    raise exception 'add_group_member: a felhasználó nem hívható meg';
  end if;
  insert into public.conversation_members (conversation_id, user_id)
    values (p_conv, p_user)
    on conflict (conversation_id, user_id) do nothing;
end;
$$;

create or replace function public.create_group_conversation(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  v_me     uuid := auth.uid();
  v_conv   uuid;
  v_member uuid;
begin
  if v_me is null then
    raise exception 'csoport: bejelentkezés szükséges';
  end if;
  insert into public.conversations (kind, title, created_by)
    values ('group', nullif(trim(coalesce(p_title, '')), ''), v_me)
    returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id) values (v_conv, v_me);
  if p_members is not null then
    foreach v_member in array p_members loop
      if v_member is not null and v_member <> v_me and not public.blocked_between(v_me, v_member) then
        insert into public.conversation_members (conversation_id, user_id)
          values (v_conv, v_member)
          on conflict (conversation_id, user_id) do nothing;
      end if;
    end loop;
  end if;
  return v_conv;
end;
$$;

create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path to ''
as $$
declare
  v_me   uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null then
    raise exception 'get_or_create_dm: bejelentkezés szükséges';
  end if;
  if p_other is null or p_other = v_me then
    raise exception 'get_or_create_dm: érvénytelen partner';
  end if;
  select c.id into v_conv
    from public.conversations c
   where c.kind = 'dm'
     and exists (select 1 from public.conversation_members m
                  where m.conversation_id = c.id and m.user_id = v_me)
     and exists (select 1 from public.conversation_members m
                  where m.conversation_id = c.id and m.user_id = p_other)
     and (select count(*) from public.conversation_members m
           where m.conversation_id = c.id) = 2
   limit 1;
  if v_conv is not null then
    return v_conv;
  end if;
  if public.blocked_between(v_me, p_other) then
    raise exception 'get_or_create_dm: a felhasználó nem érhető el';
  end if;
  insert into public.conversations (kind) values ('dm') returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id)
    values (v_conv, v_me), (v_conv, p_other);
  return v_conv;
end;
$$;

-- ── S5: a projektből eltávolított tag a projekt-chatből is kikerül ────────
create or replace function public.project_member_left()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  delete from public.conversation_members m
   using public.conversations c
   where m.conversation_id = c.id and m.user_id = old.member_id
     and c.kind = 'project' and c.owner_id = old.owner_id and c.project_id = old.project_id;
  return old;
end $$;

-- a tulaj külön tag-sor nélkül is látja a projekt tagjait, különben nem tudna eltávolítani senkit
drop policy if exists members_select_shared on public.project_members;
create policy members_select_shared on public.project_members for select
  using (owner_id = auth.uid() or member_id = auth.uid() or public.project_role(owner_id, project_id, auth.uid()) is not null);

drop trigger if exists project_member_left on public.project_members;
create trigger project_member_left after delete on public.project_members
  for each row execute function public.project_member_left();

-- ── S6: a projekt tulajdonosa és azonosítója nem írható át ────────────────
create or replace function public.cloud_projects_keep_owner()
returns trigger language plpgsql
as $$
begin
  if public.is_client_request() and (new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id) then
    raise exception 'A projekt tulajdonosa nem módosítható.';
  end if;
  return new;
end $$;

drop trigger if exists cloud_projects_keep_owner on public.cloud_projects;
create trigger cloud_projects_keep_owner before update on public.cloud_projects
  for each row execute function public.cloud_projects_keep_owner();

-- ── S10: üzenet ───────────────────────────────────────────────────────────
create or replace function public.messages_server_fields()
returns trigger language plpgsql
as $$
declare v record;
begin
  if not public.is_client_request() then
    return new;
  end if;
  -- rendszersor csak a projekt-szoba naplójába kerülhet, személyes beszélgetésbe nem
  if new.kind = 'system' and not exists (select 1 from public.conversations c where c.id = new.conversation_id and c.kind = 'project') then
    raise exception 'Rendszerüzenet csak projekt-szobába írható.';
  end if;
  select * into v from public.profile_identity(new.sender_id);
  new.sender_username := v.username;
  new.sender_name := v.name;
  new.sender_avatar := v.avatar;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists messages_server_fields on public.messages;
create trigger messages_server_fields before insert on public.messages
  for each row execute function public.messages_server_fields();

-- ── S11: komment ──────────────────────────────────────────────────────────
revoke update on public.post_comments from anon, authenticated;
grant update (body) on public.post_comments to authenticated;

create or replace function public.comments_server_fields()
returns trigger language plpgsql
as $$
declare v record;
begin
  if not public.is_client_request() then
    return new;
  end if;
  select * into v from public.profile_identity(new.author_id);
  new.author_username := v.username;
  new.author_name := v.name;
  new.author_avatar := v.avatar;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists comments_server_fields on public.post_comments;
create trigger comments_server_fields before insert on public.post_comments
  for each row execute function public.comments_server_fields();

-- ── S12: a blokk két irányban véd a személyes beszélgetésben ──────────────
drop policy if exists messages_not_from_blocked on public.messages;
create policy messages_not_from_blocked on public.messages as restrictive for insert to authenticated
  with check (
    not exists (
      select 1
      from public.conversations c
      join public.conversation_members cm on cm.conversation_id = c.id
      where c.id = messages.conversation_id and c.kind = 'dm'
        and cm.user_id <> auth.uid() and public.blocked_between(auth.uid(), cm.user_id)
    )
  );

-- ── S16: csak látott üzenet jelenthető, a státusz nem a jelentőé ──────────
revoke insert on public.reports from anon, authenticated;
grant insert (reporter_id, target_type, post_id, comment_id, message_id, reason, note) on public.reports to authenticated;

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and (message_id is null or exists (
      select 1 from public.messages m
      where m.id = reports.message_id and public.is_conversation_member(m.conversation_id)
    ))
  );

-- ── S20: lájk, mentés, gyűjtemény csak látható posztra ────────────────────
drop policy if exists likes_write_own on public.post_likes;
create policy likes_insert_visible on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_likes.post_id));
create policy likes_update_own on public.post_likes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy likes_delete_own on public.post_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists saves_write_own on public.post_saves;
create policy saves_insert_visible on public.post_saves for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_saves.post_id));
create policy saves_update_own on public.post_saves for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saves_delete_own on public.post_saves for delete to authenticated using (user_id = auth.uid());

drop policy if exists collection_items_write_own on public.post_collection_items;
create policy collection_items_insert_visible on public.post_collection_items for insert to authenticated
  with check (
    exists (select 1 from public.post_collections c where c.id = post_collection_items.collection_id and c.user_id = auth.uid())
    and exists (select 1 from public.posts p where p.id = post_collection_items.post_id)
  );
create policy collection_items_update_own on public.post_collection_items for update to authenticated
  using (exists (select 1 from public.post_collections c where c.id = post_collection_items.collection_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.post_collections c where c.id = post_collection_items.collection_id and c.user_id = auth.uid()));
create policy collection_items_delete_own on public.post_collection_items for delete to authenticated
  using (exists (select 1 from public.post_collections c where c.id = post_collection_items.collection_id and c.user_id = auth.uid()));
