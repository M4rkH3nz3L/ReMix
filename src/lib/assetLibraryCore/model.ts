// A könyvtár adatmodellje: asset-típusok, ikonok, asset / verzió / kollekció alakja

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
