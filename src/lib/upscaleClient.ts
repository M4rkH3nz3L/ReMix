import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { ensureCloud } from '@/lib/backend';
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';

/**
 * 🔍 Upscale / Enhance kliens (CC V2): a worker szuper-felbontással nagyítja
 * a fotót (2× vagy 4×), az eredmény helyi fájlba kerül, és a klip forrása
 * lecserélődik rá — a projekt többi része (kulcskockák, effektek) érintetlen.
 */
export async function upscalePhoto(
  uri: string,
  scale: 2 | 4
): Promise<{ uri: string; width: number; height: number } | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const form = await mediaFormData(uri);
    form.append('scale', String(scale));
    const res = await uploadFetch(`${ensureCloud('upscale')}/upscale`, {
      method: 'POST',
      body: form,
      headers: await workerAuthHeaders(),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      pngBase64: string;
      width: number;
      height: number;
    };
    if (!body.pngBase64) {
      return null;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const name = uri.split('/').pop()?.split('.')[0] ?? 'kep';
    const target = new File(dir, `up${scale}x_${name}.png`);
    try {
      if (target.exists) {
        target.delete();
      }
    } catch {
      // felülírja a write
    }
    target.write(Uint8Array.from(atob(body.pngBase64), (c) => c.charCodeAt(0)));
    return { uri: target.uri, width: body.width, height: body.height };
  } catch {
    return null;
  }
}
