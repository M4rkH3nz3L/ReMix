import * as VideoThumbnails from 'expo-video-thumbnails';
import { Platform } from 'react-native';

import { LruCache } from '@/lib/lruCache';

/**
 * Filmstrip-képkockák a videóklipekhez (full-plan F2 thumbnail-szelet, kliens-
 * oldalon). Minden (uri, másodperc) párhoz egyszer generálunk képkockát; a
 * kulcs fél másodpercre kerekít, így trim/zoom közben a legtöbb kocka
 * cache-találat. A generálás sorban fut, hogy ne terhelje túl a natív dekódert.
 */

/**
 * 🛡️ memóriavédelem: a képkocka-cache felső határa. A generált JPEG-ek a
 * `<cache>/VideoThumbnails/` mappába kerülnek (mindkét platformon) — a memóriából
 * kiszórt bejegyzés fájlja ott marad, ezért a `cacheManager` MÉRI és ÜRÍTI azt
 * a mappát.
 */
const MAX_CACHE = 300;
const cache = new LruCache<Promise<string | null>>(MAX_CACHE);

function thumbAt(uri: string, second: number): Promise<string | null> {
  const key = `${uri}@${second}`;
  const pending =
    cache.get(key) ?? // az olvasás egyben frissít is (LRU)
    VideoThumbnails.getThumbnailAsync(uri, {
      time: Math.max(0, Math.round(second * 1000)),
      quality: 0.4,
    })
      .then((result) => result.uri)
      .catch(() => null);
  cache.set(key, pending);
  return pending;
}

/** A memória-képcache ürítése (cache-kezelés / memória-nyomás alatt). */
export function clearThumbnailCache(): void {
  cache.clear();
}

/** cache-barát időpont: fél másodpercre kerekítve */
export function snapThumbTime(second: number): number {
  return Math.max(0, Math.round(second * 2) / 2);
}

export async function getFilmstrip(
  uri: string,
  times: number[]
): Promise<(string | null)[]> {
  if (Platform.OS === 'web') {
    return times.map(() => null);
  }
  const out: (string | null)[] = [];
  for (const t of times) {
    out.push(await thumbAt(uri, t));
  }
  return out;
}
