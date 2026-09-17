/**
 * 🗃️ Korlátos, legrégebben-használt-kiesik cache.
 *
 * Az elemzés-eredmények (beat-rács, csend, jelenetek, felirat-cue-k, vision-
 * index) fájlonként memóriában élnek — ez helyes, mert az újraszámításuk
 * szerver-körrel jár. Eddig viszont SOHA nem ürültek: egy hosszú munkamenetben,
 * több projekt megnyitása után a `Map`-ek korlátlanul nőttek, és a
 * `clearCaches()` sem érte el őket.
 *
 * A `Map` beszúrási sorrendet tart, ezért az LRU olcsón megvalósítható:
 * olvasáskor a bejegyzést töröljük és visszaírjuk (így a végére kerül), túl-
 * csorduláskor pedig az első kulcs esik ki — az, amit a legrégebben érintettük.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      return undefined;
    }
    this.map.delete(key); // frissítés: a végére kerül, így nem ő esik ki legközelebb
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Az elemzés-cache-ek alapértelmezett mérete. Egy projekt tipikusan 10–40
 * médiafájlt érint; 64 bejegyzés lefedi a nyitott projektet és az előzőt is,
 * de nem hagyja korlátlanul nőni a munkamenetet.
 */
export const ANALYSIS_CACHE_LIMIT = 64;
