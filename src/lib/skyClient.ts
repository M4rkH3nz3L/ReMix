import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { ensureCloud } from '@/lib/backend';
import { mediaFormData, uploadFetch } from '@/lib/upload';

/**
 * 🌅 Sky Replacement kliens (CC V2): a worker mélység-alapú ég-maszkkal
 * cseréli a fotó égboltját; az eredmény helyi fájlba kerül, és a klip forrása
 * arra vált — a projekt többi beállítása érintetlen.
 */

export const SKY_PRESETS = [
  { id: 'sunset', label: 'lib.sky.sunset' },
  { id: 'storm', label: 'lib.sky.storm' },
  { id: 'night', label: 'lib.sky.night' },
  { id: 'cinematic', label: 'lib.sky.cinematic' },
] as const;

export type SkyPreset = (typeof SKY_PRESETS)[number]['id'];

export async function replaceSky(uri: string, preset: SkyPreset): Promise<string | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const form = await mediaFormData(uri);
    form.append('preset', preset);
    const res = await uploadFetch(`${ensureCloud('skyReplace')}/sky`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { pngBase64: string };
    if (!body.pngBase64) {
      return null;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const name = uri.split('/').pop()?.split('.')[0] ?? 'kep';
    const target = new File(dir, `sky_${preset}_${name}.png`);
    try {
      if (target.exists) {
        target.delete();
      }
    } catch {
      // felülírja a write
    }
    target.write(Uint8Array.from(atob(body.pngBase64), (c) => c.charCodeAt(0)));
    return target.uri;
  } catch {
    return null;
  }
}
