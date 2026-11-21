import AsyncStorage from '@react-native-async-storage/async-storage';

import { makeId } from '@/lib/id';
import { lastAutoKey, versionsKey } from '@/lib/projectStoreCore/keys';
import type { ProjectVersion } from '@/lib/projectStoreCore/snapshots';
import { rebaseStoredUris } from '@/lib/projectStoreClient/storedUris';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/** 🕓 A projekt mentett verziói (külön kulcson, mint az események). */
export async function loadVersions(projectId: string): Promise<ProjectVersion[]> {
  const stored = await AsyncStorage.getItem(versionsKey(projectId));
  if (!stored) {
    return [];
  }
  try {
    const { raw } = await rebaseStoredUris(stored);
    const list = JSON.parse(raw) as ProjectVersion[];
    return Array.isArray(list) ? list : [];
  } catch (caught) {
    logCaught('lib/storage.ts:loadVersions', caught);
    return [];
  }
}

export async function saveVersions(projectId: string, versions: ProjectVersion[]): Promise<void> {
  // védőkorlát: legfeljebb 20 verzió / projekt (a legújabbak)
  await AsyncStorage.setItem(versionsKey(projectId), JSON.stringify(versions.slice(-20)));
}

/** 🕓 legfeljebb ennyi AUTO-verziót tartunk (a kézi pillanatképek megmaradnak) */
const MAX_AUTO_VERSIONS = 8;
/** két auto-mentés közti minimum (mp) — ne szemetelje tele a történetet */
const AUTO_VERSION_THROTTLE_MS = 120000;

/**
 * 🕓 Autosave-előzmény: az autosave meghívja — egy időbélyegzett AUTO-verziót
 * fűz a történethez (throttle-olva), a régi autókat nyesve. A kézi (manual)
 * pillanatképeket nem érinti. Így a felhasználónak van visszaállítható előzménye
 * akkor is, ha nem mentett kézzel.
 */
export async function recordAutoVersion(project: Project): Promise<void> {
  try {
    // ⚡ A throttle-t OLCSÓN döntjük el: az utolsó auto-verzió időbélyege külön,
    // apró kulcson van. Korábban ehhez a TELJES verzió-listát beolvastuk és
    // JSON-parse-oltuk (max 20 projekt-pillanatkép, több megabájt), majd a
    // döntés után jellemzően eldobtuk — minden autosave-nél, a JS-szálon.
    const lastAt = await AsyncStorage.getItem(lastAutoKey(project.id));
    if (lastAt && Date.now() - Number(lastAt) < AUTO_VERSION_THROTTLE_MS) {
      return; // túl gyakori — kihagyjuk, olvasás nélkül
    }
    const versions = await loadVersions(project.id);
    const lastAuto = [...versions].reverse().find((v) => v.kind === 'auto');
    if (lastAuto && Date.now() - new Date(lastAuto.at).getTime() < AUTO_VERSION_THROTTLE_MS) {
      return; // a régi (időbélyeg-kulcs nélküli) adatra is helyesen dönt
    }
    const auto: ProjectVersion = {
      id: makeId('ver'),
      name: '',
      at: new Date().toISOString(),
      project,
      kind: 'auto',
    };
    const manuals = versions.filter((v) => v.kind !== 'auto');
    const autos = [...versions.filter((v) => v.kind === 'auto'), auto].slice(-MAX_AUTO_VERSIONS);
    const next = [...manuals, ...autos].sort((a, b) => a.at.localeCompare(b.at));
    await saveVersions(project.id, next);
    // az olcsó throttle-kulcs frissítése (a következő hívás már ebből dönt)
    await AsyncStorage.setItem(lastAutoKey(project.id), String(Date.now()));
  } catch (caught) {
    logCaught('lib/storage.ts:recordAutoVersion', caught);
    // az autosave-előzmény best-effort — hiba esetén csendben kihagyjuk
  }
}
