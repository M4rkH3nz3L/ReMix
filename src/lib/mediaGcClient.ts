import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { MediaFileKey } from '@/lib/mediaGc';

/**
 * 🧹 Projekt-média GC — FS-oldal: a tiszta terv ([mediaGc](./mediaGc.ts))
 * fájljainak tényleges törlése az app dokumentum-mappájából. Best-effort:
 * az egyenként sikertelen törlés nem állítja meg a többit, weben no-op.
 */
export function deleteMediaFiles(keys: readonly MediaFileKey[]): number {
  if (Platform.OS === 'web' || keys.length === 0) {
    return 0;
  }
  let deleted = 0;
  for (const key of keys) {
    try {
      const f = new File(new Directory(Paths.document, key.dir), key.name);
      if (f.exists) {
        f.delete();
        deleted += 1;
      }
    } catch {
      // zárolt/hiányzó fájl — a többi törlése megy tovább
    }
  }
  return deleted;
}
