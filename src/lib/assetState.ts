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

// ── UI: megjelenítés-állapot + jelző (badge) ────────────────────────────────

/** Helyben elérhető-e az asset a valós uri alapján (nem http(s) stream → helyi fájl). */
export function assetLocallyAvailable(asset: Pick<Asset, 'uri'>): boolean {
  return !/^https?:\/\//i.test(asset.uri || '');
}

/** Az asset SZINKRON megjelenítés-állapota a provider + uri-ból (a UI-jelzőhöz). */
export function assetDisplayState(asset: Pick<Asset, 'provider' | 'uri'>): AssetState {
  return assetStateOf(asset, { localAvailable: assetLocallyAvailable(asset) });
}

export interface AssetBadge {
  /** Ionicons glyph-név */
  icon: string;
  /** i18n-kulcs (`asset.state.*`) */
  labelKey: string;
  /** szín-hangulat a UI-nak */
  tone: 'ok' | 'dim' | 'warn';
}

const BADGES: Record<AssetState, AssetBadge> = {
  imported: { icon: 'checkmark-circle', labelKey: 'asset.state.imported', tone: 'ok' },
  cached: { icon: 'checkmark-circle-outline', labelKey: 'asset.state.cached', tone: 'ok' },
  external: { icon: 'cloud-outline', labelKey: 'asset.state.external', tone: 'dim' },
  stale: { icon: 'warning-outline', labelKey: 'asset.state.stale', tone: 'warn' },
  invalidated: { icon: 'close-circle-outline', labelKey: 'asset.state.invalidated', tone: 'warn' },
};

/** Az állapothoz tartozó UI-jelző (ikon + i18n-címke + szín-hangulat). */
export function assetStateBadge(state: AssetState): AssetBadge {
  return BADGES[state];
}

/** Felkínálható-e „letöltés helyi másolatba" — a külső, nem helyben lévő forrásra. */
export function canDownload(state: AssetState): boolean {
  return state === 'external' || state === 'stale' || state === 'invalidated';
}

/** Felkínálható-e „eltávolítás a cache-ből" — a külső forrás letöltött másolatára
 *  (a device-saját `imported`-ot NEM, mert annak nincs távoli visszaállítása). */
export function canEvict(state: AssetState): boolean {
  return state === 'cached';
}

// ── §03.2 Eviction-politika (LRU + byte-cap, adatvesztés-védett) ──────────────

/**
 * Automatikus cache-eviction szempontjából dobható-e: CSAK a távoli forrásból
 * ÚJRA-LETÖLTHETŐ állapotok (`cached` friss, `stale` elavult). A device-saját
 * `imported`-ot SOHA (nincs távoli másolat → adatvesztés, ADR-013). A `canEvict`
 * (UI-gomb) ennél szigorúbb — csak a friss `cached`-et kínálja kézzel.
 */
export function isCacheEvictable(state: AssetState): boolean {
  return state === 'cached' || state === 'stale';
}

/** Foglal-e HELYI tárat (van letöltött fájlja) — a byte-cap számításához.
 *  (A `isLocallyAvailable` az AZONNAL renderelhetőt jelenti, az kizárja a stale-t.) */
export function occupiesDisk(state: AssetState): boolean {
  return state === 'cached' || state === 'imported' || state === 'stale';
}

export interface CacheEntry {
  /** a hívó azonosítója — a kiválasztott bejegyzéseket ezzel kapja vissza */
  id?: string;
  /** az asset állapota (a hívó számolja `assetStateOf`/`assetDisplayState`-tel) */
  state: AssetState;
  /** a helyi fájl mérete bájtban */
  bytes?: number;
  /** utolsó hozzáférés (ms epoch) — az LRU-rendezéshez */
  lastAccessMs?: number;
}

/**
 * LRU + byte-cap eviction-TERV: ha a helyben tárolt méret meghaladja a cap-et, a
 * legrégebben használt, ÚJRA-LETÖLTHETŐ (`isCacheEvictable`) bejegyzéseket választja
 * ki, amíg a cap alá nem ér. A device-saját `imported`-ot SOHA nem dobja — ha emiatt
 * a cap fölött marad, a maradékot visszaadatlanul hagyja (a hívó jelzi a usernek;
 * nincs adatvesztés, ADR-013). Tiszta: a méret/idő a hívótól jön.
 */
export function selectForEviction(
  entries: readonly CacheEntry[],
  { maxBytes }: { maxBytes: number },
): CacheEntry[] {
  const list = entries ?? [];
  let total = list
    .filter((e) => occupiesDisk(e.state))
    .reduce((s, e) => s + Math.max(0, e.bytes ?? 0), 0);
  if (total <= maxBytes) {
    return [];
  }
  const evictable = list
    .filter((e) => isCacheEvictable(e.state))
    .sort((a, b) => (a.lastAccessMs ?? 0) - (b.lastAccessMs ?? 0)); // legrégebbi elöl
  const out: CacheEntry[] = [];
  for (const e of evictable) {
    if (total <= maxBytes) {
      break;
    }
    out.push(e);
    total -= Math.max(0, e.bytes ?? 0);
  }
  return out;
}

// ── §03.3 Remote-changed verziózás (ETag / Last-Modified) ─────────────────────

export interface RemoteMeta {
  etag?: string | null;
  lastModified?: string | null;
}

export type RemoteChange = 'unchanged' | 'changed' | 'unknown';

/**
 * Megváltozott-e a távoli forrás a cache-elt verzióhoz képest. ETag-elsőbbség
 * (erős validátor); ha az nincs mindkét oldalon, a Last-Modified dönt (a távoli
 * ÚJABB → changed); ha egyik sem összevethető → unknown. A `changed` eredményt a
 * hívó `assetStateOf(..., { remoteChanged: true })`-ba vezeti → az asset `stale` lesz.
 */
export function remoteChangeDecision(cached: RemoteMeta, remote: RemoteMeta): RemoteChange {
  const ce = cached?.etag?.trim();
  const re = remote?.etag?.trim();
  if (ce && re) {
    return ce === re ? 'unchanged' : 'changed';
  }
  const cm = Date.parse(cached?.lastModified ?? '');
  const rm = Date.parse(remote?.lastModified ?? '');
  if (Number.isFinite(cm) && Number.isFinite(rm)) {
    return rm > cm ? 'changed' : 'unchanged';
  }
  return 'unknown';
}

/** Rövid forma: BIZTOSAN megváltozott-e (az 'unknown' NEM számít változásnak). */
export function remoteChanged(cached: RemoteMeta, remote: RemoteMeta): boolean {
  return remoteChangeDecision(cached, remote) === 'changed';
}
