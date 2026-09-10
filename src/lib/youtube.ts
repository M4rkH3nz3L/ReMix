import { Directory, File, Paths } from 'expo-file-system';

import { cloudBaseUrl, ensureCloud } from '@/lib/backend';
import { makeId } from '@/lib/id';
import type { ProgressUpdate } from '@/lib/progress';

/**
 * URL-import kliens (YouTube stb.): a felhő-worker yt-dlp-alapú végpontja.
 * Egy URL-ből tölthető le a teljes VIDEÓ, csak a HANG, vagy egy KÉP (képkocka),
 * és az eszközre kerül (Documents/media), majd a megfelelő sávra a Studióban.
 * Ez PRO-funkció (`urlImport`) — a `ensureCloud` gate a hívás előtt ellenőriz.
 */

export type YtKind = 'video' | 'audio' | 'image';

export interface YtImport {
  uri: string;
  kind: YtKind;
  duration: number;
  width?: number;
  height?: number;
}

/** Elérhető-e a worker URL-importja (yt-dlp) — a /health `youtube` flagje. */
export async function youtubeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${cloudBaseUrl()}/health`);
    if (!res.ok) {
      return false;
    }
    const body = await res.json();
    return Boolean(body.youtube);
  } catch {
    return false;
  }
}

/**
 * Import egy URL-ből a workeren, majd letöltés az eszközre. A `kind` szerint
 * teljes videó / csak hang (m4a) / egy képkocka (`atSec`-nél). { uri, duration, … }.
 */
export async function importYouTubeMedia(
  url: string,
  kind: YtKind,
  atSec?: number,
  onProgress?: (update: ProgressUpdate) => void
): Promise<YtImport> {
  const base = ensureCloud('urlImport');
  // a szerver-oldali kinyerés hossza nem mérhető előre (yt-dlp), ezért ez a
  // fázis határozatlan — de a felhasználó legalább látja, MI történik épp
  onProgress?.({ phase: 'Kinyerés a forrásból' });
  const res = await fetch(`${base}/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, kind, atSec }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? 'Az import nem sikerült.');
  }
  const ext = (body.name as string).split('.').pop() || 'mp4';
  const dir = new Directory(Paths.document, 'media');
  try {
    dir.create();
  } catch {
    /* már létezik */
  }
  const target = new File(dir, `yt_${makeId('m')}.${ext}`);
  onProgress?.({ phase: 'Letöltés az eszközre' });
  await File.downloadFileAsync(`${base}/youtube/${body.id}/${body.name}`, target);
  onProgress?.({ phase: 'Kész', ratio: 1 });
  return {
    uri: target.uri,
    kind: body.kind,
    duration: body.duration ?? 0,
    width: body.width,
    height: body.height,
  };
}
