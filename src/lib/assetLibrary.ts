import { makeId } from '@/lib/id';
import { keywordScore, normalizeText } from '@/lib/visionIndex';
import type { Asset, Project } from '@/types/project';

/**
 * 🗂️ Universal Asset Library (PM2 — MASTER §14) — a MINDEN alkotó közös „My
 * Assets" rétege: típusonként (videó/fotó/zene/voice/SFX/grafika/font/3D/
 * dokumentum/kód/AI) egy asset, gazdag metaadattal (tags · collections ·
 * favorites · versions · source · license · creator · project-usage · embedding).
 *
 * A projekt-`Asset` (média-referencia — [types/project]) és ez a réteg
 * kiegészítik egymást: az `ingestProjectAssets` a projekt asseteit BEHÚZZA ide,
 * usage-gel. Innentől a keresés/usage/dedup a teljes könyvtár fölött megy.
 *
 * Az app DNS-e szerint eszközön futó, INGYENES infrastruktúra (nincs Pro-gate).
 * Tiszta, immutábilis reducer — expo-mentes, önmagában tesztelhető.
 */

/** A univerzális asset-típusok (a projekt `Asset.kind` finomítása több ágra). */
export type AssetKind =
  | 'video'
  | 'photo'
  | 'music'
  | 'voice'
  | 'sfx'
  | 'graphic'
  | 'font'
  | 'model3d'
  | 'document'
  | 'code'
  | 'ai';

export const ASSET_KINDS: AssetKind[] = [
  'video',
  'photo',
  'music',
  'voice',
  'sfx',
  'graphic',
  'font',
  'model3d',
  'document',
  'code',
  'ai',
];

/** ikon (Ionicons) az egyes típusokhoz — a UI-hoz. */
export const ASSET_KIND_ICON: Record<AssetKind, string> = {
  video: 'videocam',
  photo: 'image',
  music: 'musical-notes',
  voice: 'mic',
  sfx: 'volume-high',
  graphic: 'color-palette',
  font: 'text',
  model3d: 'cube',
  document: 'document-text',
  code: 'code-slash',
  ai: 'sparkles',
};

export interface AssetVersion {
  id: string;
  uri: string;
  label?: string;
  size?: number;
  hash?: string;
  createdAt: string;
}

export interface LibraryAsset {
  id: string;
  kind: AssetKind;
  name: string;
  /** az AKTUÁLIS verzió elérése (a legutóbb hozzáadott verzió URI-ja). */
  uri: string;
  /** honnan érhető el: `local` / `library` / `remote` / storage-provider id. */
  provider: string;
  thumbUri?: string;
  tags: string[];
  /** kollekció-id-k (a `collections` listából). */
  collections: string[];
  favorite: boolean;
  /** 0–5 csillag (0/hiányzó = nincs). */
  rating: number;
  license?: string;
  /** honnan származik (URL / „shot on iPhone" / import-forrás). */
  source?: string;
  creator?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  hash?: string;
  /** mely PROJEKTEK hivatkozzák (projectId-k) — a usage-lekérdezéshez. */
  usage: string[];
  versions: AssetVersion[];
  /** AI-embedding a szemantikus kereséshez (opcionális; a worker tölti fel). */
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface AssetLibrary {
  assets: LibraryAsset[];
  collections: Collection[];
  updatedAt: string;
}

export interface AssetInput {
  kind: AssetKind;
  name: string;
  uri: string;
  provider?: string;
  thumbUri?: string;
  tags?: string[];
  license?: string;
  source?: string;
  creator?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  hash?: string;
}

export function emptyLibrary(now = new Date().toISOString()): AssetLibrary {
  return { assets: [], collections: [], updatedAt: now };
}

const touch = (lib: AssetLibrary, assets: LibraryAsset[], now: string): AssetLibrary => ({
  ...lib,
  assets,
  updatedAt: now,
});

/** egy asset lecserélése id alapján (immutábilis map, csak ha tényleg változott). */
function patchAsset(
  lib: AssetLibrary,
  id: string,
  fn: (a: LibraryAsset) => LibraryAsset,
  now: string
): AssetLibrary {
  let changed = false;
  const assets = lib.assets.map((a) => {
    if (a.id !== id) {
      return a;
    }
    changed = true;
    return { ...fn(a), updatedAt: now };
  });
  return changed ? touch(lib, assets, now) : lib;
}

/** Új asset felvétele (első verzióval). A `hash` egyezés esetén NEM duplikál — a
 *  meglévőt adja vissza változatlanul (a hívó a `findByHash`-sel is ellenőrizhet). */
export function addAsset(lib: AssetLibrary, input: AssetInput, now = new Date().toISOString()): AssetLibrary {
  if (input.hash) {
    const dup = lib.assets.find((a) => a.hash === input.hash);
    if (dup) {
      return lib;
    }
  }
  const asset: LibraryAsset = {
    id: makeId('lib'),
    kind: input.kind,
    name: input.name.trim() || 'asset',
    uri: input.uri,
    provider: input.provider ?? 'local',
    ...(input.thumbUri ? { thumbUri: input.thumbUri } : {}),
    tags: input.tags ?? [],
    collections: [],
    favorite: false,
    rating: 0,
    ...(input.license ? { license: input.license } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.creator ? { creator: input.creator } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
    ...(input.hash ? { hash: input.hash } : {}),
    usage: [],
    versions: [
      {
        id: makeId('ver'),
        uri: input.uri,
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.hash ? { hash: input.hash } : {}),
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  return touch(lib, [...lib.assets, asset], now);
}

export function removeAsset(lib: AssetLibrary, id: string, now = new Date().toISOString()): AssetLibrary {
  const assets = lib.assets.filter((a) => a.id !== id);
  return assets.length === lib.assets.length ? lib : touch(lib, assets, now);
}

export function renameAsset(lib: AssetLibrary, id: string, name: string, now = new Date().toISOString()): AssetLibrary {
  return patchAsset(lib, id, (a) => ({ ...a, name: name.trim() || a.name }), now);
}

export function toggleFavorite(lib: AssetLibrary, id: string, now = new Date().toISOString()): AssetLibrary {
  return patchAsset(lib, id, (a) => ({ ...a, favorite: !a.favorite }), now);
}

export function rateAsset(lib: AssetLibrary, id: string, rating: number, now = new Date().toISOString()): AssetLibrary {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return patchAsset(lib, id, (a) => ({ ...a, rating: r }), now);
}

export function addTag(lib: AssetLibrary, id: string, tag: string, now = new Date().toISOString()): AssetLibrary {
  const clean = tag.trim();
  if (!clean) {
    return lib;
  }
  return patchAsset(lib, id, (a) => (a.tags.includes(clean) ? a : { ...a, tags: [...a.tags, clean] }), now);
}

export function removeTag(lib: AssetLibrary, id: string, tag: string, now = new Date().toISOString()): AssetLibrary {
  return patchAsset(lib, id, (a) => ({ ...a, tags: a.tags.filter((t) => t !== tag) }), now);
}

// ── Kollekciók ────────────────────────────────────────────────────────────

export function createCollection(
  lib: AssetLibrary,
  name: string,
  now = new Date().toISOString()
): { library: AssetLibrary; id: string } {
  const id = makeId('col');
  const col: Collection = { id, name: name.trim() || 'collection', createdAt: now };
  return { library: { ...lib, collections: [...lib.collections, col], updatedAt: now }, id };
}

export function deleteCollection(lib: AssetLibrary, colId: string, now = new Date().toISOString()): AssetLibrary {
  const collections = lib.collections.filter((c) => c.id !== colId);
  if (collections.length === lib.collections.length) {
    return lib;
  }
  const assets = lib.assets.map((a) =>
    a.collections.includes(colId) ? { ...a, collections: a.collections.filter((c) => c !== colId), updatedAt: now } : a
  );
  return { ...lib, collections, assets, updatedAt: now };
}

export function addToCollection(
  lib: AssetLibrary,
  id: string,
  colId: string,
  now = new Date().toISOString()
): AssetLibrary {
  if (!lib.collections.some((c) => c.id === colId)) {
    return lib;
  }
  return patchAsset(
    lib,
    id,
    (a) => (a.collections.includes(colId) ? a : { ...a, collections: [...a.collections, colId] }),
    now
  );
}

export function removeFromCollection(
  lib: AssetLibrary,
  id: string,
  colId: string,
  now = new Date().toISOString()
): AssetLibrary {
  return patchAsset(lib, id, (a) => ({ ...a, collections: a.collections.filter((c) => c !== colId) }), now);
}

// ── Verziók ────────────────────────────────────────────────────────────────

/** Új verzió az assethez — az AKTUÁLIS uri/size/hash erre frissül. */
export function addVersion(
  lib: AssetLibrary,
  id: string,
  version: { uri: string; label?: string; size?: number; hash?: string },
  now = new Date().toISOString()
): AssetLibrary {
  return patchAsset(
    lib,
    id,
    (a) => ({
      ...a,
      uri: version.uri,
      ...(version.size !== undefined ? { size: version.size } : {}),
      ...(version.hash !== undefined ? { hash: version.hash } : {}),
      versions: [
        ...a.versions,
        {
          id: makeId('ver'),
          uri: version.uri,
          ...(version.label ? { label: version.label } : {}),
          ...(version.size !== undefined ? { size: version.size } : {}),
          ...(version.hash ? { hash: version.hash } : {}),
          createdAt: now,
        },
      ],
    }),
    now
  );
}

// ── Usage (project-usage gráf lapos nézete) ──────────────────────────────────

export function recordUsage(
  lib: AssetLibrary,
  id: string,
  projectId: string,
  now = new Date().toISOString()
): AssetLibrary {
  return patchAsset(lib, id, (a) => (a.usage.includes(projectId) ? a : { ...a, usage: [...a.usage, projectId] }), now);
}

export function clearUsage(
  lib: AssetLibrary,
  projectId: string,
  now = new Date().toISOString()
): AssetLibrary {
  let changed = false;
  const assets = lib.assets.map((a) => {
    if (!a.usage.includes(projectId)) {
      return a;
    }
    changed = true;
    return { ...a, usage: a.usage.filter((p) => p !== projectId), updatedAt: now };
  });
  return changed ? touch(lib, assets, now) : lib;
}

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

// ── Bridge: projekt-Asset → könyvtár ─────────────────────────────────────────

/** projekt `Asset.kind` → univerzális `AssetKind` (a média-forrás finomítása). */
export function assetKindFromProject(a: Pick<Asset, 'kind'>): AssetKind {
  if (a.kind === 'video') {
    return 'video';
  }
  if (a.kind === 'audio') {
    return 'music';
  }
  return 'photo';
}

/**
 * Egy projekt asseteinek behúzása a könyvtárba, usage-rögzítéssel. Hash-egyezés
 * esetén nem duplikál, de a usage-t akkor is felveszi a MEGLÉVŐ assetre.
 */
export function ingestProjectAssets(
  lib: AssetLibrary,
  project: Project,
  now = new Date().toISOString()
): AssetLibrary {
  let next = lib;
  for (const a of project.assets) {
    const kind = assetKindFromProject(a);
    const existing = a.hash ? next.assets.find((x) => x.hash === a.hash) : undefined;
    if (existing) {
      next = recordUsage(next, existing.id, project.id, now);
      continue;
    }
    const before = next.assets.length;
    next = addAsset(
      next,
      {
        kind,
        name: a.name ?? kind,
        uri: a.uri,
        provider: a.provider,
        ...(a.duration !== undefined ? { duration: a.duration } : {}),
        ...(a.width !== undefined ? { width: a.width } : {}),
        ...(a.height !== undefined ? { height: a.height } : {}),
        ...(a.size !== undefined ? { size: a.size } : {}),
        ...(a.hash ? { hash: a.hash } : {}),
      },
      now
    );
    if (next.assets.length > before) {
      const added = next.assets[next.assets.length - 1];
      next = recordUsage(next, added.id, project.id, now);
      // a projekt-Asset kedvenc/rating/tag metaadatának átemelése
      if (a.favorite) {
        next = toggleFavorite(next, added.id, now);
      }
      if (a.rating) {
        next = rateAsset(next, added.id, a.rating, now);
      }
      for (const tag of a.tags ?? []) {
        next = addTag(next, added.id, tag, now);
      }
    }
  }
  return next;
}
