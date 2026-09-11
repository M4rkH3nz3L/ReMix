import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { cloudBaseUrl, ensureCloud } from '@/lib/backend';
import { makeId } from '@/lib/id';
import type { ProgressUpdate } from '@/lib/progress';
import { importYouTubeLocal } from '@/lib/youtubeLocal';

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
  // 1) 🆓 INGYENES on-device út (YouTube, videó/hang): nincs worker, nincs Pro —
  //    amit a készülék maga meg tud csinálni, az a felhasználónak ingyen jár.
  //    Best-effort: ha eszközön nem oldható meg (HD, más oldal, képkocka, vagy a
  //    YouTube nem ad direkt streamet), null-t ad → a fizetős worker-útra esünk.
  if (Platform.OS !== 'web') {
    try {
      const local = await importYouTubeLocal(url, kind, onProgress);
      if (local) {
        return local;
      }
    } catch {
      // best-effort — bármi hiba esetén megy tovább a worker-fallback
    }
  }

  // 2) 💳 FIZETŐS worker-út (HD, más oldalak, képkocka): yt-dlp + ffmpeg a
  //    workeren → Pro-kapu (ensureCloud dob, ha nincs előfizetés).
  const base = ensureCloud('urlImport');
  // a szerver-oldali kinyerés hossza nem mérhető előre (yt-dlp), ezért ez a
  // fázis határozatlan — de a felhasználó legalább látja, MI történik épp
  onProgress?.({ phase: tr('lib.youtube.phaseExtract') });
  const res = await fetch(`${base}/youtube`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, kind, atSec }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? tr('lib.youtube.importFailed'));
  }
  const ext = (body.name as string).split('.').pop() || 'mp4';
  const dir = new Directory(Paths.document, 'media');
  try {
    dir.create();
  } catch {
    /* már létezik */
  }
  const target = new File(dir, `yt_${makeId('m')}.${ext}`);
  onProgress?.({ phase: tr('lib.youtube.phaseDownload') });
  await File.downloadFileAsync(`${base}/youtube/${body.id}/${body.name}`, target);
  onProgress?.({ phase: tr('lib.youtube.phaseDone'), ratio: 1 });
  return {
    uri: target.uri,
    kind: body.kind,
    duration: body.duration ?? 0,
    width: body.width,
    height: body.height,
  };
}
