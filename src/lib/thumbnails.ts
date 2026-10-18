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

/** Egy csempe minimum négyzet-mérete px-ben (a sáv-magassághoz igazítva, de ≥ 24). */
const MIN_TILE = 24;
/** Max. csempe-szám EGY klipre — perf-korlát a kocka-generálásra (hosszú klip is ennyi). */
export const FILMSTRIP_MAX_TILES = 48;

/**
 * 🎞️ Filmstrip-elrendezés egy klipre: HÁNY csempe, mekkora SZÉLESSÉGGEL, és MELY
 * forrás-időpontokról.
 *
 * A csempe-szám a klip renderelt szélességéből jön (négyzetes cél: `widthPx/tile`),
 * de `[1, maxTiles]`-re szorítva (perf). A KULCS: `tileW = widthPx / count`, így a
 * csempék VÉGIG kitöltik a klip teljes szélességét — NEM ragadnak meg az első N
 * csempénél fix szélességgel (ez volt a „hosszú klipnél 22 mp után üres" bug: a
 * csempék `tile` szélesen, balról töltöttek, a maradék üres maradt). A `times` a
 * klip TELJES hosszán oszlik el (minden csempe a saját idő-szelete közepéről),
 * trim/sebesség-helyesen, 0,5 mp-re pattintva (cache-barát) — így az UTOLSÓ csempe
 * a klip VÉGÉHEZ közeli kockát mutat, nem a 22. mp-nél elakadva.
 */
export function filmstripTiles(
  widthPx: number,
  heightPx: number,
  durationSec: number,
  trimIn: number,
  speed: number,
  maxTiles: number = FILMSTRIP_MAX_TILES
): { count: number; tileW: number; times: number[] } {
  const tile = Math.max(MIN_TILE, heightPx);
  const w = Math.max(0, widthPx);
  const count = Math.max(1, Math.min(maxTiles, Math.ceil(w / tile)));
  const tileW = w > 0 ? w / count : tile;
  const times = Array.from({ length: count }, (_, i) =>
    snapThumbTime(trimIn + (i + 0.5) * (durationSec / count) * speed)
  );
  return { count, tileW, times };
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
