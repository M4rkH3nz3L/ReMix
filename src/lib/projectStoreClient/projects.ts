import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProjectEvent } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { isNewerSchema, migrateProject } from '@/lib/projectUtils';
import {
  eventsKey,
  INDEX_KEY,
  lastAutoKey,
  MEDIA_REF_PREFIXES,
  projectKey,
  recoveryKey,
  versionsKey,
} from '@/lib/projectStoreCore/keys';
import { folderOf, metaOf } from '@/lib/projectStoreCore/meta';
import { listProjects } from '@/lib/projectStoreClient/projectIndex';
import { rebaseStoredUris } from '@/lib/projectStoreClient/storedUris';
import { clearTombstone, markProjectsDeleted } from '@/lib/projectStoreClient/tombstones';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/** a TÖBBI tárolt dokumentum (projekt/verzió/recovery/napló) nyers JSON-ja — a média-hivatkozás-számláláshoz */
async function otherStoredDocs(exceptId: string): Promise<(string | null)[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) => MEDIA_REF_PREFIXES.some((p) => k.startsWith(p)) && !k.endsWith(`.${exceptId}`),
  );
  return (await AsyncStorage.multiGet(keys)).map(([, raw]) => raw);
}

/**
 * 📁 A projekt saját Eszközöm-mappájának biztosítása (best-effort — a FS-hiba sosem
 * akasztja meg a betöltést/mentést). Lásd `projectFolderClient.prepareProjectFolder`.
 */
async function withProjectFolder(project: Project): Promise<{ project: Project; changed: boolean }> {
  try {
    const { prepareProjectFolder } = await import('@/lib/projectFolderClient');
    return await prepareProjectFolder(project, () => otherStoredDocs(project.id));
  } catch (caught) {
    logCaught('lib/storage.ts:withProjectFolder', caught);
    return { project, changed: false };
  }
}

/** mentés utáni háttér-feladatok (terv-fájl a projekt-mappába + ReMix Storage-szinkron, ha be van kapcsolva) */
function afterSave(project: Project): void {
  import('@/lib/projectSyncClient')
    .then(({ onProjectSaved }) => onProjectSaved(project))
    .catch((caught) => { logCaught('lib/storage.ts:afterSave', caught); });
}

export async function loadProject(id: string): Promise<Project | null> {
  const stored = await AsyncStorage.getItem(projectKey(id));
  if (!stored) {
    return null;
  }
  // 📂 a régi app-konténerre mutató média-uri-k → az aktuálisra (különben a média „eltűnik")
  const { raw, rebased } = await rebaseStoredUris(stored);
  let project: Project;
  try {
    // régi sémák automatikus felhozása (v1 → v2: asset-registry)
    project = migrateProject(JSON.parse(raw) as Project);
  } catch (caught) {
    logCaught('lib/storage.ts:loadProject', caught);
    return null;
  }
  // 📁 a projekt a TELEFONON él, saját mappában — a szerkesztő már a mappás
  // (átvett médiájú) projektet kapja, így a memóriában sosem marad régi uri
  const prepared = await withProjectFolder(project);
  if (prepared.changed || rebased) {
    await saveProject(prepared.project);
  }
  return prepared.project;
}

export async function saveProject(project: Project): Promise<void> {
  // 📐 újabb app-verzió projektje: csak olvasható — a régi app nem írja felül
  if (isNewerSchema(project)) return;
  await clearTombstone(project.id);
  const stamped: Project = { ...project, updatedAt: new Date().toISOString() };
  // a `listProjects` sérült indexnél ÚJRAÉPÍT (nem üres listát ad), így a
  // következő sor nem törli ki a többi projektet az indexből
  const metas = await listProjects();
  const nextIndex = [metaOf(stamped), ...metas.filter((m) => m.id !== stamped.id)];
  await AsyncStorage.multiSet([
    [projectKey(stamped.id), JSON.stringify(stamped)],
    [INDEX_KEY, JSON.stringify(nextIndex)],
  ]);
  afterSave(stamped);
}

export async function deleteProject(id: string): Promise<void> {
  // 🪦 ELŐSZÖR a sírkő: ha a felhős törlés elbukik, vagy egy futó háttér-mentés
  // utólag feltölti, a felhő-visszatöltés akkor sem hozza vissza
  await markProjectsDeleted([id]);
  // 🧹 ADR-013: a projekt-média az APP tárolja, és a fájl a PROJEKTTEL törlődik.
  // A tartalom kiolvasása MÉG a kulcs-törlés előtt (ezek a törlés-jelöltek) …
  const deletedDocs = (
    await AsyncStorage.multiGet([projectKey(id), versionsKey(id), recoveryKey(id)])
  ).map(([, raw]) => raw);

  const metas = await listProjects();
  await AsyncStorage.multiSet([[INDEX_KEY, JSON.stringify(metas.filter((m) => m.id !== id))]]);
  await AsyncStorage.multiRemove([
    projectKey(id),
    eventsKey(id),
    versionsKey(id),
    lastAutoKey(id),
    recoveryKey(id),
  ]);

  // … majd ref-számolt fájl-takarítás: ami MÁSIK projektben/verzióban/recovery-ben/
  // naplóban is él (duplikált/remixelt projekt ugyanazt a fájlt osztja), az MARAD.
  // Best-effort — a GC hibája sosem akasztja meg a projekt-törlést.
  try {
    const remainingKeys = (await AsyncStorage.getAllKeys()).filter((k) =>
      MEDIA_REF_PREFIXES.some((p) => k.startsWith(p)),
    );
    const remainingDocs = (await AsyncStorage.multiGet(remainingKeys)).map(([, raw]) => raw);
    const { planMediaDeletion } = await import('@/lib/mediaGc');
    const plan = planMediaDeletion(deletedDocs, remainingDocs);
    if (plan.length > 0) {
      const { deleteMediaFiles } = await import('@/lib/mediaGcClient');
      deleteMediaFiles(plan);
    }
    // 📁 a projekt-mappa a projekttel együtt megy (a máshol még hivatkozott fájl marad)
    const folder = folderOf(deletedDocs[0]);
    if (folder) {
      const { removeProjectFolder } = await import('@/lib/projectFolderClient');
      removeProjectFolder(folder, remainingDocs);
      const { removeRemoteProjectFolder } = await import('@/lib/projectSyncClient');
      void removeRemoteProjectFolder(folder);
    }
  } catch (caught) {
    logCaught('lib/storage.ts:deleteProject', caught);
    // árva fájl maradhat — a következő törlés/GC elviszi
  }
}

/**
 * ⚛️ ATOMI mentés: a projekt + az index + az eseménynapló EGYETLEN `multiSet`-ben
 * (vagy MINDHÁROM, vagy SEMMI). A korábbi `Promise.all([saveProject, saveEvents])`
 * félig sikerülhetett (projekt ment, event nem → inkonzisztens history). Ezt váltja.
 */
export async function saveProjectAndEvents(
  project: Project,
  events: ProjectEvent[]
): Promise<void> {
  if (isNewerSchema(project)) return;
  await clearTombstone(project.id);
  const stamped: Project = { ...project, updatedAt: new Date().toISOString() };
  const metas = await listProjects();
  const nextIndex = [metaOf(stamped), ...metas.filter((m) => m.id !== stamped.id)];
  await AsyncStorage.multiSet([
    [projectKey(stamped.id), JSON.stringify(stamped)],
    [INDEX_KEY, JSON.stringify(nextIndex)],
    [eventsKey(stamped.id), JSON.stringify(events)],
  ]);
  afterSave(stamped);
}

/**
 * 🧬 Projekt-duplikálás („Mentés másként"): új id, friss dátumok, „… másolat" név.
 * A duplikátum friss — nem viszi át a forrás event-history-ját (tiszta lappal indul).
 * @returns az új projekt, vagy null, ha a forrás nem olvasható.
 */
export async function duplicateProject(id: string, copyLabel = 'másolat'): Promise<Project | null> {
  const src = await loadProject(id);
  if (!src) {
    return null;
  }
  const now = new Date().toISOString();
  const draft: Project = {
    ...src,
    id: makeId('prj'),
    name: `${src.name} ${copyLabel}`.trim(),
    // a másolat SAJÁT mappát kap (a forrás fájljait átmásolja), és a szinkron
    // projektenként külön döntés → alapból ki
    folder: undefined,
    syncToRemix: undefined,
    createdAt: now,
    updatedAt: now,
  };
  const { project: copy } = await withProjectFolder(draft);
  await saveProject(copy);
  return copy;
}
