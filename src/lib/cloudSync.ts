import { ensureCloud } from '@/lib/backend';
import { backupProjectMedia, mediaRemoteMap } from '@/lib/mediaSync';
import { migrateProject, projectDuration } from '@/lib/projectUtils';
import { canBackupMedia } from '@/lib/storagePolicy';
import { listProjects, loadVersions, saveProject, type ProjectVersion } from '@/lib/storage';
import { requireSupabase, supabase } from '@/lib/supabase';
import { pickVersionsToPush, type CloudVersionMeta } from '@/lib/versionsSync';
import { useAuth } from '@/store/authStore';
import { useEntitlement } from '@/store/entitlementStore';
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

/**
 * A projekt felhő-mentése — BEST-EFFORT (nem dob, login nélkül skip).
 *
 * 🗄️ A projekt-terv MELLETT a MÉDIÁT is felmenti: minden helyi asset EGYSZER
 * feltöltődik a Storage-ba (remoteUrl), így eszközváltás/újratelepítés után a
 * betöltés vissza tudja állítani a „hiányzó" fájlokat. Idempotens: a már feltöltött
 * remote-okat a MEGLÉVŐ felhő-másolatból olvassa, ezért asset-enként csak egyszer tölt.
 */
export async function backupProjectToCloud(project: Project): Promise<void> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return;
    }
    // már ismert remote-ok a korábbi felhő-másolatból (dupla-feltöltés ellen)
    let known: Record<string, string> = {};
    try {
      const { data } = await supabase
        .from('cloud_projects')
        .select('data')
        .eq('user_id', uid)
        .eq('project_id', project.id)
        .maybeSingle();
      if (data?.data) {
        known = mediaRemoteMap(migrateProject(data.data as Project));
      }
    } catch {
      // nincs korábbi másolat / offline → minden helyi asset feltölthető
    }
    // 🗄️ ADR-013: a MÉDIA auto-backup a MI R2-tárunkba FIZETŐS (Pro+). Free usernél
    // a média az ESZKÖZÖN marad — KIVÉVE, ha a usernek SAJÁT aktív külső tára van
    // (Google Drive / Dropbox / …): oda a szerver „aktív cél" útja tölt, a user
    // saját tárhelyére, tier-től függetlenül. A projekt-TERV (JSON) mindig mentődik.
    let backed = project;
    const { hasOwnStorageTarget } = await import('@/lib/externalStorage');
    if (canBackupMedia(useEntitlement.getState().effectiveTier(), await hasOwnStorageTarget())) {
      backed = (await backupProjectMedia(project, known)).project;
    }
    await supabase.from('cloud_projects').upsert(
      { user_id: uid, project_id: backed.id, name: backed.name, data: backed },
      { onConflict: 'user_id,project_id' }
    );
    // 🕓 a KÉZI verzió-pillanatképek felhő-tükre (idempotens, best-effort)
    await pushProjectVersions(backed.id);
  } catch {
    // az auto-backup sosem törheti meg a szerkesztést
  }
}

// ── 🕓 Felhő-verziókezelés: a kézi snapshotok tükre a cloud_project_versions-ben ──

/**
 * A projekt KÉZI verzióinak felszinkronizálása — idempotens (csak a felhőből
 * hiányzó megy fel), best-effort (sosem dob; login/migráció nélkül skip).
 */
export async function pushProjectVersions(projectId: string): Promise<number> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return 0;
    }
    const { data } = await supabase
      .from('cloud_project_versions')
      .select('version_id')
      .eq('user_id', uid)
      .eq('project_id', projectId);
    const cloudIds = new Set((data ?? []).map((r: { version_id: string }) => r.version_id));
    const toPush = pickVersionsToPush(await loadVersions(projectId), cloudIds);
    if (toPush.length === 0) {
      return 0;
    }
    const { error } = await supabase.from('cloud_project_versions').upsert(
      toPush.map((v) => ({
        user_id: uid,
        project_id: projectId,
        version_id: v.id,
        name: v.name,
        kind: v.kind ?? 'manual',
        at: v.at,
        data: v.project,
      })),
      { onConflict: 'user_id,project_id,version_id' }
    );
    return error ? 0 : toPush.length;
  } catch {
    return 0;
  }
}

/** A projekt felhő-verzióinak lista-metái (a `data` nélkül — az csak visszaállításkor jön). */
export async function listCloudVersionMetas(projectId: string): Promise<CloudVersionMeta[]> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return [];
    }
    const { data, error } = await supabase
      .from('cloud_project_versions')
      .select('version_id, name, at, kind')
      .eq('user_id', uid)
      .eq('project_id', projectId)
      .order('at', { ascending: true });
    if (error || !data) {
      return [];
    }
    return data.map((r: { version_id: string; name: string; at: string; kind: string }) => ({
      versionId: r.version_id,
      name: r.name ?? '',
      at: r.at,
      kind: r.kind === 'auto' ? 'auto' : 'manual',
    }));
  } catch {
    return [];
  }
}

/** Egy felhő-verzió TELJES pillanatképe (letöltés visszaállításhoz). `null`, ha nincs/hiba. */
export async function fetchCloudVersion(
  projectId: string,
  versionId: string
): Promise<ProjectVersion | null> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return null;
    }
    const { data, error } = await supabase
      .from('cloud_project_versions')
      .select('version_id, name, at, kind, data')
      .eq('user_id', uid)
      .eq('project_id', projectId)
      .eq('version_id', versionId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return {
      id: data.version_id,
      name: data.name ?? '',
      at: data.at,
      kind: data.kind === 'auto' ? 'auto' : 'manual',
      project: migrateProject(data.data as Project),
    };
  } catch {
    return null;
  }
}

/** Egy felhő-verzió törlése (a lokális példányt nem érinti). */
export async function deleteCloudVersion(projectId: string, versionId: string): Promise<void> {
  try {
    const uid = useAuth.getState().user?.id;
    if (!supabase || !uid) {
      return;
    }
    await supabase
      .from('cloud_project_versions')
      .delete()
      .eq('user_id', uid)
      .eq('project_id', projectId)
      .eq('version_id', versionId);
  } catch {
    // best-effort
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
