/**
 * ▶ Auto Edit változat-előnézet (P0‑1 bővítés) — pure óra-lépés: a lejátszó a
 * keep-sávokon ugrálva, A VÁLTOZAT SORRENDJÉBEN játszik (a sorrend a story!),
 * a projekt módosítása nélkül. A usePlaybackClock hívja tickenként.
 */

export interface PreviewRange {
  start: number;
  end: number;
}

export interface PreviewStep {
  playhead: number;
  playing: boolean;
}

const EPS = 0.001;

/** egy óra-tick a sáv-listán: sávvégnél a következő sáv elejére ugrik */
export function stepPreviewPlayhead(
  ranges: PreviewRange[],
  playhead: number,
  dt: number,
  loop: boolean
): PreviewStep {
  if (ranges.length === 0) {
    return { playhead, playing: false };
  }
  const idx = ranges.findIndex((r) => playhead >= r.start - EPS && playhead < r.end - EPS);
  if (idx === -1) {
    // sávon kívül (pl. most indult az előnézet) — az első sáv elejére
    return { playhead: ranges[0].start, playing: true };
  }
  const next = playhead + dt;
  if (next < ranges[idx].end) {
    return { playhead: next, playing: true };
  }
  if (idx + 1 < ranges.length) {
    return { playhead: ranges[idx + 1].start, playing: true };
  }
  if (loop) {
    return { playhead: ranges[0].start, playing: true };
  }
  return { playhead: ranges[idx].end, playing: false };
}

/** az előnézet teljes hossza (a kártya-feliratokhoz) */
export function previewDuration(ranges: PreviewRange[]): number {
  return ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
}
