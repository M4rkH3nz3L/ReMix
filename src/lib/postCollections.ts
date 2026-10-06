import { currentUserId } from '@/lib/chat';
import { asRecord, finiteNum, mapValid, str } from '@/lib/parseGuards';
import { requireSupabase, supabase } from '@/lib/supabase';

/**
 * 📁 Social collections (audit §4.4) — a mentett posztok felhasználói mappái/
 * playlistjei. A kollekció a tulajdonosé (RLS); ez a kliens-réteg a CRUD-ot + a
 * tiszta validálást/parse-olást adja. A szerver-enforcement az RLS (owner-only);
 * a worker-válaszokat a [parseGuards](./parseGuards.ts)-szal tipizáljuk.
 */

export interface PostCollection {
  id: string;
  name: string;
  createdAt: string;
  /** elemszám (ha a lekérés kérte) */
  itemCount?: number;
}

const MAX_NAME = 80;

/** A kollekció-név normalizálása: trim + egyszeres szóköz + max hossz; üres → alap. */
export function normalizeCollectionName(raw: string): string {
  const n = (raw ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  return n || 'Gyűjtemény';
}

/**
 * A `post_collections` válasz → `PostCollection[]` (hibás elem kiesik). Elfogadja a
 * beágyazott count-ot (`post_collection_items: [{ count }]`) és a lapos `item_count`-ot is.
 */
export function parseCollections(raw: unknown): PostCollection[] {
  return mapValid(raw, (o) => {
    const id = str(o.id);
    const name = str(o.name);
    if (!id || !name) {
      return null;
    }
    const createdAt = str(o.created_at) ?? str(o.createdAt) ?? '';
    let itemCount = finiteNum(o.item_count ?? o.itemCount);
    if (itemCount === null && Array.isArray(o.post_collection_items)) {
      itemCount = finiteNum(asRecord(o.post_collection_items[0])?.count);
    }
    return { id, name, createdAt, ...(itemCount !== null ? { itemCount } : {}) };
  });
}

// ── DB CRUD ──────────────────────────────────────────────────────────────────

export async function createCollection(name: string): Promise<string> {
  const sb = requireSupabase();
  const me = currentUserId();
  if (!me) {
    throw new Error('Nincs bejelentkezve.');
  }
  const { data, error } = await sb
    .from('post_collections')
    .insert({ user_id: me, name: normalizeCollectionName(name) })
    .select('id')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return str(asRecord(data)?.id) ?? '';
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('post_collections')
    .update({ name: normalizeCollectionName(name), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteCollection(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('post_collections').delete().eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}

/** A saját kollekcióim (elemszámmal), legújabb elöl. */
export async function listCollections(): Promise<PostCollection[]> {
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('post_collections')
    .select('id, name, created_at, post_collection_items(count)')
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return parseCollections(data);
}

export async function addToCollection(collectionId: string, postId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('post_collection_items')
    .insert({ collection_id: collectionId, post_id: postId });
  // a duplikált (már benne van) nem hiba
  if (error && !/duplicate|unique|conflict/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function removeFromCollection(collectionId: string, postId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('post_collection_items')
    .delete()
    .eq('collection_id', collectionId)
    .eq('post_id', postId);
  if (error) {
    throw new Error(error.message);
  }
}

/** Mely (saját) kollekciók tartalmazzák ezt a posztot — a kollekció-választó pipáihoz. */
export async function collectionIdsWithPost(postId: string): Promise<string[]> {
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('post_collection_items')
    .select('collection_id')
    .eq('post_id', postId);
  if (error) {
    return [];
  }
  return mapValid(data, (o) => str(o.collection_id));
}

/** Egy kollekció poszt-id-jai (a hashtag-/mappa-oldalhoz). */
export async function listCollectionPostIds(collectionId: string): Promise<string[]> {
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('post_collection_items')
    .select('post_id')
    .eq('collection_id', collectionId)
    .order('added_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return mapValid(data, (o) => str(o.post_id));
}
