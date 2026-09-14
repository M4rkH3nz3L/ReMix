import * as VideoThumbnails from 'expo-video-thumbnails';
import { Platform } from 'react-native';

/**
 * Filmstrip-képkockák a videóklipekhez (full-plan F2 thumbnail-szelet, kliens-
 * oldalon). Minden (uri, másodperc) párhoz egyszer generálunk képkockát; a
 * kulcs fél másodpercre kerekít, így trim/zoom közben a legtöbb kocka
 * cache-találat. A generálás sorban fut, hogy ne terhelje túl a natív dekódert.
 */

const cache = new Map<string, Promise<string | null>>();
/** 🛡️ memóriavédelem: a képkocka-cache felső határa (a legrégebbit dobjuk) */
const MAX_CACHE = 300;

function thumbAt(uri: string, second: number): Promise<string | null> {
  const key = `${uri}@${second}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = VideoThumbnails.getThumbnailAsync(uri, {
      time: Math.max(0, Math.round(second * 1000)),
      quality: 0.4,
    })
      .then((result) => result.uri)
      .catch(() => null);
    // a legrégebben beszúrt bejegyzést dobjuk, ha túlnőne a cache
    while (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      cache.delete(oldest);
    }
    cache.set(key, pending);
  } else {
    // LRU: a használt kulcs a sor végére kerül
    cache.delete(key);
    cache.set(key, pending);
  }
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
