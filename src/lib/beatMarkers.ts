/**
 * 🥁📍 Detektált beat-vonalak az idővonalra (AUDIOT §7) — pure + tesztelt.
 *
 * A `/beats` motor a FORRÁS-időben (a klip elejétől) adja a beat-időpontokat; ez a mag áthelyezi
 * őket az IDŐVONAL-időbe (a klip `start`-jával eltolva), a frame-rácsra illeszti, duplikátum-mentesen.
 * A Hang Stúdió ebből húz beat-vonalakat — így az importált zene VALÓS beatjeihez lehet vágni/igazítani.
 */

const MAX_BEAT_LINES = 512; // perf-plafon (hosszú zene)

/**
 * Forrás-beli beat-időpontok → idővonal-beli, frame-re illesztett, növekvő, duplikátum-mentes lista.
 * @param beats a `/beats` (BeatGrid.beats) forrás-idejű beat-időpontjai (mp)
 * @param clipStart a klip kezdete az idővonalon (mp)
 * @param fps a projekt frame-rátája (a snap-hez)
 */
export function beatsToTimelineLines(beats: number[], clipStart: number, fps: number): number[] {
  const f = fps > 0 ? fps : 30;
  const start = Math.max(0, Number(clipStart) || 0);
  const out: number[] = [];
  let prev = -1;
  for (const b of beats ?? []) {
    if (!Number.isFinite(b) || b < 0) {
      continue;
    }
    const t = Math.round((start + b) * f) / f; // idővonal-idő + frame-snap
    if (t >= 0 && (prev < 0 || t - prev > 1e-6)) {
      out.push(t);
      prev = t;
      if (out.length >= MAX_BEAT_LINES) {
        break;
      }
    }
  }
  return out;
}
