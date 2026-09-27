import {
  ASSET_KINDS,
  emptyLibrary,
  type AssetKind,
  type AssetLibrary,
  type AssetVersion,
  type Collection,
  type LibraryAsset,
} from '@/lib/assetLibrary';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🗂️ Universal Asset Library felhő-kliens — a `asset_library` (per-user, JSONB)
 * tábla load/save-je. A `parseLibraryDoc` TISZTA és VÉDETT (hibás sorok kihagyva,
 * hibás doc → üres könyvtár) — ez van tesztelve; a CRUD thin.
 */

const isKind = (v: unknown): v is AssetKind => typeof v === 'string' && (ASSET_KINDS as string[]).includes(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const numArr = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

function coerceVersion(raw: unknown): AssetVersion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.uri !== 'string') {
    return null;
  }
  return {
    id: o.id,
    uri: o.uri,
    ...(typeof o.label === 'string' ? { label: o.label } : {}),
    ...(typeof o.size === 'number' ? { size: o.size } : {}),
    ...(typeof o.hash === 'string' ? { hash: o.hash } : {}),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
  };
}

function coerceAsset(raw: unknown): LibraryAsset | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.uri !== 'string' || typeof o.name !== 'string' || !isKind(o.kind)) {
    return null;
  }
  const versions = Array.isArray(o.versions)
    ? o.versions.map(coerceVersion).filter((v): v is AssetVersion => v !== null)
    : [];
  const embedding = numArr(o.embedding);
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    uri: o.uri,
    provider: typeof o.provider === 'string' ? o.provider : 'local',
    ...(typeof o.thumbUri === 'string' ? { thumbUri: o.thumbUri } : {}),
    tags: strArr(o.tags),
    collections: strArr(o.collections),
    favorite: o.favorite === true,
    rating: typeof o.rating === 'number' ? o.rating : 0,
    ...(typeof o.license === 'string' ? { license: o.license } : {}),
    ...(typeof o.source === 'string' ? { source: o.source } : {}),
    ...(typeof o.creator === 'string' ? { creator: o.creator } : {}),
    ...(typeof o.width === 'number' ? { width: o.width } : {}),
    ...(typeof o.height === 'number' ? { height: o.height } : {}),
    ...(typeof o.duration === 'number' ? { duration: o.duration } : {}),
    ...(typeof o.size === 'number' ? { size: o.size } : {}),
    ...(typeof o.hash === 'string' ? { hash: o.hash } : {}),
    usage: strArr(o.usage),
    versions,
    ...(embedding.length > 0 ? { embedding } : {}),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  };
}

function coerceCollection(raw: unknown): Collection | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') {
    return null;
  }
  return { id: o.id, name: o.name, createdAt: typeof o.createdAt === 'string' ? o.createdAt : '' };
}

/** JSONB-dokumentum → `AssetLibrary` (védett; hibás bemenetre üres könyvtár). */
export function parseLibraryDoc(doc: unknown): AssetLibrary {
  const o = (doc ?? {}) as Record<string, unknown>;
  const assets = Array.isArray(o.assets)
    ? o.assets.map(coerceAsset).filter((a): a is LibraryAsset => a !== null)
    : [];
  const collections = Array.isArray(o.collections)
    ? o.collections.map(coerceCollection).filter((c): c is Collection => c !== null)
    : [];
  return { assets, collections, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '' };
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** A saját Asset Library betöltése (nincs backend/bejelentkezés → üres könyvtár). */
export async function loadAssetLibrary(): Promise<AssetLibrary> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return emptyLibrary();
  }
  const { data, error } = await supabase.from('asset_library').select('doc').eq('user_id', uid).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? parseLibraryDoc(data.doc) : emptyLibrary();
}

/** A saját Asset Library mentése (teljes upsert). No-op backend/bejelentkezés nélkül. */
export async function saveAssetLibrary(library: AssetLibrary): Promise<void> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return;
  }
  const sb = requireSupabase();
  const { error } = await sb.from('asset_library').upsert({ user_id: uid, doc: library }, { onConflict: 'user_id' });
  if (error) {
    throw new Error(error.message);
  }
}
