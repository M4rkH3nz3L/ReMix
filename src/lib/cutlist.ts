import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';
import { rangeList, timeList } from '@/lib/parseGuards';
import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

import type { SilenceRange } from '@/lib/cutplan';

/**
 * Editor AI cut-lista (full-plan F3): a worker FFmpeg-alapú csend-detektálása
 * (forrás-időben) → determinisztikus vágásterv a videósávra. A terv a
 * trim/sebesség-helyes forrás-ablakokkal számol, a vágás után a sáv hézag
 * nélkül épül újra (ripple), és egyetlen REPLACE_TRACK_CLIPS commandként —
 * tehát egy undo-lépésként — alkalmazható.
 */

export { buildCutPlan, buildSceneSplitPlan } from '@/lib/cutplan';
export type { CutPlan, SceneSplitPlan, SilenceRange } from '@/lib/cutplan';

const memory = new LruCache<SilenceRange[]>(ANALYSIS_CACHE_LIMIT);
const sceneMemory = new LruCache<number[]>(ANALYSIS_CACHE_LIMIT);

/** 🧹 a csend/jelenet-elemzés ürítése (a `cacheManager.clearCaches()` hívja) */
export function clearCutlistMemory(): void {
  memory.clear();
  sceneMemory.clear();
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Csend-intervallumok a workertől (fájlonként egyszer, memóriában cache-elve). */
export async function detectSilence(uri: string): Promise<SilenceRange[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const cached = memory.get(uri);
  if (cached) {
    return cached;
  }
  const base = renderServerUrl();
  try {
    await fetchWithTimeout(`${base}/health`, 4000);
  } catch {
    return null; // worker nem fut
  }
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    const res = await uploadFetch(`${base}/silence`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const raw = (await res.json())?.silences;
    if (!Array.isArray(raw)) {
      return null; // `null` = nem sikerült elemezni; `[]` = elemeztem, nincs csend
    }
    // 🛡️ a tartományok forrás-időként klip-hosszá válnak: a fordított vagy nem
    // véges pár negatív hosszú klipet szülne, ezért itt esik ki, nem a vágásban
    const silences = rangeList(raw);
    memory.set(uri, silences);
    return silences;
  } catch (err) {
    // a leggyakoribb ok: a mentett file:// út elszakadt (konténer-költözés)
    console.warn('detectSilence hiba:', (err as Error).message, '| uri:', uri);
    return null;
  }
}

/** Jelenetváltás-időpontok a workertől (forrás-időben; fájlonként cache-elve). */
export async function detectScenes(uri: string): Promise<number[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const cached = sceneMemory.get(uri);
  if (cached) {
    return cached;
  }
  const base = renderServerUrl();
  try {
    await fetchWithTimeout(`${base}/health`, 4000);
  } catch {
    return null; // worker nem fut
  }
  try {
    const form = new FormData();
    form.append('media', new File(uri) as unknown as Blob, uri.split('/').pop() ?? 'media');
    const res = await uploadFetch(`${base}/scenes`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const raw = (await res.json())?.scenes;
    if (!Array.isArray(raw)) {
      return null; // a hiányzó elemzés MÁS, mint a „nincs jelenetváltás"
    }
    // 🛡️ ezek vágáspontok lesznek — növekvő, duplikátum-mentes, véges lista kell
    const scenes = timeList(raw);
    sceneMemory.set(uri, scenes);
    return scenes;
  } catch {
    return null;
  }
}

