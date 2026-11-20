import { File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { hasRoomFor, isDiskFullError, megabytes } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { logCaught } from '@/lib/logCaught';
import { OFFLINE_SAMPLE_RATE, pcm16, pcm24, wavHeader16, wavHeader24, wavHeaderF32, pcmF32, type OfflineMixPlan } from '@/lib/offlineMix';
import { StreamResampler } from '@/lib/streamResampler';

import { mixLoop } from './mixLoop';
import type { Prepared } from './prepare';

/** WAV-mélység: 16 bit (TPDF-dither), 24 bit, vagy 32 bites lebegőpontos (a Pro köztes keveréke) */
export type WavBits = 16 | 24 | 32;

export const bytesPerSample = (bits: WavBits) => bits / 8;
export const wavHeader = (bits: WavBits, frames: number, channels = 2, sampleRate = OFFLINE_SAMPLE_RATE) =>
  bits === 32 ? wavHeaderF32(frames, channels, sampleRate) : bits === 24 ? wavHeader24(frames, channels, sampleRate) : wavHeader16(frames, channels, sampleRate);
export const wavData = (bits: WavBits, out: Float32Array[]) => (bits === 32 ? pcmF32(out) : bits === 24 ? pcm24(out) : pcm16(out));

/** a keverés WAV-ként a `write`-ba: fejléc + a `[a, b)` minták */
export async function writeWav(
  prep: Prepared,
  plan: OfflineMixPlan,
  range: [number, number],
  bits: WavBits,
  write: (bytes: Uint8Array) => void,
  onRatio: (r: number) => void,
  signal?: AbortSignal,
  out: { channels?: 1 | 2; sampleRate?: 44100 | 48000 } = {}
): Promise<void> {
  const ch = out.channels ?? 2;
  const sr = out.sampleRate ?? OFFLINE_SAMPLE_RATE;
  const frames = sr === OFFLINE_SAMPLE_RATE ? range[1] - range[0] : StreamResampler.outFrames(range[1] - range[0], OFFLINE_SAMPLE_RATE, sr);
  write(wavHeader(bits, frames, ch, sr));
  const rs = sr === OFFLINE_SAMPLE_RATE ? null : new StreamResampler(OFFLINE_SAMPLE_RATE, sr, ch);
  const toChannels = (l: Float32Array, r: Float32Array): Float32Array[] => {
    if (ch === 2) return [l, r];
    const m = new Float32Array(l.length);
    for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) * 0.5;
    return [m];
  };
  let written = 0;
  const emit = (chans: Float32Array[]) => {
    const n = Math.min(chans[0].length, frames - written);
    if (n <= 0) return;
    write(wavData(bits, n === chans[0].length ? chans : chans.map((c) => c.subarray(0, n))));
    written += n;
  };
  await mixLoop(prep, plan, range, (l, r) => emit(rs ? rs.process(toChannels(l, r)) : toChannels(l, r)), onRatio, signal);
  if (rs) emit(rs.flush());
  // a fejlécben megadott hossz pontos: a hiány csenddel (nem fordulhat elő, de a fájl ne legyen hibás)
  if (written < frames) emit(Array.from({ length: ch }, () => new Float32Array(frames - written)));
}

/** a kimeneti fájl írása (hiba esetén a félkész fájl törlődik, a betelt lemez érthető üzenet) */
export async function withTargetFile(target: File, needed: number, body: (write: (bytes: Uint8Array) => void) => Promise<void>): Promise<void> {
  if (target.exists) {
    target.delete();
  }
  target.create();
  const handle = target.open();
  try {
    await body((bytes) => handle.writeBytes(bytes));
  } catch (caught) {
    handle.close();
    try {
      target.delete();
    } catch (cleanup) {
      logCaught('lib/offlineMixClient.ts:cleanup', cleanup);
    }
    // menet közben betelt (más app is írt): érthető üzenet a natív hiba helyett
    if (isDiskFullError(caught)) {
      throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(freeDiskBytes()) }));
    }
    throw caught;
  }
  handle.close();
}

/** 💾 elfér-e (a WAV mérete előre ismert): ha nem, a dekódolás el sem indul */
export function ensureRoom(needed: number): void {
  const free = freeDiskBytes();
  if (!hasRoomFor(needed, free)) {
    throw new Error(tr('studio.audio.offline.noSpace', { need: megabytes(needed), free: megabytes(free) }));
  }
}
