import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { reachableMediaUrl } from '@/lib/mediaUrl';
import { relinkUri } from '@/lib/projectUtils';
import { uploadMedia } from '@/lib/render';
import { findMissingMedia, type MissingMedia } from '@/lib/videdFile';
import type { Asset, Project } from '@/types/project';

/**
 * 🗄️ Média-szinkron — a projekt médiafájljainak SZERVER-tárolása és a hiányzó
 * fájlok automatikus visszaállítása.
 *
 * MIÉRT: a klipek helyi `file://` utakra hivatkoznak. Konténer-váltáskor (Expo Go
 * frissítés/újratelepítés, eszközváltás) ezek elszakadnak → „hiányzó fájl". Ezért
 * minden helyi asset EGYSZER feltöltődik a szerverre (`remoteUrl`), a felhő-projekt-
 * másolat hordozza, és betöltéskor a hiányzó fájl innen automatikusan visszaáll.
 *
 * A feltöltés/relink IO; a kiválasztó helperek (`mediaRemoteMap`, `needsBackup`)
 * tiszták → tesztelhetők.
 */

/** asset.uri → remoteUrl azoknál az asseteknél, amiknek van szerver-másolatuk. */
export function mediaRemoteMap(project: Project): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of project.assets) {
    if (a.remoteUrl) {
      map[a.uri] = a.remoteUrl;
    }
  }
  return map;
}

/** Egy asset szerver-backupra szorul-e (helyi fájl, még nincs szerver-másolata). */
export function needsBackup(asset: Asset, known: Record<string, string>): boolean {
  if (!asset.uri || /^https?:\/\//i.test(asset.uri)) {
    return false;
  }
  if (asset.remoteUrl || known[asset.uri]) {
    return false;
  }
  return asset.provider === 'local' || asset.provider === 'library';
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * A projekt médiafájljainak szerver-backupja: minden helyi asset EGYSZER töltődik
 * fel (idempotens a `known` remote-térkép alapján) és megkapja a `remoteUrl`-t.
 * Best-effort: egy-egy feltöltés hibája nem állítja meg a többit. A `known` a
 * felhő-másolat már ismert remote-jai (a duplán-feltöltés ellen).
 */
export async function backupProjectMedia(
  project: Project,
  known: Record<string, string> = {}
): Promise<{ project: Project; uploaded: number }> {
  if (Platform.OS === 'web') {
    return { project, uploaded: 0 };
  }
  let uploaded = 0;
  let changed = false;
  const assets: Asset[] = [];
  for (const a of project.assets) {
    const existing = a.remoteUrl ?? known[a.uri];
    if (existing) {
      if (a.remoteUrl) {
        assets.push(a);
      } else {
        assets.push({ ...a, remoteUrl: existing });
        changed = true;
      }
      continue;
    }
    if (!needsBackup(a, known) || !fileExists(a.uri)) {
      assets.push(a);
      continue;
    }
    try {
      const remoteUrl = await uploadMedia(a.uri, a.name);
      assets.push({ ...a, remoteUrl });
      uploaded += 1;
      changed = true;
    } catch {
      assets.push(a); // a feltöltés bukása nem állítja meg a többit
    }
  }
  return { project: changed ? { ...project, assets } : project, uploaded };
}

/**
 * A hiányzó (helyileg nem elérhető) médiafájlok automatikus visszaállítása a
 * szerver-másolatból: letölti a `remoteUrl`-t egy determinisztikus cache-fájlba
 * és relinkeli a projektet. A `remoteByUri` a felhő-projektből származó
 * uri→remoteUrl térkép — ha a helyi assetnek magának nincs `remoteUrl`-je.
 */
export async function restoreMissingMedia(
  project: Project,
  remoteByUri: Record<string, string> = {}
): Promise<{ project: Project; restored: number; missing: MissingMedia[] }> {
  if (Platform.OS === 'web') {
    return { project, restored: 0, missing: [] };
  }
  const missing = findMissingMedia(project);
  if (missing.length === 0) {
    return { project, restored: 0, missing };
  }
  let dir: Directory;
  try {
    dir = new Directory(Paths.document, 'mediacache');
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  } catch {
    return { project, restored: 0, missing };
  }
  let next = project;
  let restored = 0;
  for (const m of missing) {
    const asset = project.assets.find((a) => a.uri === m.uri);
    const url = reachableMediaUrl(asset?.remoteUrl ?? remoteByUri[m.uri] ?? null);
    if (!url) {
      continue;
    }
    // determinisztikus cache-név (a storage-kulcs uuid-je) → újratöltés újrahasznál
    const base = url.split('?')[0].split('/').pop() || `${m.kind}-${asset?.id ?? 'media'}`;
    const target = new File(dir, base);
    try {
      if (!target.exists) {
        await File.downloadFileAsync(url, target);
      }
      next = relinkUri(next, m.uri, target.uri);
      restored += 1;
    } catch {
      // egy fájl bukása nem állítja meg a többi visszaállítását
    }
  }
  return { project: next, restored, missing: findMissingMedia(next) };
}
