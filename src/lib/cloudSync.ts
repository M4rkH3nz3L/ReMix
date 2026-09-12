import { ensureCloud } from '@/lib/backend';
import { migrateProject } from '@/lib/projectUtils';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { Project } from '@/types/project';

/**
 * ☁️ Cloud-sync (Phase 5.1 alap): a projekt TELJES állapotának (JSON) felhő-
 * mentése/visszaállítása a `cloud_projects` táblába (RLS: saját). A médiafájlok
 * (Supabase Storage) szinkronja külön, későbbi lépés — ez a projekt-terv
 * backup/restore-ja.
 *
 * Pro-funkció: `ensureCloud('cloudSync')` (nincs Pro → ProRequiredError, amit a
 * hívó `guardPro`-val paywallra fordít). A hibát NEM nyeljük el.
 */

function requireUserId(): string {
  const id = useAuth.getState().user?.id;
  if (!id) {
    throw new Error('Nincs bejelentkezett felhasználó a felhő-mentéshez.');
  }
  return id;
}

/** A projekt (JSON) felhő-mentése (upsert a saját soraiba). */
export async function pushProject(project: Project): Promise<void> {
  ensureCloud('cloudSync'); // Pro-kapu
  const supabase = requireSupabase();
  const { error } = await supabase.from('cloud_projects').upsert(
    {
      user_id: requireUserId(),
      project_id: project.id,
      name: project.name,
      data: project,
    },
    { onConflict: 'user_id,project_id' }
  );
  if (error) {
    throw new Error(error.message);
  }
}

/** A projekt felhő-mentett verziója (vagy `null`, ha nincs). */
export async function pullProject(projectId: string): Promise<Project | null> {
  ensureCloud('cloudSync');
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('cloud_projects')
    .select('data')
    .eq('user_id', requireUserId())
    .eq('project_id', projectId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  // régi sémák automatikus felhozása (mint a helyi loadProject-nél)
  return migrateProject(data.data as Project);
}
