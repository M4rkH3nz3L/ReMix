import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';

/**
 * Hang-hullámforma az idővonalhoz (full-plan F2 waveform-szelet). A csúcsokat
 * a worker /waveform végpontja számolja FFmpeg-gel; az eredmény lemezre
 * cache-elődik (fájlnév+méret kulccsal), így egy hangfájl csak egyszer megy
 * fel. Ha a worker nem fut, csendben null jön vissza — az idővonal címkével
 * működik tovább.
 */

export interface WaveformData {
  /** mp */
  duration: number;
  peaksPerSecond: number;
  /** 0–1 normalizált csúcsok */
  peaks: number[];
}

const memory = new Map<string, Promise<WaveformData | null>>();

function hashKey(input: string): string {
  // djb2 — csak cache-fájlnévhez kell
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

async function fetchFromWorker(uri: string): Promise<WaveformData | null> {
  const base = renderServerUrl();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    await fetch(`${base}/health`, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    return null; // worker nem fut — nincs hullámforma, nincs hiba
  }
  const name = uri.split('/').pop() ?? 'audio';
  const form = new FormData();
  form.append('media', new File(uri) as unknown as Blob, name);
  const res = await uploadFetch(`${base}/waveform`, { method: 'POST', body: form });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as WaveformData;
  if (!Array.isArray(body.peaks) || body.peaks.length === 0) {
    return null;
  }
  return body;
}

/** weben a csúcsokat a WebAudio számolja — a worker/feltöltés kihagyható */
async function computeWebWaveform(uri: string): Promise<WaveformData | null> {
  try {
    const res = await fetch(uri);
    const buf = await res.arrayBuffer();
    const Ctx =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      return null;
    }
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf);
    const channel = audio.getChannelData(0);
    const pps = 20;
    const samplesPerPeak = Math.floor(audio.sampleRate / pps);
    const peaks: number[] = [];
    for (let i = 0; i + samplesPerPeak <= channel.length; i += samplesPerPeak) {
      let max = 0;
      for (let j = i; j < i + samplesPerPeak; j += 8) {
        const v = Math.abs(channel[j]);
        if (v > max) {
          max = v;
        }
      }
      peaks.push(Math.round(max * 100) / 100);
    }
    void ctx.close?.();
    return peaks.length > 0
      ? { duration: audio.duration, peaksPerSecond: pps, peaks }
      : null;
  } catch {
    return null;
  }
}

export function getWaveform(uri: string): Promise<WaveformData | null> {
  let pending = memory.get(uri);
  if (pending) {
    return pending;
  }
  if (Platform.OS === 'web') {
    pending = computeWebWaveform(uri);
    memory.set(uri, pending);
    pending.then((data) => {
      if (data === null) {
        memory.delete(uri);
      }
    });
    return pending;
  }
  pending = (async () => {
    let cacheFile: File | null = null;
    try {
      const source = new File(uri);
      cacheFile = new File(
        Paths.cache,
        `wf_${hashKey(`${source.name}_${source.size ?? 0}`)}.json`
      );
      if (cacheFile.exists) {
        return JSON.parse(await cacheFile.text()) as WaveformData;
      }
    } catch {
      cacheFile = null;
    }
    try {
      const data = await fetchFromWorker(uri);
      if (data && cacheFile) {
        try {
          cacheFile.write(JSON.stringify(data));
        } catch {
          // a lemez-cache opcionális
        }
      }
      return data;
    } catch {
      return null;
    }
  })();
  memory.set(uri, pending);
  // sikertelen próbálkozás ne ragadjon be a session-cache-be
  pending.then((data) => {
    if (data === null) {
      memory.delete(uri);
    }
  });
  return pending;
}

/** csúcslista újramintázása adott oszlopszámra (max az oszlopon belül) */
export function resamplePeaks(peaks: number[], columns: number): number[] {
  if (peaks.length === 0 || columns <= 0) {
    return [];
  }
  const out: number[] = [];
  for (let i = 0; i < columns; i++) {
    const from = Math.floor((i / columns) * peaks.length);
    const to = Math.max(from + 1, Math.floor(((i + 1) / columns) * peaks.length));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j++) {
      if (peaks[j] > max) {
        max = peaks[j];
      }
    }
    out.push(max);
  }
  return out;
}
