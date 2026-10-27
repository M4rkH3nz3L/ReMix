import { File } from 'expo-file-system';

import { cloudBaseUrl } from '@/lib/backend';
import { probeAudioDuration } from '@/lib/media';
import { deviceRelativePath, projectFolderPath } from '@/lib/projectFolder';
import { activeProjectFolder, freeFileName, projectMediaDir } from '@/lib/projectFolderClient';
import { assetFromPicked, type SourceKind } from '@/lib/projectSource';
import { type StorageEntry, fileKindOf } from '@/lib/remixFiles';
import { workerAuthHeaders } from '@/lib/workerAuth';
import type { Asset } from '@/types/project';

/**
 * 🗂️→🎬 Import a Tárhelyemből a nyitott projektbe — ugyanúgy, mint a telefon saját
 * fájlválasztójából: az Eszközöm bármely mappájából (más projekt mappájából is)
 * vagy a ReMix Storage-ból. A fájl a projekt SAJÁT mappájába kerül (eszközről
 * másolat, felhőből letöltés) — kivéve, ha már ott van. → forrás-`Asset`.
 */
export async function importFromStorage(entry: StorageEntry): Promise<Asset | null> {
  const kind = fileKindOf(entry.name);
  if (entry.isFolder || (kind !== 'video' && kind !== 'image' && kind !== 'audio')) {
    return null;
  }
  const dir = projectMediaDir();
  let uri: string;
  if (entry.location === 'device') {
    if (!entry.uri) {
      return null;
    }
    const own = activeProjectFolder();
    const rel = deviceRelativePath(entry.uri);
    if (own && rel?.startsWith(`${projectFolderPath(own)}/`)) {
      uri = entry.uri; // már a projekt mappájában van
    } else {
      const target = new File(dir, freeFileName(dir, entry.name));
      new File(entry.uri).copySync(target);
      uri = target.uri;
    }
  } else if (entry.location === 'remix') {
    const target = new File(dir, freeFileName(dir, entry.name));
    const file = await File.downloadFileAsync(
      `${cloudBaseUrl()}/files/download?path=${encodeURIComponent(entry.path)}`,
      target,
      { headers: await workerAuthHeaders() }
    );
    uri = file.uri;
  } else {
    return null;
  }
  const duration = kind === 'image' ? undefined : (await probeAudioDuration(uri)) || undefined;
  return assetFromPicked(kind as SourceKind, { uri, name: entry.name, duration });
}
