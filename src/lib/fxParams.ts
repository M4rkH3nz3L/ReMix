/**
 * 🎛️ AUDIO-PROD V7 — a klip-effektek paraméterei, amelyeket a kliens DSP-je (`audioDsp.ts`) és a szerver
 * ffmpeg-lánca (`server/voicechain.js`) UGYANÍGY számol (szerződés-teszt). Pure, expo-mentes.
 *
 * - Parametrikus EQ: a három sáv frekvenciája és Q-ja állítható (hiányzó = a régi fix 100 Hz / 1 kHz / 8 kHz, Q 1).
 * - Tempóhoz kötött delay: a `delayBeats` (negyedhangban) a szándék, a `delayMs` a projekt tempójából kiszámolt
 *   idő. A szerver nem ismeri a tempótérképet, ezért a reducer írja vissza a `delayMs`-t minden szerkesztés után
 *   (`retimeTempoDelays`), és mindkét lánc csak a `delayMs`-t olvassa.
 */
import { bpmAt } from '@/lib/audioTransport';
import type { AudioClip, AudioFx, Clip, Project } from '@/types/project';

export type EqBandKey = 'low' | 'mid' | 'high';

/** sávonként: az alap frekvencia (a régi fix érték) és az állítható tartomány */
export const EQ_BAND_SPEC: Record<EqBandKey, { freq: number; min: number; max: number }> = {
  low: { freq: 100, min: 20, max: 500 },
  mid: { freq: 1000, min: 200, max: 8000 },
  high: { freq: 8000, min: 2000, max: 20000 },
};
export const EQ_Q_MIN = 0.3;
export const EQ_Q_MAX = 8;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface EqBandParams {
  key: EqBandKey;
  freq: number;
  q: number;
  gain: number;
}

/** a három sáv tényleges paraméterei (frekvencia egészre, Q két tizedesre, erősítés −12…12 dB) */
export function eqBandParams(eq: AudioFx['eq'] | undefined): EqBandParams[] {
  return (['low', 'mid', 'high'] as const).map((key) => {
    const spec = EQ_BAND_SPEC[key];
    const e = (eq ?? {}) as Record<string, unknown>;
    return {
      key,
      freq: Math.round(clampN(num(e[`${key}Freq`], spec.freq), spec.min, spec.max)),
      q: Math.round(clampN(num(e[`${key}Q`], 1), EQ_Q_MIN, EQ_Q_MAX) * 100) / 100,
      gain: clampN(num(e[key], 0), -12, 12),
    };
  });
}

/** a választható ütemrészek negyedhangban: 1/16, 1/8, pontozott 1/8, 1/4, 1/2 */
export const DELAY_BEAT_OPTIONS = [0.25, 0.5, 0.75, 1, 2] as const;
export const DELAY_MS_MIN = 20;
export const DELAY_MS_MAX = 2000;

/** ütemrész + tempó → ms (egészre, a szerver aecho-ja egész ms-t kap) */
export function delayMsForBeats(beats: number, bpm: number): number {
  const b = bpm > 0 ? bpm : 120;
  return Math.round(clampN((60000 / b) * beats, DELAY_MS_MIN, DELAY_MS_MAX));
}

/** a delay ideje ms-ben: tempóhoz kötve a kiszámolt `delayMs`, különben a régi mérték-alapú 120–500 ms */
export function delayTimeMs(fx: Pick<AudioFx, 'delay' | 'delayBeats' | 'delayMs'> | undefined): number {
  if (fx?.delayBeats && fx.delayBeats > 0 && fx.delayMs && fx.delayMs > 0) {
    return Math.round(clampN(fx.delayMs, DELAY_MS_MIN, DELAY_MS_MAX));
  }
  const a = clampN(fx?.delay ?? 0.5, 0, 1);
  return Math.round(120 + a * 380);
}

/**
 * Minden tempóhoz kötött delay `delayMs`-e a klip kezdeténél érvényes tempóból. Ha semmi sem változik, UGYANAZT
 * a projekt-objektumot adja vissza (a reducer minden parancs után hívja — undo-semleges).
 */
export function retimeTempoDelays(project: Project): Project {
  let changed = false;
  const tracks = project.tracks.map((track) => {
    let trackChanged = false;
    const clips = track.clips.map((c: Clip) => {
      if (c.kind !== 'audio') return c;
      const fx = (c as AudioClip).audioFx;
      if (!fx?.delayBeats || fx.delayBeats <= 0) return c;
      const ms = delayMsForBeats(fx.delayBeats, bpmAt(project, c.start));
      if (fx.delayMs === ms) return c;
      trackChanged = true;
      return { ...c, audioFx: { ...fx, delayMs: ms } } as Clip;
    });
    if (!trackChanged) return track;
    changed = true;
    return { ...track, clips };
  });
  return changed ? { ...project, tracks } : project;
}
