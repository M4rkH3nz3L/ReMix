import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { docMediaUris } from '@/lib/imageDoc';
import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';
import type { ImageDoc } from '@/types/project';

/**
 * 🎨 Kép-dokumentum rasterizálása a workerrel.
 *
 * A réteg-fa az igazság, a PNG csak az eredménye — ezért a fájlnév a
 * dokumentum TARTALMÁBÓL képzett kulcsot kap: ha semmi nem változott, a
 * meglévő fájl megy vissza (nincs fölösleges render), ha bármit átállítottál,
 * új fájl születik, és a régi képklip nem íródik felül a hátad mögött.
 */
function contentKey(doc: ImageDoc): string {
  const src = JSON.stringify({ a: doc.aspectRatio, l: doc.layers });
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export async function renderImageDoc(
  doc: ImageDoc,
  height = 1280
): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `doc_${doc.id}_${contentKey(doc)}.png`);
    if (target.exists) {
      return target.uri;
    }

    const form = new FormData();
    const uriMap: Record<string, string> = {};
    docMediaUris(doc).forEach((uri, i) => {
      const field = `f${i}`;
      uriMap[uri] = field;
      const file = new File(uri);
      if (file.exists) {
        form.append(field, file as unknown as Blob, file.name);
      }
    });
    form.append('doc', JSON.stringify(doc));
    form.append('uriMap', JSON.stringify(uriMap));
    form.append('height', String(height));

    const res = await uploadFetch(`${renderServerUrl()}/imagedoc`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      return null;
    }
    target.write(new Uint8Array(await res.arrayBuffer()));
    return target.uri;
  } catch {
    return null;
  }
}
