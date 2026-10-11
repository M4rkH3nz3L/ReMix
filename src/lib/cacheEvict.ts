/**
 * 🧹 LRU cache-eviction TERV (pure, expo-mentes — 06 §2.9 / 12 §2.7).
 *
 * Egy eldobható lemez-cache fájljait (kulcs + méret + utolsó-módosítás) egy
 * bájt-budgetre nyírja: a LEGRÉGEBBEN módosított fájlokat dobja, amíg a megmaradt
 * összméret a limit alá nem fér. A döntés tiszta → a tényleges fájl-IO (lista +
 * törlés) a hívóé (`cacheManager.pruneProxyCache`). Így a logika önmagában
 * tesztelhető, a nehéz fájlrendszer-függőségek nélkül.
 */

export interface CacheEntry {
  /** a fájl azonosítója (uri) — a hívó ez alapján törli */
  key: string;
  /** bájt-méret */
  size: number;
  /** utolsó módosítás (ms epoch) — a hiányzó/null 0-ként a legrégebbi */
  mtime: number;
}

export interface EvictionPlan {
  /** a törlendő fájlok kulcsai (a legrégebbiek előre) */
  evict: string[];
  /** a felszabaduló bájtok */
  freed: number;
  /** a megmaradó bájtok a törlés után */
  keptBytes: number;
}

/**
 * A `maxBytes` ≤ 0 mindent kidob; a limit alatti összméret üres tervet ad (nincs
 * fölös törlés). Holtverseny (azonos mtime) esetén a bemeneti sorrend stabil.
 */
export function planCacheEviction(entries: CacheEntry[], maxBytes: number): EvictionPlan {
  const total = entries.reduce((s, e) => s + Math.max(0, e.size), 0);
  if (total <= maxBytes) {
    return { evict: [], freed: 0, keptBytes: total };
  }
  // LRU: a legrégebben módosított megy először (növekvő mtime, stabil)
  const sorted = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.mtime - b.e.mtime || a.i - b.i)
    .map(({ e }) => e);
  const evict: string[] = [];
  let freed = 0;
  let kept = total;
  for (const e of sorted) {
    if (kept <= maxBytes) {
      break;
    }
    evict.push(e.key);
    const sz = Math.max(0, e.size);
    freed += sz;
    kept -= sz;
  }
  return { evict, freed, keptBytes: kept };
}
