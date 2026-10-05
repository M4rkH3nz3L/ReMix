import type { Asset } from '@/types/project';

/**
 * 🗄️ Asset-állapotgép (audit §8.2) — tiszta, expo-mentes mag.
 *
 * A külső (Drive/Dropbox/S3/remote) assetek életciklusa explicit állapotokkal:
 *   external → (download) → cached → (import) → imported
 * plusz a hibák/elavulás: `stale` (a távoli forrás megváltozott), `invalidated`
 * (a cache érvénytelen). Az állapotot a VALÓS Asset-mezőkből számoljuk
 * (`assetStateOf`), és az átmeneteket egy táblázat írja le (`nextState`) — így a
 * cache-eviction, offline és stale-kezelés egy helyen, determinisztikusan, tesztelten.
 * A device-saját nyers fájl (`provider:'local'`) mindig `imported`.
 */

export type AssetState = 'external' | 'cached' | 'imported' | 'stale' | 'invalidated';

export interface AssetStateInput {
  /** van-e HELYI (letöltött) másolat (a hívó dönti el, pl. file-exists-check). */
  localAvailable?: boolean;
  /** a távoli forrás MEGVÁLTOZOTT a cache óta (hash/etag eltér). */
  remoteChanged?: boolean;
  /** a cache-t érvénytelennek jelölték (kézi purge / verzió-ugrás). */
  invalidated?: boolean;
}

/** Az asset aktuális állapota a valós mezőkből + a hívó jelzéseiből. */
export function assetStateOf(asset: Pick<Asset, 'provider'>, input: AssetStateInput = {}): AssetState {
  if (input.invalidated) {
    return 'invalidated';
  }
  // az eszközön létrehozott/importált nyers fájl: a projekté, mindig elérhető
  if (asset.provider === 'local') {
    return 'imported';
  }
  // külső forrás (remote/library):
  if (input.localAvailable) {
    return input.remoteChanged ? 'stale' : 'cached';
  }
  return 'external';
}

export type AssetEvent =
  | 'download' // letöltés a helyi cache-be
  | 'import' // a cache-elt fájl a projekt sajátjává válik
  | 'evict' // a helyi másolat törlése (hely-felszabadítás)
  | 'invalidate' // a cache érvénytelenítése
  | 'remoteChanged' // a távoli forrás módosult
  | 'refresh'; // az elavult/érvénytelen cache frissítése

/** Megengedett átmenetek: állapot → (esemény → új állapot). */
const TRANSITIONS: Record<AssetState, Partial<Record<AssetEvent, AssetState>>> = {
  external: { download: 'cached' },
  cached: { import: 'imported', evict: 'external', remoteChanged: 'stale', invalidate: 'invalidated' },
  imported: { remoteChanged: 'stale', invalidate: 'invalidated', evict: 'external' },
  stale: { refresh: 'cached', evict: 'external', invalidate: 'invalidated' },
  invalidated: { download: 'cached', refresh: 'cached' },
};

/** Az esemény utáni állapot; ismeretlen/nem-megengedett átmenetnél változatlan. */
export function nextState(current: AssetState, event: AssetEvent): AssetState {
  return TRANSITIONS[current]?.[event] ?? current;
}

/** Megengedett-e az átmenet az adott állapotból az eseménnyel. */
export function canTransition(from: AssetState, event: AssetEvent): boolean {
  return !!TRANSITIONS[from]?.[event];
}

/** Helyben elérhető-e (azonnal használható renderhez/preview-hoz). */
export function isLocallyAvailable(state: AssetState): boolean {
  return state === 'cached' || state === 'imported';
}

/** Kell-e (le)tölteni a használat előtt. */
export function needsFetch(state: AssetState): boolean {
  return state === 'external' || state === 'stale' || state === 'invalidated';
}
