import type { EditorCommand } from '@/lib/commands';
import { snapToFrame } from '@/lib/frames';
import { buildMultiRangeDeletePlan } from '@/lib/rangeEdit';
import type { AudioClip, Project, TrackType } from '@/types/project';

/**
 * 🔇 Csendek a Hang Stúdióban — tiszta mag. A klip forrásából 10 ms-os ablakokban mért szint
 * (dBFS) → a küszöb alatti, elég hosszú szakaszok → a klip idővonal-idejére vetítve, a beszéd
 * felőli oldalon levegőt hagyva, frame-rácsra igazítva. A felhasználó egyenként jóváhagyja,
 * és a kivágás EGY undo-lépés (`REPLACE_TRACK_CLIPS`-ek a meglévő ripple-tervből).
 */

export interface TimeRange {
  start: number;
  end: number;
}

/** a szintmérés ablaka (mp) — a worker `silencedetect`-jének felbontása */
export const SILENCE_WIN = 0.01;
/** a néma ablak szintje (a −Infinity helyett, hogy a rendezés/percentilis működjön) */
const FLOOR_DB = -120;

export interface SilenceOptions {
  /** ennél rövidebb csend marad (természetes szünet, levegővétel) */
  minSilenceSec?: number;
  /** a beszéd felőli oldalon ennyi levegő marad */
  padSec?: number;
  /** fix küszöb (dBFS); hiányzó = a felvétel szintjéhez igazított (`autoThresholdDb`) */
  thresholdDb?: number;
}

const DEFAULTS = { minSilenceSec: 0.6, padSec: 0.12 };

/** ablakonkénti RMS-szint dBFS-ben (mono) */
export function levelsDb(mono: Float32Array, sampleRate: number, win = SILENCE_WIN): Float32Array {
  const n = Math.max(1, Math.round(win * sampleRate));
  const out = new Float32Array(Math.ceil(mono.length / n));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    const end = Math.min(mono.length, (w + 1) * n);
    for (let i = w * n; i < end; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, end - w * n));
    out[w] = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
  }
  return out;
}

/**
 * A küszöb a felvétel szintjéhez igazodik: a hangos rész (95. percentilis) alatt 20 dB-lel, de
 * legfeljebb −35 dBFS (a worker alapértéke) — így a halkan felvett beszéd sem lesz „csend”.
 */
export function autoThresholdDb(levels: Float32Array): number {
  if (levels.length === 0) return -35;
  const sorted = Float32Array.from(levels).sort();
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return Math.max(-70, Math.min(-35, loud - 20));
}

/** a küszöb alatti, legalább `minSec` hosszú szakaszok (mp, a szintsor elejétől) */
export function silentRuns(levels: Float32Array, thresholdDb: number, minSec: number, win = SILENCE_WIN): TimeRange[] {
  const out: TimeRange[] = [];
  let from = -1;
  for (let w = 0; w <= levels.length; w++) {
    const quiet = w < levels.length && levels[w] < thresholdDb;
    if (quiet && from < 0) from = w;
    if (!quiet && from >= 0) {
      if ((w - from) * win >= minSec - 1e-9) out.push({ start: from * win, end: w * win });
      from = -1;
    }
  }
  return out;
}

/**
 * A forrás-idejű csendek (a klip forrás-ablakának elejétől, `srcFrom`) → a klip idővonal-idejére.
 * A klip szélén lévő csend végig kivágható; a beszéd felőli oldalon `padSec` levegő marad. A
 * határok frame-rácsra kerülnek. Loop-klipre nem értelmezett (üres).
 */
export function clipSilences(
  clip: Pick<AudioClip, 'start' | 'duration' | 'trimIn' | 'speed' | 'reversed' | 'loopLength'>,
  srcFrom: number,
  runs: TimeRange[],
  fps: number,
  opts: SilenceOptions = {}
): TimeRange[] {
  if (clip.loopLength && clip.loopLength > 0) return [];
  const pad = opts.padSec ?? DEFAULTS.padSec;
  const minSec = opts.minSilenceSec ?? DEFAULTS.minSilenceSec;
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const trimIn = clip.trimIn ?? 0;
  const end = clip.start + clip.duration;
  const toTimeline = (s: number) =>
    clip.reversed ? clip.start + (trimIn + clip.duration * speed - s) / speed : clip.start + (s - trimIn) / speed;
  const out: TimeRange[] = [];
  for (const r of runs) {
    const a = toTimeline(srcFrom + r.start);
    const b = toTimeline(srcFrom + r.end);
    let from = Math.max(clip.start, Math.min(a, b));
    let to = Math.min(end, Math.max(a, b));
    if (to - from < minSec - 1e-9) continue;
    // levegő a beszéd felőli oldalon (a klip széle felé nincs beszéd)
    if (from > clip.start + 1e-6) from += pad;
    if (to < end - 1e-6) to -= pad;
    from = snapToFrame(from, fps);
    to = snapToFrame(to, fps);
    if (to - from > 1e-6) out.push({ start: from, end: to });
  }
  return out;
}

export type SilenceCutMode = 'track' | 'all';

/**
 * A jóváhagyott csendek kivágása (ripple): `track` = csak a klip sávja (a többi érintetlen),
 * `all` = minden nem zárolt sáv együtt (a zene-sáv folyamatos marad, csak tolódik — kivéve, ha
 * maga a klip van rajta). EGY undo-lépés parancsai; üres, ha nincs mit vágni.
 */
export function silenceCutCommands(
  project: Project,
  trackType: TrackType,
  ranges: TimeRange[],
  mode: SilenceCutMode,
  lockedTracks: TrackType[] = []
): EditorCommand[] {
  const others = project.tracks.map((t) => t.type).filter((t) => t !== trackType);
  const locked = mode === 'track' ? others : lockedTracks.filter((t) => t !== trackType);
  const continuous: TrackType[] = mode === 'track' || trackType === 'music' ? [] : ['music'];
  const patches = buildMultiRangeDeletePlan(project, ranges, locked, continuous);
  return (patches ?? []).map((p) => ({ type: 'REPLACE_TRACK_CLIPS', trackType: p.trackType, clips: p.clips }));
}
