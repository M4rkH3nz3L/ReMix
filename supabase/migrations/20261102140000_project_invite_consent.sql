-- 🔐 PRO-SOCIAL S18: a meghívás nem tesz azonnal taggá. Elfogadásig `invited`, és a jogosultság
-- egyetlen kapuja (`project_role`) csak az `active` tagot látja. A meglévő tagok aktívak maradnak.
alter table public.project_members
  add column if not exists status text not null default 'active' check (status in ('invited', 'active'));

create or replace function public.project_role(p_owner uuid, p_project text, p_uid uuid)
returns text language sql stable security definer set search_path to ''
as $$
  select role
    from public.project_members
   where owner_id = p_owner
     and project_id = p_project
     and member_id = p_uid
     and status = 'active'
   limit 1;
$$;

-- minden új tag meghívott, bármelyik úton jön (kliens, worker, regisztrációkori beváltás)
create or replace function public.project_member_invited()
returns trigger language plpgsql
as $$
begin
  if new.member_id <> new.owner_id then
    new.status := 'invited';
  end if;
  return new;
end $$;

drop trigger if exists project_member_invited on public.project_members;
create trigger project_member_invited before insert on public.project_members
  for each row execute function public.project_member_invited();

create or replace function public.project_member_keep_status()
returns trigger language plpgsql
as $$
begin
  if public.is_client_request() and new.status is distinct from old.status then
    raise exception 'A tagság állapota csak a meghívott válaszával változik.';
  end if;
  return new;
end $$;

drop trigger if exists project_member_keep_status on public.project_members;
create trigger project_member_keep_status before update on public.project_members
  for each row execute function public.project_member_keep_status();

create or replace function public.respond_project_invite(p_owner uuid, p_project text, p_accept boolean)
returns void language plpgsql security definer set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if not exists (
    select 1 from public.project_members m
    where m.owner_id = p_owner and m.project_id = p_project and m.member_id = v_me and m.status = 'invited'
  ) then
    raise exception 'Nincs ilyen meghívó.';
  end if;
  if p_accept then
    update public.project_members set status = 'active'
     where owner_id = p_owner and project_id = p_project and member_id = v_me;
  else
    delete from public.project_members
     where owner_id = p_owner and project_id = p_project and member_id = v_me;
  end if;
end;
$$;

revoke all on function public.respond_project_invite(uuid, text, boolean) from public, anon;
grant execute on function public.respond_project_invite(uuid, text, boolean) to authenticated;
