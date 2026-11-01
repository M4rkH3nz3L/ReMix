import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { MediaFileKey } from '@/lib/mediaGc';
import { logCaught } from '@/lib/logCaught';

/**
 * 🧹 Projekt-média GC — FS-oldal: a tiszta terv ([mediaGc](./mediaGc.ts))
 * fájljainak tényleges törlése az app dokumentum-mappájából. Best-effort:
 * az egyenként sikertelen törlés nem állítja meg a többit, weben no-op.
 */
/**
 * 🧨 TELJES média-takarítás: MINDEN fájl törlése a `document/media` és
 * `document/mediacache` mappákból — a „minden projekt törlése" után hívandó,
 * amikor már semmi nem hivatkozik rájuk (a GC-előtti korszak árváit is elviszi).
 */
export function sweepAppMediaDirs(): number {
  if (Platform.OS === 'web') {
    return 0;
  }
  let deleted = 0;
  for (const dirName of ['media', 'mediacache'] as const) {
    try {
      const dir = new Directory(Paths.document, dirName);
      if (!dir.exists) {
        continue;
      }
      for (const entry of dir.list()) {
        if (entry instanceof File) {
          try {
            entry.delete();
            deleted += 1;
          } catch (caught) {
            logCaught('lib/mediaGcClient.ts:sweepAppMediaDirs', caught);
            // zárolt fájl — megy tovább
          }
        }
      }
    } catch (caught) {
      logCaught('lib/mediaGcClient.ts:sweepAppMediaDirs', caught);
      // a mappa-hiba nem állítja meg a másik mappát
    }
  }
  return deleted;
}

export function deleteMediaFiles(keys: readonly MediaFileKey[]): number {
  if (Platform.OS === 'web' || keys.length === 0) {
    return 0;
  }
  let deleted = 0;
  for (const key of keys) {
    try {
      const f = new File(Paths.document, key.dir, ...key.name.split('/'));
      if (f.exists) {
        f.delete();
        deleted += 1;
      }
    } catch (caught) {
      logCaught('lib/mediaGcClient.ts:deleteMediaFiles', caught);
      // zárolt/hiányzó fájl — a többi törlése megy tovább
    }
  }
  return deleted;
}
