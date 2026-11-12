
import { mediaFormData, uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';
import { ANALYSIS_CACHE_LIMIT, LruCache } from '@/lib/lruCache';
import { logCaught } from '@/lib/logCaught';

/**
 * Beat-engine kliens (P0‑2): BPM, beat/downbeat-rács és energia-görbe a hangfájlra (forrás-időben).
 * 📱 Offline-first (AP3): előbb a telefonon számol (`beatDetect.ts`), a worker `/beats` csak tartalék.
 * Fájlonként memóriában cache-elve. A pure vágásterv a cutplan.ts-ben van.
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

const memory = new LruCache<BeatGrid>(ANALYSIS_CACHE_LIMIT);

/** 🧹 a beat-rács cache ürítése (a `cacheManager.clearCaches()` hívja) */
export function clearBeatMemory(): void {
  memory.clear();
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

/** a telefonon elemzett forrás felső határa (11 025 Hz mono: 10 perc ≈ 26 MB) */
const ON_DEVICE_MAX_SEC = 10 * 60;
/** ennél nagyobb fájlnál a dekódolás előtt a hosszt is megnézzük */
const PROBE_BYTES = 8 * 1024 * 1024;

/**
 * 📱 a beat-rács a telefonon (AP3, offline): a hang 11 025 Hz-es monóra dekódolva, a szerverrel
 * azonos algoritmussal (`beatDetect.ts`). Hosszú (> 10 perc) vagy nem dekódolható forrásnál null.
 */
export async function detectBeatsOnDevice(uri: string): Promise<BeatGrid | null> {
  try {
    const { loadAudioApi } = await import('@/lib/audioApiGuard');
    const api = await loadAudioApi();
    if (!api) return null;
    // távoli forrás: a már letöltött helyi másolat (R1 cache), különben a worker
    if (!uri.startsWith('file:')) {
      const { previewLocalUri } = await import('@/lib/previewRemoteCache');
      const local = previewLocalUri(uri);
      return local ? detectBeatsOnDevice(local) : null;
    }
    // a teljes dekódolás ELŐTT: a nagy fájl hosszát megnézzük (egy 1 órás sztereó fájl 11 kHz-en is ~300 MB lenne)
    const { File } = await import('expo-file-system');
    const f = new File(uri);
    if (!f.exists) return null;
    if (f.size > PROBE_BYTES) {
      const { probeAudioDuration } = await import('@/lib/media');
      const d = await probeAudioDuration(uri);
      if (!(d > 0) || d > ON_DEVICE_MAX_SEC) return null;
    }
    const { BEAT_SR, analyzeBeatsFromPcm } = await import('@/lib/beatDetect');
    const buf = await api.decodeAudioData(uri, BEAT_SR);
    if (buf.duration > ON_DEVICE_MAX_SEC) return null;
    const ch = buf.numberOfChannels;
    const mono = buf.getChannelData(0).slice();
    for (let c = 1; c < ch; c++) {
      const x = buf.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += x[i];
    }
    if (ch > 1) for (let i = 0; i < mono.length; i++) mono[i] /= ch;
    return analyzeBeatsFromPcm(mono, BEAT_SR);
  } catch (caught) {
    logCaught('lib/beats.ts:detectBeatsOnDevice', caught);
    return null;
  }
}

/** 🧪 mérés: az utolsó felismerés útja */
let lastPath: 'device' | 'worker' | null = null;
export const lastBeatPath = (): 'device' | 'worker' | null => lastPath;

/** Beat-rács: előbb a telefonon (offline), tartalékként a workertől; fájlonként cache-elve. */
export async function detectBeats(uri: string): Promise<BeatGrid | null> {
  const cached = memory.get(uri);
  if (cached) {
    return cached;
  }
  const local = await detectBeatsOnDevice(uri);
  if (local) {
    lastPath = 'device';
    memory.set(uri, local);
    return local;
  }
  const base = renderServerUrl();
  try {
    await fetchWithTimeout(`${base}/health`, 4000);
  } catch (caught) {
    logCaught('lib/beats.ts:detectBeats', caught);
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
    lastPath = 'worker';
    memory.set(uri, body);
    return body;
  } catch (caught) {
    logCaught('lib/beats.ts:detectBeats', caught);
    return null;
  }
}
