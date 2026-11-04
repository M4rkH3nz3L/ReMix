import { loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { logCaught } from '@/lib/logCaught';

/**
 * Hang-hullámforma az idővonalhoz ÉS a Hang Stúdióhoz. A csúcsokat AZ ESZKÖZÖN
 * számoljuk (worker nélkül): a `react-native-audio-api` natívan dekódolja a
 * hangot (8 kHz-en, ennyi bőven elég a görbéhez), weben a WebAudio. Az eredmény
 * lemezre cache-elődik (fájlnév+méret kulccsal), így egy fájlt csak egyszer
 * dekódolunk. Hiba esetén csendben null — a UI címkével/sávval működik tovább.
 */

export interface WaveformData {
  /** mp */
  duration: number;
  peaksPerSecond: number;
  /** 0–1 normalizált csúcsok */
  peaks: number[];
}

/**
 * A24: csúcs / másodperc — a Hang Stúdió legnagyobb nagyításán (220 px/mp, 3,5 px-es
 * oszlopok ≈ 63 oszlop/mp) is jusson csúcs minden oszlopra; kisebb zoomnál a
 * `resamplePeaks` maximummal ritkít. (Régen 20 volt: nagy zoomnál háromszoros kockák.)
 */
export const WAVEFORM_PPS = 64;

// A24: a session-cache korlátos (a legrégebben kért esik ki), nem nő a munkamenet végéig
const MEMORY_LIMIT = 64;
const memory = new Map<string, Promise<WaveformData | null>>();

function remember(uri: string, pending: Promise<WaveformData | null>): void {
  memory.set(uri, pending);
  while (memory.size > MEMORY_LIMIT) {
    memory.delete(memory.keys().next().value as string);
  }
}

/** A hullámforma session-cache (memória) ürítése — cache-kezeléshez. */
export function clearWaveformMemory(): void {
  memory.clear();
}

function hashKey(input: string): string {
  // djb2 — csak cache-fájlnévhez kell
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Csúcsok a dekódolt csatornákból (közös a natív + web úthoz). A24: minden csatorna és
 * minden minta számít — a ritkítás a rövid csúcsokat (dob, clipping) elhagyta. A 8 kHz-es
 * dekódolásnál ez percenként ~480 ezer minta csatornánként, gyors.
 */
export function peaksFromChannels(
  channels: Float32Array[],
  sampleRate: number,
  duration: number,
  pps: number
): WaveformData | null {
  const length = Math.min(...channels.map((c) => c.length));
  const samplesPerPeak = Math.max(1, Math.floor(sampleRate / pps));
  const peaks: number[] = [];
  for (let i = 0; i + samplesPerPeak <= length; i += samplesPerPeak) {
    let max = 0;
    for (const channel of channels) {
      for (let j = i; j < i + samplesPerPeak; j++) {
        const v = Math.abs(channel[j]);
        if (v > max) {
          max = v;
        }
      }
    }
    peaks.push(Math.round(max * 100) / 100);
  }
  return peaks.length > 0 ? { duration, peaksPerSecond: pps, peaks } : null;
}

/** A22: a klip a forrás `trimIn`-től kezdődő `duration` hosszú szakaszát mutatja. */
export function clipWindowPeaks(wave: WaveformData, trimIn: number | undefined, duration: number): number[] {
  const from = Math.max(0, Math.floor((trimIn ?? 0) * wave.peaksPerSecond));
  const to = Math.max(from + 1, Math.ceil(((trimIn ?? 0) + duration) * wave.peaksPerSecond));
  return wave.peaks.slice(from, Math.min(to, wave.peaks.length));
}

/**
 * A22: oszlop-magasság (0–1) az abszolút csúcsból. A korábbi min-max széthúzás a halk,
 * egyenletes hangot is teljes magasságúnak rajzolta; a gyök csak a halk részt emeli ki.
 */
export function barHeights(bars: number[]): number[] {
  return bars.map((p) => Math.min(1, Math.max(0.08, Math.sqrt(Math.max(0, p)))));
}

/** A24: a lemez-cache kulcsa a teljes uri + méret + módosítás ideje (a név+méret ütközött). */
export function waveformCacheKey(uri: string, size: number, modified: number): string {
  return `wf3_${hashKey(`${uri}|${size}|${modified}`)}`;
}

/** ESZKÖZÖN (natív) dekódolás → csúcsok, worker nélkül (react-native-audio-api). */
async function computeNativeWaveform(uri: string, userInitiated: boolean): Promise<WaveformData | null> {
  // a közös guard dönt (B24): iOS-en a háttér-hívás csak bizonyított modullal megy; a
  // Hang Stúdió megnyitása felhasználói szándék (A20), az ott kért hullámforma nem háttér-hívás
  const api = await loadAudioApi({ background: !userInitiated });
  if (!api) {
    return null;
  }
  try {
    // alacsony mintavétel: a görbéhez elég, gyors és kevés memória
    const audio = await api.decodeAudioData(uri, 8000);
    markAudioApi(true);
    const channels = Array.from({ length: Math.max(1, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
    return peaksFromChannels(channels, audio.sampleRate, audio.duration, WAVEFORM_PPS);
  } catch (caught) {
    logCaught('lib/waveform.ts:computeNativeWaveform', caught);
    return null; // az adott fájl nem dekódolható → worker-fallback
  }
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
    const channels = Array.from({ length: Math.max(1, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
    void ctx.close?.();
    return peaksFromChannels(channels, audio.sampleRate, audio.duration, WAVEFORM_PPS);
  } catch (caught) {
    logCaught('lib/waveform.ts:computeWebWaveform', caught);
    return null;
  }
}

function isMissingLocalFile(uri: string): boolean {
  if (!uri.startsWith('file:')) {
    return false;
  }
  try {
    return !new File(uri).exists;
  } catch (caught) {
    logCaught('lib/waveform.ts:isMissingLocalFile', caught);
    return false;
  }
}

export function getWaveform(uri: string, opts: { userInitiated?: boolean } = {}): Promise<WaveformData | null> {
  let pending = memory.get(uri);
  if (pending) {
    return pending;
  }
  if (Platform.OS === 'web') {
    pending = computeWebWaveform(uri);
    remember(uri, pending);
    pending.then((data) => {
      if (data === null) {
        memory.delete(uri);
      }
    });
    return pending;
  }
  pending = (async () => {
    let cacheFile: File | null = null;
    // a hiányzó helyi fájl nem hiba, hanem állapot (újracsatolásra vár): nincs dekódolás, nincs napló
    if (isMissingLocalFile(uri)) {
      return null;
    }
    try {
      const source = new File(uri);
      cacheFile = new File(Paths.cache, `${waveformCacheKey(uri, source.size ?? 0, source.modificationTime ?? 0)}.json`);
      if (cacheFile.exists) {
        return JSON.parse(await cacheFile.text()) as WaveformData;
      }
    } catch (caught) {
      logCaught('lib/waveform.ts:getWaveform', caught);
      cacheFile = null;
    }
    try {
      const data = await computeNativeWaveform(uri, !!opts.userInitiated);
      if (data && cacheFile) {
        try {
          cacheFile.write(JSON.stringify(data));
        } catch (caught) {
          logCaught('lib/waveform.ts:getWaveform', caught);
          // a lemez-cache opcionális
        }
      }
      return data;
    } catch (caught) {
      logCaught('lib/waveform.ts:getWaveform', caught);
      return null;
    }
  })();
  remember(uri, pending);
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
