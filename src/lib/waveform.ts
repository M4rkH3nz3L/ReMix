import Constants, { ExecutionEnvironment } from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

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

const memory = new Map<string, Promise<WaveformData | null>>();

function hashKey(input: string): string {
  // djb2 — csak cache-fájlnévhez kell
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** csúcsok kinyerése egy dekódolt csatornából (közös a natív + web úthoz) */
function peaksFromChannel(
  channel: Float32Array,
  sampleRate: number,
  duration: number,
  pps: number
): WaveformData | null {
  const samplesPerPeak = Math.max(1, Math.floor(sampleRate / pps));
  const peaks: number[] = [];
  for (let i = 0; i + samplesPerPeak <= channel.length; i += samplesPerPeak) {
    let max = 0;
    // ritkított mintavétel a csúcson belül — gyors, a burkológörbe megmarad
    for (let j = i; j < i + samplesPerPeak; j += 4) {
      const v = Math.abs(channel[j]);
      if (v > max) {
        max = v;
      }
    }
    peaks.push(Math.round(max * 100) / 100);
  }
  return peaks.length > 0 ? { duration, peaksPerSecond: pps, peaks } : null;
}

/**
 * A natív dekóder állapota. A `react-native-audio-api` NATÍV modul: Expo Go-ban
 * (és rá nem buildelt dev-kliensben) NINCS jelen, és MÁR AZ IMPORTKOR dob
 * (modul-szintű install-ellenőrzés) — a lusta import() ezt csak elhalasztja, de
 * minden hívásnál újra megtörténne (hibaspam). Ezért: Expo Go-ban meg se
 * próbáljuk, és az első hiány után végleg lemondunk róla (csendes visszaesés a
 * sima sávra). Valódi (natív) buildben a modul jelen van → valódi hullámforma.
 */
let nativeDecoder: 'unknown' | 'ok' | 'missing' = 'unknown';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** ESZKÖZÖN (natív) dekódolás → csúcsok, worker nélkül (react-native-audio-api). */
async function computeNativeWaveform(uri: string): Promise<WaveformData | null> {
  if (nativeDecoder === 'missing' || isExpoGo) {
    return null; // nincs natív modul — nincs import-kísérlet, nincs hibalog
  }
  try {
    const { decodeAudioData } = await import('react-native-audio-api');
    // alacsony mintavétel: a görbéhez elég, gyors és kevés memória
    const audio = await decodeAudioData(uri, 8000);
    nativeDecoder = 'ok';
    return peaksFromChannel(audio.getChannelData(0), audio.sampleRate, audio.duration, 20);
  } catch {
    nativeDecoder = 'missing'; // többé ne próbálkozzunk (nincs spam)
    return null;
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
      const data = await computeNativeWaveform(uri);
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
