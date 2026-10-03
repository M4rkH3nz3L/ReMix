-- 🧱 Moderation (devs/tasks/remix/10 + 16): a moderátor OLVASHASSA a bejelentett
-- üzenet tartalmát a moderation-queue-ban.
--
-- A `messages` RLS tagság-alapú → a moderátor (ha nem tagja a beszélgetésnek) nem
-- látja a reportolt üzenetet, így vakon kellene dönteni. Ez az additív policy
-- SZŰKEN enged: a `report.review` jog birtokosa CSAK azt az üzenetet olvashatja,
-- amelyre VAN report-sor (nem a teljes DM-forgalmat) → privacy-tudatos moderáció.

drop policy if exists "messages_select_reported_moderator" on public.messages;
create policy "messages_select_reported_moderator" on public.messages
  for select to authenticated
  using (
    public.has_permission(auth.uid(), 'report.review')
    and exists (
      select 1 from public.reports r where r.message_id = messages.id
    )
  );
