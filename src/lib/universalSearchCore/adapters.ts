import type { Project } from '@/types/project';
import type { AssetKind, LibraryAsset } from '@/lib/assetLibrary';
import type { SearchDoc, SearchScope } from '@/lib/universalSearchCore/docs';

// ── Adapterek: domain → SearchDoc ────────────────────────────────────────────

/** Projekt → kereshető dokumentum (a `rendered` = publikált heurisztika). */
export function projectToDoc(project: Project): SearchDoc {
  const kind = project.kind ?? 'video';
  return {
    id: project.id,
    scope: 'project',
    title: project.name,
    subtitle: kind,
    keywords: [kind, project.aspectRatio],
    ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
    ...(project.createdAt ? { createdAt: project.createdAt } : {}),
    meta: { kind, published: !!project.rendered },
  };
}

const ASSET_SCOPE: Partial<Record<AssetKind, SearchScope>> = {
  music: 'music',
  photo: 'photo',
  video: 'video',
};

/** Könyvtár-asset → kereshető dokumentum (a zene/fotó/videó saját scope-ot kap). */
export function assetToDoc(asset: LibraryAsset): SearchDoc {
  return {
    id: asset.id,
    scope: ASSET_SCOPE[asset.kind] ?? 'asset',
    title: asset.name,
    subtitle: asset.kind,
    keywords: [...asset.tags, ...(asset.source ? [asset.source] : [])],
    ...(asset.thumbUri ? { thumbUri: asset.thumbUri } : {}),
    updatedAt: asset.updatedAt,
    createdAt: asset.createdAt,
    meta: { kind: asset.kind, favorite: asset.favorite, published: true },
  };
}
