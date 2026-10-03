-- 🧱 Messaging safety — AUDIT-követő javítások (devs/tasks/remix/10):
--   #1 conversation_mutes ENFORCE: a némított tag ne kapjon message-notification-t
--      (eddig a tábla létezett, de a notify-trigger figyelmen kívül hagyta → a mute
--      semmit nem némított).
--   #2 BLOCK kétirányú DM-tiltás: eddig a restrictive policy csak akkor tiltott, ha a
--      CÍMZETT tiltotta le a feladót. Így a blokkoló MÉG DM-elhetett a blokkoltnak.
--      Mostantól BÁRMELY irányú blokk (A↔B) tiltja a küldést a két fél között.

-- ── #1: on_message_insert() — a némított tagoknak NE szóljon ──────────────────
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

  -- értesítés minden MÁS tagnak (a feladónak nem), KIVÉVE akik NÉMÍTOTTÁK a
  -- beszélgetést. SECURITY DEFINER → cross-user insert a notifications-be.
  insert into public.notifications (user_id, type, title, body, route, data)
  select m.user_id,
         'message',
         coalesce(nullif(new.sender_name, ''), 'Új üzenet') || ' 💬',
         left(new.body, 80),
         '/chat/' || new.conversation_id::text,
         jsonb_build_object('conversationId', new.conversation_id, 'kind', 'message')
    from public.conversation_members m
   where m.conversation_id = new.conversation_id
     and m.user_id <> new.sender_id
     and not exists (
       select 1 from public.conversation_mutes cm
       where cm.user_id = m.user_id
         and cm.conversation_id = new.conversation_id
     );
  return new;
end;
$$;
-- a trigger maga változatlan (a függvényt cseréltük); a kötés megmarad

-- ── #2: messages_not_from_blocked — KÉTIRÁNYÚ ────────────────────────────────
-- A küldés tiltott, ha a feladó és a beszélgetés BÁRMELY másik tagja között
-- VAN blokk-él (akár a feladó tiltotta a másikat, akár fordítva).
drop policy if exists "messages_not_from_blocked" on public.messages;
create policy "messages_not_from_blocked" on public.messages
  as restrictive
  for insert to authenticated
  with check (
    not exists (
      select 1
      from public.conversation_members cm
      join public.user_blocks b
        on (
          (b.blocker_id = cm.user_id and b.blocked_id = auth.uid())
          or (b.blocker_id = auth.uid() and b.blocked_id = cm.user_id)
        )
      where cm.conversation_id = messages.conversation_id
        and cm.user_id <> auth.uid()
    )
  );
