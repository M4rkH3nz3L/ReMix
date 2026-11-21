// 🗃️ Render-cache: a legutóbbi kész MP4 a Paths.cache alatt.
import { Directory, File, Paths } from 'expo-file-system';

import { logCaught } from '@/lib/logCaught';

/** Render-cache mappa (OS által üríthető cache-terület). */
function renderCacheDir(): Directory {
  return new Directory(Paths.cache, 'rendercache');
}

/** A kulcshoz tartozó gyorsítótár-fájl, ha létezik (különben null). */
export function cachedRenderFile(key: string): File | null {
  try {
    const file = new File(renderCacheDir(), `${key}.mp4`);
    return file.exists ? file : null;
  } catch (caught) {
    logCaught('lib/render.ts:cachedRenderFile', caught);
    return null;
  }
}

/**
 * A kész rendert a cache-be másolja (a régi bejegyzéseket kiürítve — csak a
 * legutóbbit tartjuk, hogy ne hízzon). Hiba esetén az eredeti fájlt adja vissza.
 */
export function storeRenderCache(key: string, file: File): File {
  try {
    const dir = renderCacheDir();
    if (!dir.exists) {
      dir.create({ intermediates: true });
    } else {
      // csak a legutóbbi rendert tartjuk
      for (const e of dir.list()) {
        if (e instanceof File) {
          try {
            e.delete();
          } catch (caught) {
            logCaught('lib/render.ts:storeRenderCache', caught);
            /* ignore */
          }
        }
      }
    }
    const dest = new File(dir, `${key}.mp4`);
    file.copy(dest);
    return dest.exists ? dest : file;
  } catch (caught) {
    logCaught('lib/render.ts:storeRenderCache', caught);
    return file;
  }
}
