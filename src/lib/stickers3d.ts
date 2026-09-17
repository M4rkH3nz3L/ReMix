import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { fetchRead } from '@/lib/netRetry';
import { renderServerUrl } from '@/lib/render';

/**
 * 🧊 3D stickers kliens (3D V1): a worker CC0 glTF-modelleket renderel
 * átlátszó hátterű PNG-vé (three.js + Chromium WebGL, cache-elve). A kliens a
 * PNG-t helyi fájlba tölti, és kép-kitöltésű overlay-formaként (a logó-útvonal)
 * teszi a vászonra — így húzható, méretezhető, és a renderbe pixelpontosan
 * beég, feltöltés a szokásos uriMap-pel.
 */

export interface Sticker3DEntry {
  id: string;
  label: string;
  /** worker-relatív render-URL (előnézethez is jó a teljes címmel) */
  url: string;
}

export async function listStickers3d(): Promise<Sticker3DEntry[] | null> {
  try {
    // 🔁 katalógus-olvasás: idempotens → időkorlát + egy újrapróba
    const res = await fetchRead(`${renderServerUrl()}/stickers3d`, { timeoutMs: 8000 });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { entries: Sticker3DEntry[] };
    return Array.isArray(body.entries) && body.entries.length > 0
      ? body.entries
      : null;
  } catch {
    return null;
  }
}

/** a sticker PNG letöltése helyi fájlba (weben a távoli URL megy vissza) */
export const STICKER_MATERIALS = [
  { id: 'original', label: 'lib.stickers3d.material.original' },
  { id: 'chrome', label: 'lib.stickers3d.material.chrome' },
  { id: 'gold', label: 'lib.stickers3d.material.gold' },
  { id: 'glass', label: 'lib.stickers3d.material.glass' },
  { id: 'matte', label: 'lib.stickers3d.material.matte' },
] as const;

export const STICKER_ENVIRONMENTS = [
  { id: 'studio', label: 'lib.stickers3d.environment.studio' },
  { id: 'sunset', label: 'lib.stickers3d.environment.sunset' },
  { id: 'night', label: 'lib.stickers3d.environment.night' },
  { id: 'neon', label: 'lib.stickers3d.environment.neon' },
] as const;

export async function downloadSticker3d(
  entry: Sticker3DEntry,
  opts: { yaw?: number; pitch?: number; material?: string; environment?: string } = {}
): Promise<string | null> {
  const yaw = Math.round(opts.yaw ?? -30);
  const pitch = Math.round(opts.pitch ?? 8);
  const material = opts.material ?? 'original';
  const environment = opts.environment ?? 'studio';
  const remote =
    `${renderServerUrl()}${entry.url}?yaw=${yaw}&pitch=${pitch}` +
    `&material=${material}&env=${environment}`;
  try {
    if (Platform.OS === 'web') {
      return remote;
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `st3d_${entry.id}_${yaw}_${pitch}_${material}_${environment}.png`);
    if (target.exists) {
      return target.uri;
    }
    const file = await File.downloadFileAsync(remote, target);
    return file.uri;
  } catch {
    return null;
  }
}
