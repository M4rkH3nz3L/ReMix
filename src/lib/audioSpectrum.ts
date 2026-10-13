import { Directory, File, Paths } from 'expo-file-system';

import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';

/**
 * 📊 Egy hang-klip spektrogramja (frekvencia-kép) a worker `/audio/spectrum`-ából: a klip audióját
 * feltölti, a visszakapott PNG-t helyi fájlba menti → `uri`. A ClipEditSheet mutatja (EQ-döntésekhez).
 * Hiba/web → null.
 */
export async function renderClipSpectrum(
  audioUri: string,
  opts?: { width?: number; height?: number }
): Promise<string | null> {
  try {
    const form = new FormData();
    const audio = new File(audioUri);
    form.append('audio', audio as unknown as Blob, audio.name);
    form.append('width', String(opts?.width ?? 720));
    form.append('height', String(opts?.height ?? 360));
    const res = await uploadFetch(`${renderServerUrl()}/audio/spectrum`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const dir = new Directory(Paths.cache, 'spectrum');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `spec_${Date.now().toString(36)}.png`);
    target.write(new Uint8Array(await res.arrayBuffer()));
    return target.uri;
  } catch {
    return null;
  }
}
