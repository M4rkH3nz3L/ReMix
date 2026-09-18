import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { mediaFormData, uploadFetch } from '@/lib/upload';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { ensureCloud } from '@/lib/backend';

/**
 * 🪄 AI háttér-eltávolítás kliens (P1 v1, fotón): a worker /bgremove végpontja
 * u2net-tel (lokálisan, CPU-n) kivágja a fotó témáját — az eredmény átlátszó
 * hátterű PNG, amit a kliens helyi fájlba tölt és overlay-képként használ.
 * Md5-cache a workeren: ugyanarra a fotóra nem számol újra.
 */

export interface CutoutResult {
  id: string;
  cached: boolean;
  /** a kivágás helyi másolata (weben a távoli URL) */
  uri: string;
}

export async function requestCutout(uri: string): Promise<CutoutResult | null> {
  const base = ensureCloud('bgRemove');
  try {
    const form = await mediaFormData(uri);
    const res = await uploadFetch(`${base}/bgremove`, {
      method: 'POST',
      body: form,
      headers: await workerAuthHeaders(),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { id: string; cached: boolean; cutout: string };
    if (!body.id || !body.cutout) {
      return null;
    }
    const remote = `${base}${body.cutout}`;
    if (Platform.OS === 'web') {
      return { id: body.id, cached: body.cached, uri: remote };
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `cutout_${body.id}.png`);
    if (!target.exists) {
      await File.downloadFileAsync(remote, target);
    }
    return { id: body.id, cached: body.cached, uri: target.uri };
  } catch {
    return null;
  }
}
