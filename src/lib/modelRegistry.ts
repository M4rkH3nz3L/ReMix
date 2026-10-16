/**
 * 📦 Modell-registry — tiszta manifest-logika (Ai §06.2).
 *
 * A letölthető LOKÁL modellek (Whisper-variánsok, embedding, kis SLM, ONNX-detektor)
 * manifestje + a köré épülő döntések: checksum-ellenőrzés (sha256), verzió-összevetés
 * (elavult-e a cache-elt), feloldás (use_cached / download / update) és lemez-cache
 * LRU-eviction (hely-limit, a HASZNÁLATBAN lévő modellt sosem dobja). Expo-mentes,
 * tiszta → önmagában tesztelt; a tényleges letöltés/FS-cache a `modelRegistryClient`.
 * A [aiRouting](./aiRouting.ts) 'device'/'hybrid' döntése ezekre a modellekre épül.
 */

export type ModelKind = 'whisper' | 'embedding' | 'slm' | 'onnx' | 'vision';

export interface ModelManifestEntry {
  id: string;
  version: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  kind: ModelKind;
}

export interface CachedModel {
  id: string;
  version: string;
  sizeBytes?: number;
  /** utolsó használat (ms epoch) — az LRU-rendezéshez */
  lastUsedMs?: number;
  /** épp használatban / rögzített → SOHA nem dobható */
  pinned?: boolean;
}

/** Hash-normalizálás: trim + kisbetű (a sha256 összevetés case-insensitive). */
export function normalizeHash(h: string | null | undefined): string {
  return String(h ?? '').trim().toLowerCase();
}

/** Érvényes-e a letöltött tartalom: a tényleges és a várt sha256 egyezik (és nem üres). */
export function verifyChecksum(expectedSha256: string, actualSha256: string): boolean {
  const e = normalizeHash(expectedSha256);
  const a = normalizeHash(actualSha256);
  return e.length > 0 && e === a;
}

/** Pont-elválasztott numerikus verzió-összevetés: −1 (a<b) / 0 / 1 (a>b). Hiányzó szegmens = 0. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = String(a ?? '').split('.');
  const pb = String(b ?? '').split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = Number(pa[i] ?? 0) || 0;
    const y = Number(pb[i] ?? 0) || 0;
    if (x < y) {
      return -1;
    }
    if (x > y) {
      return 1;
    }
  }
  return 0;
}

/** Elavult-e a cache-elt verzió a manifesthez képest (cached < manifest). */
export function isOutdated(cachedVersion: string, manifestVersion: string): boolean {
  return compareVersions(cachedVersion, manifestVersion) < 0;
}

export type ResolveAction = 'use_cached' | 'download' | 'update';

/**
 * Mi a teendő egy manifest-bejegyzéssel a cache alapján: nincs cache → download,
 * elavult → update, különben use_cached.
 */
export function resolveModel(
  entry: ModelManifestEntry,
  cached: CachedModel | undefined,
): { action: ResolveAction; reason: string } {
  if (!cached) {
    return { action: 'download', reason: 'not_cached' };
  }
  if (isOutdated(cached.version, entry.version)) {
    return { action: 'update', reason: 'outdated' };
  }
  return { action: 'use_cached', reason: 'current' };
}

/**
 * LRU + byte-cap eviction-TERV a modell-cache-re: ha a teljes méret meghaladja a
 * cap-et, a legrégebben használt, NEM rögzített modelleket választja, amíg a cap alá
 * nem ér. A `pinned` (használatban lévő) modellt SOHA nem dobja — ha emiatt a cap
 * fölött marad, a maradékot visszaadatlanul hagyja. Tiszta.
 */
export function planModelEviction(
  cached: readonly CachedModel[],
  { maxBytes }: { maxBytes: number },
): CachedModel[] {
  const list = cached ?? [];
  let total = list.reduce((s, m) => s + Math.max(0, m.sizeBytes ?? 0), 0);
  if (total <= maxBytes) {
    return [];
  }
  const evictable = list
    .filter((m) => !m.pinned)
    .sort((a, b) => (a.lastUsedMs ?? 0) - (b.lastUsedMs ?? 0)); // legrégebbi elöl
  const out: CachedModel[] = [];
  for (const m of evictable) {
    if (total <= maxBytes) {
      break;
    }
    out.push(m);
    total -= Math.max(0, m.sizeBytes ?? 0);
  }
  return out;
}
