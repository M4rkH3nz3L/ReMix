import { makeId } from '@/lib/id';
import type { AssetInput, AssetLibrary, Collection, LibraryAsset } from '@/lib/assetLibraryCore/model';

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
