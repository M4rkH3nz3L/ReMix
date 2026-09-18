-- 🔗 Poszt ↔ projekt életciklus.
--
-- A feed-videó a projekt egy PILLANATKÉPE. Ha a projekt (cloud_projects) törlődik,
-- a hozzá tartozó feed-poszt (és így a videó) is tűnjön el — „nincs projekt →
-- nincs videó". A posztot a (creator_id, project_id) köti a cloud_projects
-- (user_id, project_id) sorához.
--
-- (A kliens a projekt törlésekor közvetlenül is törli a posztjait — ez a trigger
-- a DEFENZÍV réteg: fiók-törlésnél / bármely más cloud_projects-törlési útnál is
-- eltűnik az árva feed-videó.)

create or replace function public.on_cloud_project_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.posts
   where creator_id = old.user_id
     and project_id = old.project_id;
  return old;
end;
$$;

drop trigger if exists cloud_projects_delete_posts on public.cloud_projects;
create trigger cloud_projects_delete_posts
  after delete on public.cloud_projects
  for each row execute function public.on_cloud_project_delete();
