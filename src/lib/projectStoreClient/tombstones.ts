import AsyncStorage from '@react-native-async-storage/async-storage';

import { addTombstones, removeTombstones } from '@/lib/projectTombstones';
import { TOMBSTONE_KEY } from '@/lib/projectStoreCore/keys';
import { logCaught } from '@/lib/logCaught';

// ── 🪦 Sírkövek: a törölt projekt NEM jöhet vissza a felhőből ──────────────────
// Memória-cache: a mentés-útvonal (autosave) is olvassa, ne legyen minden mentés I/O.
let tombstoneCache: string[] | null = null;

async function readTombstones(): Promise<string[]> {
  if (tombstoneCache) {
    return tombstoneCache;
  }
  try {
    const raw = await AsyncStorage.getItem(TOMBSTONE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    tombstoneCache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch (caught) {
    logCaught('lib/storage.ts:readTombstones', caught);
    tombstoneCache = [];
  }
  return tombstoneCache;
}

/** A törölt (sírköves) projekt-id-k. */
export async function deletedProjectIds(): Promise<Set<string>> {
  return new Set(await readTombstones());
}

/** Projekt(ek) töröltként jelölése — a felhő-visszatöltés és a háttér-mentés kihagyja. */
export async function markProjectsDeleted(ids: string[]): Promise<void> {
  tombstoneCache = addTombstones(await readTombstones(), ids);
  await AsyncStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstoneCache)).catch((caught) => { logCaught('lib/storage.ts:markProjectsDeleted', caught); });
}

/** Ugyanazzal az id-vel KIFEJEZETTEN újra elmentett projekt (pl. .rp-import) ismét él. */
export async function clearTombstone(id: string): Promise<void> {
  const cur = await readTombstones();
  if (!cur.includes(id)) {
    return;
  }
  tombstoneCache = removeTombstones(cur, [id]);
  await AsyncStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstoneCache)).catch((caught) => { logCaught('lib/storage.ts:clearTombstone', caught); });
}
