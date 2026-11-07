import { decodeToMono16k } from '@/lib/audioDecode';
import { autoThresholdDb, clipSilences, levelsDb, SILENCE_WIN, silentRuns, type SilenceOptions, type TimeRange } from '@/lib/audioSilence';
import { canSegment, isLongSource, LongSource } from '@/lib/longSource';
import { WHISPER_SAMPLE_RATE } from '@/lib/wav';
import type { AudioClip } from '@/types/project';

/**
 * 🔇 A klip forrásának szintmérése az eszközön (a csend-jóváhagyáshoz). Rövid forrás: egyben
 * dekódolva 16 kHz monóra; hosszú (10 percnél hosszabb) forrás: a szakaszos natív dekóderrel,
 * 20 s-onként — a memóriában sosem a teljes fájl. Csak a klip forrás-ablaka mérődik.
 */
export async function measureClipLevels(clip: AudioClip): Promise<{ levels: Float32Array; srcFrom: number } | null> {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const srcFrom = clip.trimIn ?? 0;
  const srcTo = Math.min(clip.sourceDuration ?? Infinity, srcFrom + clip.duration * speed);
  if (canSegment() && isLongSource(clip.sourceDuration)) {
    const SR = 44100;
    const src = new LongSource(clip.uri);
    const parts: Float32Array[] = [];
    const STEP = 20 * SR; // a mérő-ablak (441 minta) egész többszöröse
    for (let a = Math.round(srcFrom * SR); a < Math.round(srcTo * SR); a += STEP) {
      const b = Math.min(Math.round(srcTo * SR), a + STEP);
      await src.ensure(a, b);
      const ch = src.read(a, b);
      if (!ch) return null;
      const mono = new Float32Array(b - a);
      for (const c of ch) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / ch.length;
      parts.push(levelsDb(mono, SR));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const levels = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    for (const p of parts) {
      levels.set(p, at);
      at += p.length;
    }
    return { levels, srcFrom };
  }
  const pcm = await decodeToMono16k(clip.uri);
  if (!pcm) return null;
  const sr = WHISPER_SAMPLE_RATE;
  return { levels: levelsDb(pcm.subarray(Math.round(srcFrom * sr), Math.round(srcTo * sr)), sr), srcFrom };
}

/** a klip csendjei az idővonalon (`null`: a forrás nem dekódolható) */
export async function findClipSilences(clip: AudioClip, fps: number, opts: SilenceOptions = {}): Promise<TimeRange[] | null> {
  const m = await measureClipLevels(clip);
  if (!m) return null;
  const threshold = opts.thresholdDb ?? autoThresholdDb(m.levels);
  return clipSilences(clip, m.srcFrom, silentRuns(m.levels, threshold, opts.minSilenceSec ?? 0.6, SILENCE_WIN), fps, opts);
}
