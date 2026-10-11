/**
 * ☁️ Felhő-render PREFLIGHT (pure, expo-mentes). A `/health` válaszából + a
 * projekt hosszából eldönti, hogy a felhő-render ténylegesen feldolgozható-e,
 * MIELŐTT a kliens feltöltené a médiát. A hosszú videó a felhő-queue-ba kerül
 * (worker dolgozza fel); ha egyetlen worker sem él, a job „waiting"-ben ülne, a
 * kliens pedig ~25%-on ragadna a timeoutig. Ezt fogjuk meg előre.
 *
 * (A szerver is fail-fast-ol az enqueue-nál — ez a kliens-oldali, feltöltés
 * ELŐTTI párja, hogy ne pazaroljunk fel sávszélességet egy feldolgozhatatlan jobra.)
 */

export interface RenderHealth {
  /** 'cloud+local' | 'local' — van-e felhő-queue egyáltalán */
  render?: string;
  /** e másodperc fölött megy a videó a felhő-queue-ba (alap 15) */
  cloudRenderMinSec?: number;
  /** élő render-workerek száma (heartbeat, 20s TTL) */
  workers?: number;
}

/**
 * Sorba kerülne-e a render (hosszú videó + van felhő-mód), DE nincs élő worker?
 * `true` → a hívó beszédes hibát dob a feltöltés előtt. Hiányzó mezők biztonságos
 * alapértékekkel (nem blokkolunk, ha a health nem mondja meg — a szerver-gate a backstop).
 */
export function cloudRenderBlocked(health: RenderHealth, durationSec: number): boolean {
  const cloudCapable = typeof health.render === 'string' && health.render.includes('cloud');
  const min = typeof health.cloudRenderMinSec === 'number' ? health.cloudRenderMinSec : 15;
  const willQueue = cloudCapable && durationSec > min;
  // a `workers` hiányát (régi szerver, ami még nem jelenti) NEM tekintjük
  // blokkolásnak — csak az explicit 0-t (van jelentés, és tényleg nincs worker)
  return willQueue && health.workers === 0;
}
