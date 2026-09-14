import { Directory, File, Paths } from 'expo-file-system';

import { clearProxyMemory } from '@/lib/proxy';
import { clearThumbnailCache } from '@/lib/thumbnails';
import { clearWaveformMemory } from '@/lib/waveform';

/**
 * 🧹 Cache-kezelés: az ELDOBHATÓ, újragenerálható gyorsítótárak mérete és
 * ürítése — vágási proxyk (`proxies/`) és hullámforma-cache (`wf_*.json`). A
 * projekt-médiát (`media/`) és a renderelt kimeneteket (`renders/`) NEM érinti,
 * mert azok a projekthez tartozó tartalmak, nem eldobható cache.
 */

function fileList(dir: Directory): File[] {
  if (!dir.exists) {
    return [];
  }
  try {
    return dir.list().filter((e): e is File => e instanceof File);
  } catch {
    return [];
  }
}

function waveformFiles(): File[] {
  try {
    return new Directory(Paths.cache)
      .list()
      .filter((e): e is File => e instanceof File && e.name.startsWith('wf_'));
  } catch {
    return [];
  }
}

const sumBytes = (files: File[]): number => files.reduce((s, f) => s + (f.size ?? 0), 0);

export interface CacheReport {
  /** vágási proxyk össz-mérete (byte) */
  proxies: number;
  /** hullámforma-cache össz-mérete (byte) */
  waveforms: number;
  total: number;
}

export function cacheReport(): CacheReport {
  const proxies = sumBytes(fileList(new Directory(Paths.document, 'proxies')));
  const waveforms = sumBytes(waveformFiles());
  return { proxies, waveforms, total: proxies + waveforms };
}

/** Az eldobható cache-ek (proxy + hullámforma) törlése lemezről és memóriából. */
export function clearCaches(): void {
  for (const f of fileList(new Directory(Paths.document, 'proxies'))) {
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
  clearProxyMemory();
  clearWaveformMemory();
  clearThumbnailCache();
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
