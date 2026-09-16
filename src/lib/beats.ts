
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * Beat-engine kliens (P0‑2): a worker /beats végpontja BPM-et, beat/downbeat-
 * rácsot és energia-görbét ad a hangfájlra (forrás-időben). Fájlonként
 * memóriában cache-elve. A pure vágásterv a cutplan.ts-ben van.
 */

export { buildBeatSplitPlan, timelineBeats } from '@/lib/cutplan';
export type { BeatSplitPlan } from '@/lib/cutplan';

export interface BeatGrid {
  /** 0, ha nem sikerült tempót találni */
  bpm: number;
  /** beat-időpontok a fájl elejétől (mp) */
  beats: number[];
  /** minden 4. beat — a detektált ütem-egy */
  downbeats: number[];
  /** 0,5 mp-es normalizált (0–1) energia-blokkok */
  energy: number[];
  duration: number;
}

const memory = new Map<string, BeatGrid>();

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Beat-rács a workertől (fájlonként egyszer, memóriában cache-elve). */
export async function detectBeats(uri: string): Promise<BeatGrid | null> {
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
    const form = await mediaFormData(uri);
    const res = await uploadFetch(`${base}/beats`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as BeatGrid;
    if (!Array.isArray(body.beats)) {
      return null;
    }
    memory.set(uri, body);
    return body;
  } catch {
    return null;
  }
}
