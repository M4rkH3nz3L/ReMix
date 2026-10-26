import type { SilenceRange } from '@/lib/cutplan';

/**
 * 🔇 Eszközön futó csend-felismerés — tiszta mag (a worker FFmpeg
 * `silencedetect=noise=-35dB:d=0.5` szűrőjének megfelelője).
 *
 * Bemenet: mono Float32 PCM (a `decodeToMono16k` adja). Rövid ablakokban (10 ms)
 * számolt RMS-szint dBFS-ben; a küszöb ALATTI, legalább `minSilenceSec` hosszú
 * összefüggő szakasz csend. A kimenet FORRÁS-időben értett tartományok — pontosan
 * az a formátum, amit a worker `/silence` végpontja ad, így a meglévő vágásterv
 * (`buildCutPlan`) változtatás nélkül használja. Hangenergia-alapú (nem átirat-
 * alapú): a zenés, beszéd nélküli rész NEM csend — csak a valódi csend vágódik.
 */

export interface SilenceDetectOptions {
  /** küszöb dBFS-ben (FFmpeg `noise`) — alatta csend */
  thresholdDb?: number;
  /** ennél rövidebb csendet nem jelentünk (FFmpeg `d`) */
  minSilenceSec?: number;
  /** az RMS-ablak hossza (mp) */
  windowSec?: number;
}

const DEFAULTS: Required<SilenceDetectOptions> = {
  thresholdDb: -35,
  minSilenceSec: 0.5,
  windowSec: 0.01,
};

/** egy ablak RMS-szintje dBFS-ben (néma ablak → -Infinity) */
export function windowDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i += 1) {
    const v = samples[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / n);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * A csend-tartományok a PCM-ből. Determinista; a fájl végéig tartó csendet is
 * lezárja (mint a worker, ami a `silence_end` nélküli utolsó csendet a hosszig viszi).
 */
export function detectSilenceRanges(
  samples: Float32Array,
  sampleRate: number,
  opts: SilenceDetectOptions = {},
): SilenceRange[] {
  const o = { ...DEFAULTS, ...opts };
  if (samples.length === 0 || sampleRate <= 0) {
    return [];
  }
  const win = Math.max(1, Math.round(o.windowSec * sampleRate));
  const out: SilenceRange[] = [];
  let silenceStart: number | null = null;
  for (let i = 0; i < samples.length; i += win) {
    const end = Math.min(samples.length, i + win);
    const quiet = windowDb(samples, i, end) < o.thresholdDb;
    if (quiet && silenceStart === null) {
      silenceStart = i;
    } else if (!quiet && silenceStart !== null) {
      if ((i - silenceStart) / sampleRate >= o.minSilenceSec) {
        out.push({ start: silenceStart / sampleRate, end: i / sampleRate });
      }
      silenceStart = null;
    }
  }
  if (silenceStart !== null && (samples.length - silenceStart) / sampleRate >= o.minSilenceSec) {
    out.push({ start: silenceStart / sampleRate, end: samples.length / sampleRate });
  }
  // a tartományok mp-ben, 3 tizedesre (a worker kimenetének pontossága)
  return out.map((r) => ({
    start: Math.round(r.start * 1000) / 1000,
    end: Math.round(r.end * 1000) / 1000,
  }));
}
