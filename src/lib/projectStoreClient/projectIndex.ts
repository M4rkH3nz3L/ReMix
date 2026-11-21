import AsyncStorage from '@react-native-async-storage/async-storage';

import { migrateProject } from '@/lib/projectUtils';
import { INDEX_KEY, projectKey } from '@/lib/projectStoreCore/keys';
import { metaOf } from '@/lib/projectStoreCore/meta';
import type { Project, ProjectMeta } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/** a sérült index jelzése (a „nincs projekt" esettől megkülönböztetve) */
class ProjectIndexCorruptError extends Error {}

/**
 * A nyers index. Hiányzó kulcs = üres lista (ez a normális első indítás), de a
 * SÉRÜLT tartalom hibát dob — különben a hívó „nincs projekt"-ként értelmezné,
 * és a következő mentés felülírná az indexet (adatvesztés).
 */
async function readIndex(): Promise<ProjectMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectIndexCorruptError('az index nem érvényes JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new ProjectIndexCorruptError('az index nem lista');
  }
  return (parsed as ProjectMeta[]).filter(
    (m) => m && typeof m.id === 'string' && typeof m.updatedAt === 'string'
  );
}

/**
 * 🛟 Index-újraépítés a TÉNYLEGESEN tárolt projektekből. Sérült index esetén ez
 * menti meg a munkát: végigmegy a `vided.project.v1.*` kulcsokon, és mindből
 * kiolvassa a lista-bejegyzést. Az egyenként olvashatatlan projekt kimarad, a
 * többi megmarad.
 */
async function rebuildIndex(): Promise<ProjectMeta[]> {
  const prefix = projectKey('');
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  if (keys.length === 0) {
    return [];
  }
  const entries = await AsyncStorage.multiGet(keys);
  const metas: ProjectMeta[] = [];
  for (const [, raw] of entries) {
    if (!raw) {
      continue;
    }
    try {
      metas.push(metaOf(migrateProject(JSON.parse(raw) as Project)));
    } catch (caught) {
      logCaught('lib/storage.ts:rebuildIndex', caught);
      // ez az EGY projekt olvashatatlan — a többi mehet tovább
    }
  }
  return metas;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  let metas: ProjectMeta[];
  try {
    metas = await readIndex();
  } catch (caught) {
    logCaught('lib/storage.ts:listProjects', caught);
    // 🛟 sérült index → újraépítés a tárolt projektekből, és visszaírás, hogy a
    // következő olvasás már ép legyen. Ha a visszaírás nem megy, a lista akkor is jó.
    metas = await rebuildIndex();
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(metas)).catch((caught) => { logCaught('lib/storage.ts:listProjects', caught); });
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
