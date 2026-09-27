import {
  MEMORY_CATEGORIES,
  emptyMemory,
  type CreatorMemory,
  type MemoryCategory,
  type MemoryFact,
} from '@/lib/creatorMemory';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🧠 Creator Memory felhő-kliens — a `creator_memory` (per-user, JSONB) tábla
 * load/save-je. A magok expo-mentesek maradnak; a hálózat itt van (AGENTS.md).
 *
 * A `parseMemoryDoc` TISZTA és VÉDETT: a hibás/hiányzó JSONB-t üres memóriává
 * degradálja, a rossz tényeket kihagyja — sosem dob a betöltés. Ez van tesztelve
 * (round-trip + fallback); a thin CRUD a `creatorProfile`/`storageQuota` mintát
 * követi.
 */

const isCategory = (v: unknown): v is MemoryCategory =>
  typeof v === 'string' && (MEMORY_CATEGORIES as string[]).includes(v);

/** Egy nyers JSONB-bejegyzés → `MemoryFact`, vagy null (ha nem menthető). */
function coerceFact(raw: unknown): MemoryFact | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.text !== 'string' || !isCategory(o.category)) {
    return null;
  }
  const scopes = Array.isArray(o.scopes)
    ? (o.scopes.filter((s) => typeof s === 'string') as NonNullable<MemoryFact['scopes']>)
    : undefined;
  return {
    id: o.id,
    category: o.category,
    text: o.text,
    ...(typeof o.key === 'string' ? { key: o.key } : {}),
    ...(scopes && scopes.length > 0 ? { scopes } : {}),
    weight: typeof o.weight === 'number' ? o.weight : 0.5,
    hits: typeof o.hits === 'number' ? o.hits : 1,
    pinned: o.pinned === true,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  };
}

/** JSONB-dokumentum → `CreatorMemory` (védett; hibás bemenetre üres memória). */
export function parseMemoryDoc(doc: unknown): CreatorMemory {
  const o = (doc ?? {}) as Record<string, unknown>;
  const rawFacts = Array.isArray(o.facts) ? o.facts : [];
  const facts: MemoryFact[] = [];
  for (const r of rawFacts) {
    const f = coerceFact(r);
    if (f) {
      facts.push(f);
    }
  }
  return { facts, updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '' };
}

function currentUid(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** A saját Creator Memory betöltése (nincs backend/bejelentkezés → üres memória). */
export async function loadCreatorMemory(): Promise<CreatorMemory> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return emptyMemory();
  }
  const { data, error } = await supabase.from('creator_memory').select('doc').eq('user_id', uid).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? parseMemoryDoc(data.doc) : emptyMemory();
}

/** A saját Creator Memory mentése (teljes upsert). No-op backend/bejelentkezés nélkül. */
export async function saveCreatorMemory(memory: CreatorMemory): Promise<void> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return;
  }
  const sb = requireSupabase();
  const { error } = await sb
    .from('creator_memory')
    .upsert({ user_id: uid, doc: memory }, { onConflict: 'user_id' });
  if (error) {
    throw new Error(error.message);
  }
}
