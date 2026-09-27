-- 🛡️ RBAC bővítés — governance-jogok a MEGLÉVŐ funkciókra (TikTok-modell).
--
-- Alapelv VÁLTOZATLAN: a saját tartalmadhoz MINDIG teljes jogod van (ownership/
-- membership policy), MÁSÉHOZ csak kiosztott GLOBÁLIS governance-joggal
-- (has_permission) — a kettőt az RLS VAGY-ozza. Ez a réteg a „másénál kaphat
-- jogot" ág, TikTok-szerűen: Néző → Alkotó → Moderátor → Admin.
--
-- Amit ez a migráció csinál:
--  (1) kibővíti a jog-katalógust a lefedetlen funkciókra (üzenet-/shop-moderáció,
--      user-felfüggesztés),
--  (2) BEKÖTI a project.moderate-et (eddig csak katalógusban volt, sehol sem hatott),
--  (3) az `admin` szerepnek MINDEN jogot ad (az újakat is), a `moderator`-nak a
--      tartalom+közösség moderációt.
-- Idempotens: minden insert on-conflict, a policyk drop+create.

-- ── 1) ÚJ jogok a katalógusba (a meglévő 7 mellé) ─────────────────────────────
insert into public.app_permissions (key, label, description, sort) values
  ('message.moderate', 'Bármely üzenet moderálása',
   'Bejelentett chat-üzenet törlése bármely beszélgetésben (a privát tartalmat NEM böngészi végig — csak törlésre jogosít).', 25),
  ('shop.moderate', 'Bármely shop-tétel kezelése',
   'Szabálysértő piactér-tétel elrejtése/eltávolítása/áttekintése (nem csak a sajátod).', 45),
  ('user.suspend', 'Felhasználó felfüggesztése',
   'Fiók tiltása/feloldása (belépés blokkolása) governance-ban — az érintett magától nem oldhatja fel.', 65)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, sort = excluded.sort;

-- ── 2) admin = MINDEN jog (a most beszúrt új kulcsok is rákötődnek) ───────────
insert into public.role_permissions (role_slug, permission_key)
  select 'admin', key from public.app_permissions
on conflict do nothing;

-- ── 3) moderator: tartalom + közösség moderáció (a meglévő post/comment/report mellé) ─
insert into public.role_permissions (role_slug, permission_key) values
  ('moderator', 'message.moderate'),
  ('moderator', 'shop.moderate')
on conflict do nothing;

-- ── 4) message.moderate → üzenet-TÖRLÉS bármely beszélgetésben ────────────────
-- (a SELECT szándékosan VÁLTOZATLAN: a privát DM-eket senki nem böngészi végig)
drop policy if exists "messages_modify_own" on public.messages;
create policy "messages_modify_own" on public.messages
  for delete using (
    sender_id = auth.uid()
    or public.has_permission(auth.uid(), 'message.moderate')
  );

-- ── 5) shop.moderate → tétel láthatóság / módosítás / törlés ──────────────────
drop policy if exists "shop_items_select" on public.shop_items;
create policy "shop_items_select" on public.shop_items
  for select using (
    status = 'published'
    or seller_id = auth.uid()
    or public.has_permission(auth.uid(), 'shop.moderate')
  );
drop policy if exists "shop_items_update_own" on public.shop_items;
create policy "shop_items_update_own" on public.shop_items
  for update using (
    seller_id = auth.uid()
    or public.has_permission(auth.uid(), 'shop.moderate')
  ) with check (
    seller_id = auth.uid()
    or public.has_permission(auth.uid(), 'shop.moderate')
  );
drop policy if exists "shop_items_delete_own" on public.shop_items;
create policy "shop_items_delete_own" on public.shop_items
  for delete using (
    seller_id = auth.uid()
    or public.has_permission(auth.uid(), 'shop.moderate')
  );

-- ── 6) project.moderate BEKÖTÉSE — admin BÁRMELY megosztott projektet lát/kezel ─
drop policy if exists "cloud_projects_select_member" on public.cloud_projects;
create policy "cloud_projects_select_member" on public.cloud_projects
  for select using (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) is not null
    or public.has_permission(auth.uid(), 'project.moderate')
  );
drop policy if exists "cloud_projects_update_member" on public.cloud_projects;
create policy "cloud_projects_update_member" on public.cloud_projects
  for update using (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) in ('owner', 'editor')
    or public.has_permission(auth.uid(), 'project.moderate')
  ) with check (
    auth.uid() = user_id
    or public.project_role(user_id, project_id, auth.uid()) in ('owner', 'editor')
    or public.has_permission(auth.uid(), 'project.moderate')
  );
drop policy if exists "members_delete_owner_or_self" on public.project_members;
create policy "members_delete_owner_or_self" on public.project_members
  for delete using (
    owner_id = auth.uid()
    or member_id = auth.uid()
    or public.has_permission(auth.uid(), 'project.moderate')
  );

-- ── 7) user.suspend → fiók-tiltás RPC ────────────────────────────────────────
-- GoTrue `banned_until`-t állít (belépés/token-refresh blokk). Messze-jövő finit
-- timestamp (NEM 'infinity' — azt a GoTrue Go-time nem mindig parse-olja). Az
-- érintett magától NEM oldhatja fel (nincs kliens-írás az auth.users-re). Magadat
-- nem tilthatod. A `user.suspend` jog birtokosa hívhatja.
create or replace function public.admin_set_user_suspended(p_user uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path = ''
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
end;
$$;
revoke all on function public.admin_set_user_suspended(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_suspended(uuid, boolean) to authenticated;
