import { FX_WARMUP } from '@/lib/audioDsp';

import { OFFLINE_SAMPLE_RATE, type OfflineMixClip, type OfflineMixPlan, type StretchJob } from './model';

/**
 * A terv átírása: a gyorsított/megfordított klip a kész szakaszra hivatkozik (`trimIn` 0,
 * `speed` 1), így a `mixRange` változatlanul keveri. Az azonos szakaszok egy feladatot adnak.
 */
export function stretchJobs(plan: OfflineMixPlan): { jobs: StretchJob[]; plan: OfflineMixPlan } {
  const jobs = new Map<string, StretchJob>();
  const clips = plan.clips.map((c) => {
    const denoise = !!c.fx?.denoise;
    if (c.speed === 1 && !c.reversed && c.pitch === 0 && !denoise) {
      return c;
    }
    const formant = !!c.formant && c.pitch !== 0;
    const key = `${c.uri}#${c.trimIn.toFixed(6)}|${c.duration.toFixed(6)}|${c.speed}|${c.reversed ? 'r' : 'f'}|${c.pitch}|${denoise ? 'dn' : ''}${formant ? '|fm' : ''}`;
    if (!jobs.has(key)) {
      jobs.set(key, { key, uri: c.uri, from: c.trimIn, sourceSec: c.duration * c.speed, duration: c.duration, speed: c.speed, reversed: c.reversed, pitch: c.pitch, denoise, ...(formant ? { formant: true } : {}) });
    }
    return { ...c, uri: key, trimIn: 0, speed: 1, reversed: false, pitch: 0, formant: false };
  });
  return { jobs: [...jobs.values()], plan: { ...plan, clips } };
}

/** A forrás `[from, from + n)` mintái csatornánként (a forráson túl csend), igény szerint fordítva. */
export function sliceSource(channels: Float32Array[], from: number, n: number, reversed: boolean): Float32Array[] {
  return channels.map((ch) => {
    const out = new Float32Array(n);
    const a = Math.max(0, from);
    const b = Math.min(ch.length, from + n);
    if (b > a) out.set(ch.subarray(a, b), a - from);
    if (reversed) out.reverse();
    return out;
  });
}

/** a feldolgozás az egész forrás-ablakot igényli (nyújtás, fordítás, hangmagasság, zajszűrés, normalizálás) */
export function needsWholeWindow(c: OfflineMixClip): boolean {
  return c.speed !== 1 || c.reversed || c.pitch !== 0 || !!c.fx?.denoise || !!c.fx?.normalize || !!c.loopLength;
}

/**
 * 🎧 A hosszú (szakaszos) forrás klipjeinek forrás-mintatartományai egy idővonal-tartományra
 * (a bejáratással) — ennyit kell betölteni a keverés előtt.
 */
export function sourceRanges(plan: OfflineMixPlan, isLong: (uri: string) => boolean, from: number, to: number): { uri: string; from: number; to: number }[] {
  const sr = OFFLINE_SAMPLE_RATE;
  const out: { uri: string; from: number; to: number }[] = [];
  for (const c of plan.clips) {
    if (!isLong(c.uri)) continue;
    const clipFrom = Math.round(c.start * sr);
    const clipTo = clipFrom + Math.round(c.duration * sr);
    const a = Math.max(from, clipFrom);
    const b = Math.min(to, clipTo);
    if (b <= a) continue;
    const off = Math.round(c.trimIn * sr) - clipFrom;
    const w0 = c.fx ? Math.max(clipFrom, a - FX_WARMUP) : a;
    out.push({ uri: c.uri, from: w0 + off, to: b + off });
  }
  return out;
}
