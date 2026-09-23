-- 💬 Realtime üzenetküldés (DM + projekt-scoped collab-chat).
--
-- Egy beszélgetés (`conversations`) VAGY közvetlen (kind='dm', két tag), VAGY egy
-- megosztott projekthez kötött (kind='project', owner_id+project_id → a collab-
-- chat). A tagságot a `conversation_members` hordozza (last_read_at → olvasatlan-
-- szám), az üzeneteket a `messages` (denormalizált feladó, mint a kommenteknél).
--
-- Az olvasás/írás RLS-e a tagságtól függ; a REKURZIÓT (messages ↔ members) egy
-- SECURITY DEFINER helper (`is_conversation_member`) töri meg — a definer az RLS-t
-- megkerülve olvassa a tagságot, de az auth.uid() a HÍVÓ-é marad. A beszélgetés
-- LÉTREHOZÁSA két RPC-n megy (get_or_create_dm / _project_conversation), hogy a
-- két tag felvétele atomi és jogosultság-ellenőrzött legyen.
--
-- Ingyenes funkció (adatbiztonság: a collab már ingyen — a chat is).

-- ── táblák ──────────────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('dm', 'project')),
  -- projekt-beszélgetésnél a megosztott projekt kulcsa (különben null)
  owner_id             uuid,
  project_id           text,
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  last_sender_id       uuid,
  created_at           timestamptz not null default now()
);
-- egy projekthez PONTOSAN egy beszélgetés
create unique index if not exists conversations_project_uidx
  on public.conversations (owner_id, project_id)
  where kind = 'project';
create index if not exists conversations_recent_idx
  on public.conversations (last_message_at desc);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid not null references auth.users (id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 4000),
  kind             text not null default 'text' check (kind in ('text', 'system')),
  -- denormalizált feladó (nincs cross-profil olvasás — mint a posztnál/kommentnél)
  sender_username  text,
  sender_name      text,
  sender_avatar    text,
  created_at       timestamptz not null default now()
);
create index if not exists messages_conv_idx
  on public.messages (conversation_id, created_at desc);

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

-- ── segéd: tagja vagyok-e a beszélgetésnek? (RLS-rekurzió-törő) ──────────────
create or replace function public.is_conversation_member(p_conv uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (public.is_conversation_member(id));

drop policy if exists "conv_members_select" on public.conversation_members;
create policy "conv_members_select" on public.conversation_members
  for select using (public.is_conversation_member(conversation_id));

-- a saját tagságom frissítése (last_read_at → olvasottság)
drop policy if exists "conv_members_update_own" on public.conversation_members;
create policy "conv_members_update_own" on public.conversation_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "messages_select" on public.messages;
create policy "messages_select" on public.messages
  for select using (public.is_conversation_member(conversation_id));

-- csak a saját nevemben, csak olyan beszélgetésbe, aminek tagja vagyok
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert with check (
    sender_id = auth.uid() and public.is_conversation_member(conversation_id)
  );

-- a feladó törölheti/szerkesztheti a sajátját (visszavonás/javítás)
drop policy if exists "messages_modify_own" on public.messages;
create policy "messages_modify_own" on public.messages
  for delete using (sender_id = auth.uid());

-- ── RPC: DM megnyitása/létrehozása (pontosan két tag) ───────────────────────
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
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
  -- létező DM pontosan e két taggal
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
  insert into public.conversations (kind) values ('dm') returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id)
    values (v_conv, v_me), (v_conv, p_other);
  return v_conv;
end;
$$;
revoke all on function public.get_or_create_dm(uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- ── RPC: projekt-beszélgetés (collab-chat) megnyitása/létrehozása ────────────
-- a hívó csak akkor csatlakozhat, ha a projekt TAGJA (owner vagy project_members)
create or replace function public.get_or_create_project_conversation(p_owner uuid, p_project text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null then
    raise exception 'projekt-beszélgetés: bejelentkezés szükséges';
  end if;
  if not (p_owner = v_me
          or public.project_role(p_owner, p_project, v_me) is not null) then
    raise exception 'projekt-beszélgetés: nem vagy a projekt tagja';
  end if;
  select id into v_conv
    from public.conversations
   where kind = 'project' and owner_id = p_owner and project_id = p_project
   limit 1;
  if v_conv is null then
    insert into public.conversations (kind, owner_id, project_id)
      values ('project', p_owner, p_project)
      returning id into v_conv;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
    values (v_conv, v_me)
    on conflict (conversation_id, user_id) do nothing;
  return v_conv;
end;
$$;
revoke all on function public.get_or_create_project_conversation(uuid, text) from public, anon;
grant execute on function public.get_or_create_project_conversation(uuid, text) to authenticated;

-- ── RPC: beszélgetés olvasottra állítása ────────────────────────────────────
create or replace function public.mark_conversation_read(p_conv uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conv and user_id = auth.uid();
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ── trigger: új üzenet → beszélgetés-fejléc frissítés + értesítés a többieknek ─
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(new.body, 120),
         last_sender_id       = new.sender_id
   where id = new.conversation_id;

  -- értesítés minden MÁS tagnak (a feladónak nem). SECURITY DEFINER → cross-user
  -- insert a notifications-be (a notifications_insert_own RLS-t megkerüli).
  insert into public.notifications (user_id, type, title, body, route, data)
  select m.user_id,
         'message',
         coalesce(nullif(new.sender_name, ''), 'Új üzenet') || ' 💬',
         left(new.body, 80),
         '/chat/' || new.conversation_id::text,
         jsonb_build_object('conversationId', new.conversation_id, 'kind', 'message')
    from public.conversation_members m
   where m.conversation_id = new.conversation_id
     and m.user_id <> new.sender_id;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.on_message_insert();

-- 🔴 realtime: élő üzenetek + beszélgetés-fejléc (inbox rendezés/preview)
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
