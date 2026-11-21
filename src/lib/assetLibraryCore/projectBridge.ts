import type { Asset, Project } from '@/types/project';
import type { AssetKind, AssetLibrary } from '@/lib/assetLibraryCore/model';
import { addAsset, addTag, rateAsset, recordUsage, toggleFavorite } from '@/lib/assetLibraryCore/reducer';

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
