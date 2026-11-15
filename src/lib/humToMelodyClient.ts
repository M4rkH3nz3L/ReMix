import { melodyFromSegments, type HumOptions } from '@/lib/humToMelody';
import { decodeSample } from '@/lib/instrumentClient';
import { logCaught } from '@/lib/logCaught';
import { OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import type { SynthNote } from '@/lib/synth';
import { noteSegments, pitchTrack } from '@/lib/vocalTune';
import type { AudioClip } from '@/types/project';

/** 🎵 V8: a klip (dúdolás) hangjai → hangjegyek a klip látható tartományából, a projekt tempóján (a telefonon) */
export const HUM_MAX_SEC = 5 * 60;

export async function humClipToNotes(clip: AudioClip, opts: Omit<HumOptions, 'fromSec' | 'toSec'>): Promise<SynthNote[] | null> {
  try {
    const src = await decodeSample(clip.uri);
    if (!src || src[0].length === 0) return null;
    const sr = OFFLINE_SAMPLE_RATE;
    const from = clip.trimIn ?? 0;
    const to = Math.min(src[0].length / sr, from + clip.duration, from + HUM_MAX_SEC);
    const a = Math.floor(from * sr);
    const b = Math.floor(to * sr);
    const r = src[1] ?? src[0];
    const mono = Float32Array.from({ length: Math.max(0, b - a) }, (_, i) => (src[0][a + i] + r[a + i]) * 0.5);
    // a hangok a kivágott szakaszban 0-tól — a kezdet a klip elejéhez képest
    return melodyFromSegments(noteSegments(pitchTrack(mono, sr)), { ...opts, fromSec: 0, toSec: to - from });
  } catch (caught) {
    logCaught('lib/humToMelodyClient.ts', caught);
    return null;
  }
}
