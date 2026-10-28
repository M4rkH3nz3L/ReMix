import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

import {
  type SyncFileState,
  canEnableSync,
  planProjectSync,
  projectFolderPath,
} from '@/lib/projectFolder';
import { listProjectFolderFiles, projectFolderDir } from '@/lib/projectFolderClient';
import { joinPath, parentPath } from '@/lib/remixFiles';
import {
  CHUNKED_UPLOAD_MIN_BYTES,
  RemixFilesError,
  remixDelete,
  remixList,
  remixUpload,
  remixUploadChunked,
} from '@/lib/remixFilesClient';
import { connectionKind, loadSyncPrefs, onWifiAvailable } from '@/lib/networkPolicy';
import { fetchStorageUsage } from '@/lib/storageQuota';
import { syncDecision } from '@/lib/syncPolicy';
import { VIDED_FORMAT } from '@/lib/videdFile';
import type { Project } from '@/types/project';

/**
 * ☁️ Projekt-mappa → ReMix Storage szinkron (EGYIRÁNYÚ: telefon → felhő).
 *
 * A projekt a telefonon él (`Files/Projektek/<folder>`); ha a projekt-beállításban
 * be van kapcsolva (`syncToRemix`), a mappa tartalma a ReMix Storage
 * `Projektek/<folder>` mappájába kerül — csak az új/megváltozott fájlok, a felhőből
 * soha nem törlünk automatikusan. Mentés után (debounce) és bekapcsoláskor fut.
 * A projekt-tervet (`<folder>.remix`) minden mentés a mappába írja, így a mappa
 * önmagában is hordozható.
 *
 * Állapotok: off · pending · syncing · synced · failed · quota · offline · waitingWifi.
 * 📶 Az AUTOMATIKUS kör (mentés után) a „csak Wi-Fi-n” beállítást követi; a kézi
 * („Szinkronizálás most”, bekapcsolás) mindig mehet.
 */

export type ProjectSyncPhase =
  | 'off'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'failed'
  | 'quota'
  | 'offline'
  /** automatikus kör mobilneten, „csak Wi-Fi-n” mellett — Wi-Fi-re váltáskor indul */
  | 'waitingWifi';

export interface ProjectSyncState {
  phase: ProjectSyncPhase;
  /** feltöltendő / kész fájlok az aktuális körben */
  total: number;
  done: number;
  /** a futó fájl haladása (0–1) */
  progress: number;
  lastSyncedAt: string | null;
  error?: string;
  /** kvóta-hiánynál a hiányzó bájt */
  missingBytes?: number;
}

const STATE_KEY = (id: string) => `remix.projectSync.v1.${id}`;
const DEBOUNCE_MS = 4000;

const states = new Map<string, ProjectSyncState>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const latest = new Map<string, Project>();
let running: Promise<void> = Promise.resolve();

const emptyState = (project?: Pick<Project, 'syncToRemix'>): ProjectSyncState => ({
  phase: project?.syncToRemix ? 'pending' : 'off',
  total: 0,
  done: 0,
  progress: 0,
  lastSyncedAt: null,
});

function setState(id: string, patch: Partial<ProjectSyncState>): void {
  const next = { ...(states.get(id) ?? emptyState()), ...patch };
  states.set(id, next);
  listeners.forEach((l) => l());
  if (patch.phase && patch.phase !== 'syncing') {
    void AsyncStorage.setItem(STATE_KEY(id), JSON.stringify(next)).catch(() => {});
  }
}

/** A projekt szinkron-állapota (a mentett utolsó állapotot is visszatölti). */
export function useProjectSyncState(projectId: string | undefined): ProjectSyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (projectId && !states.has(projectId)) {
        void AsyncStorage.getItem(STATE_KEY(projectId))
          .then((raw) => {
            if (raw && !states.has(projectId)) {
              const saved = JSON.parse(raw) as ProjectSyncState;
              // egy félbemaradt kör újraindításkor „várakozik" (a következő mentés/kapcsolás folytatja)
              states.set(projectId, saved.phase === 'syncing' ? { ...saved, phase: 'pending' } : saved);
              listeners.forEach((l) => l());
            }
          })
          .catch(() => {});
      }
      return () => listeners.delete(cb);
    },
    () => (projectId ? (states.get(projectId) ?? EMPTY) : EMPTY)
  );
}
const EMPTY: ProjectSyncState = emptyState();

/** A projekt-terv (`<folder>.remix`) kiírása a projekt-mappába — a mappa így önálló, hordozható csomag. */
function writePlanFile(project: Project): void {
  if (!project.folder) {
    return;
  }
  try {
    const file = new File(projectFolderDir(project.folder), `${project.folder}.remix`);
    if (!file.exists) {
      file.create();
    }
    file.write(
      JSON.stringify({ format: VIDED_FORMAT, version: 1, exportedAt: new Date().toISOString(), project })
    );
  } catch {
    // best-effort
  }
}

/** Mentés után: terv-fájl + (ha be van kapcsolva) szinkron, debounce-olva. */
export function onProjectSaved(project: Project): void {
  if (Platform.OS === 'web' || !project.folder) {
    return;
  }
  latest.set(project.id, project);
  const prev = timers.get(project.id);
  if (prev) {
    clearTimeout(prev);
  }
  timers.set(
    project.id,
    setTimeout(() => {
      timers.delete(project.id);
      const p = latest.get(project.id);
      if (!p) {
        return;
      }
      writePlanFile(p);
      if (p.syncToRemix) {
        void requestProjectSync(p);
      } else if (states.get(p.id)?.phase !== 'off') {
        setState(p.id, { phase: 'off' });
      }
    }, DEBOUNCE_MS)
  );
}

async function listRemoteTree(dir: string, base = dir): Promise<SyncFileState[]> {
  let entries;
  try {
    entries = await remixList(dir);
  } catch (err) {
    if (err instanceof RemixFilesError && err.code === 'not_found') {
      return [];
    }
    throw err;
  }
  const out: SyncFileState[] = [];
  for (const e of entries) {
    if (e.isFolder) {
      out.push(...(await listRemoteTree(e.path, base)));
    } else {
      out.push({ path: e.path.slice(base.length + 1), size: e.size ?? 0 });
    }
  }
  return out;
}

/** Mennyi kerül fel, és belefér-e a kvótába — a bekapcsolás előtti ellenőrzéshez. */
export async function checkSyncCapacity(project: Project): Promise<{
  ok: boolean;
  signedIn: boolean;
  uploadBytes: number;
  missingBytes: number;
  usedBytes: number;
  quotaBytes: number;
}> {
  const folder = project.folder;
  const local = folder ? listProjectFolderFiles(folder) : [];
  const usage = await fetchStorageUsage().catch(() => null);
  if (!usage) {
    const bytes = local.reduce((a, f) => a + f.size, 0);
    return { ok: false, signedIn: false, uploadBytes: bytes, missingBytes: 0, usedBytes: 0, quotaBytes: 0 };
  }
  const remote = folder ? await listRemoteTree(projectFolderPath(folder)).catch(() => []) : [];
  const plan = planProjectSync(local, remote);
  const cap = canEnableSync(plan.uploadBytes, usage.usedBytes, usage.quotaBytes);
  return {
    ok: cap.ok,
    signedIn: true,
    uploadBytes: plan.uploadBytes,
    missingBytes: cap.missingBytes,
    usedBytes: usage.usedBytes,
    quotaBytes: usage.quotaBytes,
  };
}

/** a „Wi-Fi-re vár” projektek — Wi-Fi megjelenésekor újra sorba állnak */
const waitingWifi = new Set<string>();
let wifiListening = false;

function listenForWifi(): void {
  if (wifiListening) {
    return;
  }
  wifiListening = true;
  void onWifiAvailable(() => {
    for (const id of [...waitingWifi]) {
      const p = latest.get(id);
      waitingWifi.delete(id);
      if (p) {
        void requestProjectSync(p);
      }
    }
  });
}

/**
 * Szinkron-kör kérése (soros: egyszerre egy projekt; a kérések sorba állnak).
 * `manual` = a user kifejezett kérése (a „csak Wi-Fi-n” szabály nem tartja vissza).
 */
export function requestProjectSync(project: Project, opts: { manual?: boolean } = {}): Promise<void> {
  if (!project.folder || !project.syncToRemix) {
    return Promise.resolve();
  }
  latest.set(project.id, project);
  setState(project.id, { phase: 'pending', error: undefined });
  running = running.then(() => runSync(project.id, Boolean(opts.manual))).catch(() => {});
  return running;
}

async function runSync(projectId: string, manual: boolean): Promise<void> {
  const project = latest.get(projectId);
  if (!project?.folder || !project.syncToRemix) {
    return;
  }
  // 📶 hálózat-szabály (a pure döntés a syncPolicy-ben)
  const decision = syncDecision(await connectionKind(), await loadSyncPrefs(), manual);
  if (decision === 'waitWifi') {
    waitingWifi.add(projectId);
    listenForWifi();
    setState(projectId, { phase: 'waitingWifi' });
    return;
  }
  if (decision === 'offline') {
    setState(projectId, { phase: 'offline' });
    return;
  }
  waitingWifi.delete(projectId);
  const remoteDir = projectFolderPath(project.folder);
  try {
    writePlanFile(project);
    const local = listProjectFolderFiles(project.folder);
    const remote = await listRemoteTree(remoteDir);
    const plan = planProjectSync(local, remote);
    if (plan.upload.length > 0) {
      const usage = await fetchStorageUsage().catch(() => null);
      if (usage) {
        const cap = canEnableSync(plan.uploadBytes, usage.usedBytes, usage.quotaBytes);
        if (!cap.ok) {
          setState(projectId, { phase: 'quota', missingBytes: cap.missingBytes });
          return;
        }
      }
    }
    setState(projectId, { phase: 'syncing', total: plan.upload.length, done: 0, progress: 0 });
    const byPath = new Map(local.map((f) => [f.path, f.uri]));
    let done = 0;
    for (const f of plan.upload) {
      const uri = byPath.get(f.path);
      if (!uri) {
        continue;
      }
      const target = joinPath(remoteDir, parentPath(f.path));
      const name = f.path.slice(f.path.lastIndexOf('/') + 1);
      const onProgress = (p: number) => setState(projectId, { progress: p });
      // nagy fájl darabolva (a megszakadt darab-feltöltést a szerver 7 nap után takarítja)
      if (f.size >= CHUNKED_UPLOAD_MIN_BYTES) {
        await remixUploadChunked(uri, target, name, { onProgress });
      } else {
        await remixUpload(uri, target, name, onProgress);
      }
      done += 1;
      setState(projectId, { done, progress: 0 });
    }
    // ✅ „szinkronizálva" CSAK ha minden feltöltés ellenőrzötten kész (a szerver MD5+HEAD után válaszol)
    setState(projectId, { phase: 'synced', lastSyncedAt: new Date().toISOString(), progress: 0 });
  } catch (err) {
    if (err instanceof RemixFilesError) {
      setState(projectId, {
        phase: err.code === 'quota_exceeded' ? 'quota' : err.status === 401 ? 'offline' : 'failed',
        error: err.message,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // hálózati hiba → várakozik (a következő mentés újrapróbálja)
    setState(projectId, { phase: /network|fetch|timed? ?out|offline/i.test(msg) ? 'offline' : 'failed', error: msg });
  }
}

/** A projekt törlésekor a felhős másolat is megy (a hely felszabadul). Best-effort. */
export async function removeRemoteProjectFolder(folder: string): Promise<void> {
  try {
    await remixDelete([projectFolderPath(folder)]);
  } catch {
    // nincs felhős másolat / offline — nincs teendő
  }
}

/**
 * ⚙️ A projekt-beállítás („Szinkron a ReMix Storage-ba") átkapcsolása. Ha a projekt
 * épp nyitva van a szerkesztőben, a command-buson megy (undo/napló, és a következő
 * autosave sem írja felül); különben betöltés → pure reducer → mentés. Bekapcsoláskor
 * azonnal indul egy szinkron-kör. A kvóta-ellenőrzés a hívó (UI) dolga — lásd
 * `checkSyncCapacity`.
 */
export async function setProjectSyncEnabled(projectId: string, enabled: boolean): Promise<Project | null> {
  const [{ useEditorStore }, { applyCommand }, { loadProject, saveProject }] = await Promise.all([
    import('@/store/editorStore'),
    import('@/lib/commands'),
    import('@/lib/storage'),
  ]);
  const cmd = { type: 'SET_PROJECT_SYNC' as const, enabled };
  const st = useEditorStore.getState();
  let next: Project | null;
  if (st.project?.id === projectId) {
    st.dispatch(cmd);
    next = useEditorStore.getState().project;
  } else {
    const p = await loadProject(projectId);
    next = p ? (applyCommand(p, cmd) ?? p) : null;
  }
  if (!next) {
    return null;
  }
  await saveProject(next);
  if (enabled) {
    void requestProjectSync(next, { manual: true });
  } else {
    setState(projectId, { phase: 'off' });
  }
  return next;
}
