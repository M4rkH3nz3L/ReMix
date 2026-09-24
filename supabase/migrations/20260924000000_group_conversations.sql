-- 👥 Csoportos DM — a meglévő üzenet-infrastruktúra N-tagú kiterjesztése.
--
-- A conversation_members már N tagot bír, az RLS (is_conversation_member) és a
-- realtime is működik tetszőleges taglétszámra — csak a 'group' fajta + a csoport-
-- név + a létrehozó/tag-kezelő RPC-k hiányoztak. A tagfelvétel továbbra is
-- SECURITY DEFINER RPC-ken megy (atomi, jogosultság-ellenőrzött).

-- ── 'group' fajta + csoport-név + létrehozó ─────────────────────────────────
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check check (kind in ('dm', 'project', 'group'));
alter table public.conversations add column if not exists title text;
alter table public.conversations add column if not exists created_by uuid;

-- ── RPC: csoport létrehozása (név + kezdő tagok) ────────────────────────────
create or replace function public.create_group_conversation(p_title text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
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
  -- a létrehozó mindig tag
  insert into public.conversation_members (conversation_id, user_id) values (v_conv, v_me);
  -- kezdő tagok (a létrehozót kihagyva, duplikátum-védetten)
  if p_members is not null then
    foreach v_member in array p_members loop
      if v_member is not null and v_member <> v_me then
        insert into public.conversation_members (conversation_id, user_id)
          values (v_conv, v_member)
          on conflict (conversation_id, user_id) do nothing;
      end if;
    end loop;
  end if;
  return v_conv;
end;
$$;
revoke all on function public.create_group_conversation(text, uuid[]) from public, anon;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

-- ── RPC: tag hozzáadása egy csoporthoz (csak meglévő tag adhat hozzá) ────────
create or replace function public.add_group_member(p_conv uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conv) then
    raise exception 'add_group_member: nem vagy a beszélgetés tagja';
  end if;
  if p_user is null then
    return;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
    values (p_conv, p_user)
    on conflict (conversation_id, user_id) do nothing;
end;
$$;
revoke all on function public.add_group_member(uuid, uuid) from public, anon;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

-- ── RPC: kilépés a beszélgetésből (a saját tagságom törlése) ─────────────────
create or replace function public.leave_conversation(p_conv uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.conversation_members
   where conversation_id = p_conv and user_id = auth.uid();
$$;
revoke all on function public.leave_conversation(uuid) from public, anon;
grant execute on function public.leave_conversation(uuid) to authenticated;

-- ── RPC: csoport átnevezése (csak tag) ──────────────────────────────────────
create or replace function public.rename_group(p_conv uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_conversation_member(p_conv) then
    raise exception 'rename_group: nem vagy a beszélgetés tagja';
  end if;
  update public.conversations
     set title = nullif(trim(coalesce(p_title, '')), '')
   where id = p_conv and kind = 'group';
end;
$$;
revoke all on function public.rename_group(uuid, text) from public, anon;
grant execute on function public.rename_group(uuid, text) to authenticated;
