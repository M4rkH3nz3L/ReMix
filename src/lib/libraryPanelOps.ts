import type { StorageEntry } from '@/lib/storageProviders';
import type { YtKind } from '@/lib/youtube';

/**
 * 📚 A videó-szerkesztő Tár-paneljének (`components/editor/panels/LibraryPanel.tsx`)
 * expo-mentes magja: a forrásonkénti betöltési állapot, a fájlméret-kijelzés, a
 * név-szűrés, a forrás durable URL-je és a képkocka-import időpontja.
 * (REFACTOR: a LibraryPanel.tsx-ből kiemelve, a számítás változatlan.)
 */

export type ProviderState =
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'error'; message: string }
  | { state: 'ready'; entries: StorageEntry[] };

export function formatSize(bytes?: number): string {
  if (!bytes) {
    return '';
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** minden forrás „töltődik" állapotban */
export function loadingStates(providers: { id: string }[]): Record<string, ProviderState> {
  return Object.fromEntries(providers.map((p) => [p.id, { state: 'loading' as const }]));
}

/** 🔎 Médiatár-kereső (P0‑8): a szűrő-kifejezés (kisbetűs, levágott) */
export function libraryQuery(filter: string): string {
  return filter.trim().toLowerCase();
}

/** név szerinti egyezés (üres kifejezésre minden egyezik) */
export function matchesQuery(name: string, query: string): boolean {
  return !query || name.toLowerCase().includes(query);
}

/** a forrás látható tételei: a 3D-fájl nem idővonal-média (a 3D Stúdióban használható) → itt nem kínáljuk */
export function visibleEntries(st: ProviderState, query: string): StorageEntry[] {
  return st.state === 'ready' ? st.entries.filter((e) => e.kind !== 'model' && matchesQuery(e.name, query)) : [];
}

/**
 * A forrás durable worker-URL-je → `remoteUrl`: http(s)-forrásnál maga a feloldott URI,
 * különben a worker-cím + a tétel útja (a worker-címet csak ekkor kéri le).
 */
export function entryRemoteUrl(resolvedUri: string, entryUrl: string, serverUrl: () => string): string {
  return /^https?:\/\//i.test(resolvedUri) ? resolvedUri : `${serverUrl()}${entryUrl}`;
}

/** a képkocka-import időpontja (mp; üres / érvénytelen → 1); más fajtánál nincs */
export function importAtSec(kind: YtKind, imgSec: string): number | undefined {
  return kind === 'image' ? parseFloat(imgSec) || 1 : undefined;
}
