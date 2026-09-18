import { ensureCloud } from '@/lib/backend';
import { migrateProject, projectDuration } from '@/lib/projectUtils';
import { listProjects, saveProject } from '@/lib/storage';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { Project, ProjectMeta } from '@/types/project';

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

// ── 🗄️ Adat-biztonság: automatikus, INGYENES projekt-terv backup a userhez ─────
// A projekt-JSON (média nélkül) minden mentéskor a DB-be kerül → SOHA nem vész el
// (újratelepítés/eszközváltás után visszahozható). Best-effort: sosem dob, és
// bejelentkezés nélkül csendben kihagyja (a helyi mentés a mérvadó).

/** A projekt-terv felhő-mentése — BEST-EFFORT (nem dob, login nélkül skip). */
export async function backupProjectToCloud(project: Project): Promise<void> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return;
    }
    await supabase.from('cloud_projects').upsert(
      { user_id: uid, project_id: project.id, name: project.name, data: project },
      { onConflict: 'user_id,project_id' }
    );
  } catch {
    // az auto-backup sosem törheti meg a szerkesztést
  }
}

/** A userhez tartozó FELHŐ-projektek lista-metái (a merge-hez). */
export async function listCloudProjectMetas(): Promise<ProjectMeta[]> {
  const uid = useAuth.getState().user?.id;
  if (!supabase || !uid) {
    return [];
  }
  const { data } = await supabase
    .from('cloud_projects')
    .select('project_id, name, data, updated_at')
    .eq('user_id', uid);
  if (!data) {
    return [];
  }
  return data.map((r) => {
    const p = migrateProject(r.data as Project);
    return {
      id: p.id,
      name: p.name ?? (r.name as string) ?? 'Projekt',
      aspectRatio: p.aspectRatio,
      duration: projectDuration(p),
      clipCount: p.tracks.reduce((n, t) => n + t.clips.length, 0),
      updatedAt: p.updatedAt ?? (r.updated_at as string),
    };
  });
}

/** A felhő-projekt törlése (a DB-trigger kaszkádban törli a hozzá tartozó posztokat is). */
export async function deleteCloudProject(projectId: string): Promise<void> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return;
    }
    await supabase.from('cloud_projects').delete().eq('user_id', uid).eq('project_id', projectId);
  } catch {
    // best-effort
  }
}

/**
 * A HELYILEG HIÁNYZÓ felhő-projektek visszatöltése (újratelepítés/eszközváltás
 * után) — a meglévő helyi projekteket NEM írja felül (nincs klobber). @returns
 * hány projekt jött vissza. Best-effort.
 */
export async function syncProjectsFromCloud(): Promise<number> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return 0;
    }
    // ⚡ perf: előbb CSAK az id-k (könnyű lekérés), majd a helyileg HIÁNYZÓK teljes
    // JSON-ját húzzuk le — nem parse-oljuk végig az összes felhő-projektet minden hívásnál.
    const { data: ids } = await supabase
      .from('cloud_projects')
      .select('project_id')
      .eq('user_id', uid);
    if (!ids || ids.length === 0) {
      return 0;
    }
    const localIds = new Set((await listProjects()).map((m) => m.id));
    const missing = (ids as { project_id: string }[])
      .map((r) => r.project_id)
      .filter((id) => !localIds.has(id));
    if (missing.length === 0) {
      return 0;
    }
    const { data: rows } = await supabase
      .from('cloud_projects')
      .select('data')
      .eq('user_id', uid)
      .in('project_id', missing);
    let restored = 0;
    for (const row of rows ?? []) {
      const p = migrateProject((row as { data: Project }).data);
      if (p?.id) {
        await saveProject(p);
        restored += 1;
      }
    }
    return restored;
  } catch {
    return 0;
  }
}
