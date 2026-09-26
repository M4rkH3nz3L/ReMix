import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { clearBeatMemory } from '@/lib/beats';
import { clearCutlistMemory } from '@/lib/cutlist';
import { clearProxyMemory } from '@/lib/proxy';
import { clearThumbnailCache } from '@/lib/thumbnails';
import { clearTranscriptMemory } from '@/lib/transcripts';
import { clearVisionMemory } from '@/lib/visionSearch';
import { clearVoiceProxyMemory } from '@/lib/voiceProxy';
import { clearWaveformMemory } from '@/lib/waveform';

/**
 * 🧹 Cache-kezelés: az ELDOBHATÓ, újragenerálható gyorsítótárak mérete és
 * ürítése — vágási proxyk (`proxies/`) és hullámforma-cache (`wf_*.json`). A
 * projekt-médiát (`media/`) és a renderelt kimeneteket (`renders/`) NEM érinti,
 * mert azok a projekthez tartozó tartalmak, nem eldobható cache.
 */

/**
 * Az új expo-file-system API (`Directory`/`File`/`Paths`) NATÍV-only — weben a
 * `new Directory(...)` már a KONSTRUKTORBAN elszáll (`this.validatePath is not a
 * function`). Weben amúgy sincs on-device proxy/hullámforma/thumbnail cache
 * (azok natív pipeline-ok), ezért ott a lemezes rész NO-OP: a riport nulla, az
 * ürítés csak a memória-cache-eket takarítja. A `Directory`-t THUNK-ból építjük,
 * hogy maga a konstrukció is a try/catch mögé essen.
 */
const HAS_DISK_CACHE = Platform.OS !== 'web';

function fileList(makeDir: () => Directory): File[] {
  if (!HAS_DISK_CACHE) {
    return [];
  }
  try {
    const dir = makeDir();
    if (!dir.exists) {
      return [];
    }
    return dir.list().filter((e): e is File => e instanceof File);
  } catch {
    return [];
  }
}

function waveformFiles(): File[] {
  if (!HAS_DISK_CACHE) {
    return [];
  }
  try {
    return new Directory(Paths.cache)
      .list()
      .filter((e): e is File => e instanceof File && e.name.startsWith('wf_'));
  } catch {
    return [];
  }
}

const sumBytes = (files: File[]): number => files.reduce((s, f) => s + (f.size ?? 0), 0);

/**
 * Az `expo-video-thumbnails` mindkét platformon ide írja a generált JPEG-eket.
 * A memória-cache kiszórása a FÁJLT nem törli, ezért a mappa a munkamenet alatt
 * folyamatosan nő — eddig sem mérve, sem ürítve nem volt.
 */
function thumbnailDir(): Directory {
  return new Directory(Paths.cache, 'VideoThumbnails');
}

export interface CacheReport {
  /** vágási proxyk össz-mérete (byte) */
  proxies: number;
  /** hullámforma-cache össz-mérete (byte) */
  waveforms: number;
  /** filmstrip-képkockák össz-mérete (byte) */
  thumbnails: number;
  total: number;
}

export function cacheReport(): CacheReport {
  const proxies = sumBytes(fileList(() => new Directory(Paths.document, 'proxies')));
  const waveforms = sumBytes(waveformFiles());
  const thumbnails = sumBytes(fileList(() => thumbnailDir()));
  return { proxies, waveforms, thumbnails, total: proxies + waveforms + thumbnails };
}

/** Az eldobható cache-ek (proxy + hullámforma) törlése lemezről és memóriából. */
export function clearCaches(): void {
  for (const f of fileList(() => new Directory(Paths.document, 'proxies'))) {
    try {
      f.delete();
    } catch {
      /* ignore */
    }
  }
  for (const f of waveformFiles()) {
    try {
      f.delete();
    } catch {
      /* ignore */
    }
  }
  for (const f of fileList(() => thumbnailDir())) {
    try {
      f.delete();
    } catch {
      /* ignore */
    }
  }
  clearProxyMemory();
  clearWaveformMemory();
  clearThumbnailCache();
  // az elemzés-cache-ek eddig KIMARADTAK innen: a „cache ürítése" gomb nem
  // szabadította fel őket, pedig a munkamenet alatt korlátlanul nőttek
  clearBeatMemory();
  clearCutlistMemory();
  clearTranscriptMemory();
  clearVisionMemory();
  clearVoiceProxyMemory();
}

/** Ember-olvasható méret. */
export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
