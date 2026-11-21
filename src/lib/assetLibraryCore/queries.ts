import { keywordScore, normalizeText } from '@/lib/visionIndex';
import type { AssetKind, AssetLibrary, LibraryAsset } from '@/lib/assetLibraryCore/model';

/** „Mely projektek használják ezt az assetet?" */
export function usageOf(lib: AssetLibrary, assetId: string): string[] {
  return lib.assets.find((a) => a.id === assetId)?.usage ?? [];
}

/** „Mely assetek szerepelnek ebben a projektben?" */
export function assetsInProject(lib: AssetLibrary, projectId: string): LibraryAsset[] {
  return lib.assets.filter((a) => a.usage.includes(projectId));
}

// ── Lekérdezés / szűrés / keresés ───────────────────────────────────────────

export interface AssetFilter {
  kind?: AssetKind;
  tag?: string;
  collection?: string;
  favorite?: boolean;
  minRating?: number;
  /** szabad-szavas lekérdezés (név + tagek + forrás + creator fölött). */
  query?: string;
}

const haystack = (a: LibraryAsset): string =>
  [a.name, a.tags.join(' '), a.source ?? '', a.creator ?? '', a.kind].join(' ');

export function filterAssets(lib: AssetLibrary, f: AssetFilter): LibraryAsset[] {
  const q = f.query?.trim();
  return lib.assets.filter((a) => {
    if (f.kind && a.kind !== f.kind) {
      return false;
    }
    if (f.tag && !a.tags.includes(f.tag)) {
      return false;
    }
    if (f.collection && !a.collections.includes(f.collection)) {
      return false;
    }
    if (f.favorite && !a.favorite) {
      return false;
    }
    if (f.minRating !== undefined && a.rating < f.minRating) {
      return false;
    }
    if (q && keywordScore(q, haystack(a)) <= 0 && !normalizeText(haystack(a)).includes(normalizeText(q))) {
      return false;
    }
    return true;
  });
}

/** Rangsorolt szöveges keresés (a ⌘K asset-scope-jához is). */
export function searchAssets(lib: AssetLibrary, query: string, limit = 20): { asset: LibraryAsset; score: number }[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  const nq = normalizeText(q);
  return lib.assets
    .map((asset) => {
      const hay = haystack(asset);
      let score = keywordScore(q, hay);
      // pontos név-tartalmazás erős boost, hogy a rövid nevek is felférjenek
      if (normalizeText(asset.name).includes(nq)) {
        score += 0.5;
      }
      if (asset.tags.some((t) => normalizeText(t) === nq)) {
        score += 0.3;
      }
      return { asset, score: Math.round(score * 1000) / 1000 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Típusonként csoportosítva (a „My Assets" fő nézethez). */
export function assetsByKind(lib: AssetLibrary): Partial<Record<AssetKind, LibraryAsset[]>> {
  const out: Partial<Record<AssetKind, LibraryAsset[]>> = {};
  for (const a of lib.assets) {
    (out[a.kind] ??= []).push(a);
  }
  return out;
}

// ── Duplikátum + hiányzó média ───────────────────────────────────────────────

/** Duplikátum-csoportok hash alapján (min. 2 tagú csoportok). */
export function findDuplicates(lib: AssetLibrary): LibraryAsset[][] {
  const byHash = new Map<string, LibraryAsset[]>();
  for (const a of lib.assets) {
    if (!a.hash) {
      continue;
    }
    const group = byHash.get(a.hash);
    if (group) {
      group.push(a);
    } else {
      byHash.set(a.hash, [a]);
    }
  }
  return [...byHash.values()].filter((g) => g.length > 1);
}

/** Hiányzó média: a megadott „létezik?" predikátum alapján. */
export function findMissing(lib: AssetLibrary, exists: (uri: string) => boolean): LibraryAsset[] {
  return lib.assets.filter((a) => !exists(a.uri));
}
