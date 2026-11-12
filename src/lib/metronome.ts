import type { Meter } from '@/lib/audioTransport';
import { beatSeconds } from '@/lib/punchRecord';

/**
 * ⏱️ Metronóm (AP4) — pure mag. A klikkek az idővonal ütemrácsán ülnek (0 s = az 1. ütem eleje),
 * a projekt tempóján és ütemjelzésén; az ütem első ütése hangsúlyos (magasabb és hangosabb). A
 * hang ugyanaz, mint az előszámlálásé (1500 / 1000 Hz, 8 ms-os lecsengés), így a felvétel-igazítás
 * ugyanarra a mintára keres. A motor a már kikevert előnézeti szeletekhez adja hozzá — a
 * hangosságmérés UTÁN, és az export sosem hívja: a metronóm csak hallható, nem kerül sehova.
 */

export interface MetronomeConfig {
  bpm: number | undefined;
  meter: Meter;
  /** 0–1 */
  gain: number;
}

/** egy klikk hossza (mp) */
export const CLICK_SEC = 0.04;

/** a klikk egy mintája (a klikk elejétől számított `i`. minta) */
export function clickSample(accent: boolean, i: number, sr: number): number {
  const hz = accent ? 1500 : 1000;
  const amp = accent ? 0.8 : 0.55;
  return amp * Math.sin((2 * Math.PI * hz * i) / sr) * Math.exp(-i / (0.008 * sr));
}

/** a `[fromSec, toSec)` tartományban INDULÓ klikkek (beat-index és idő) */
export function metronomeClicks(fromSec: number, toSec: number, bpm: number | undefined, meter: Meter): { beat: number; t: number; accent: boolean }[] {
  const b = beatSeconds(bpm, meter);
  if (!(b > 0) || !(toSec > fromSec)) return [];
  const out: { beat: number; t: number; accent: boolean }[] = [];
  for (let k = Math.max(0, Math.ceil(fromSec / b - 1e-9)); k * b < toSec; k++) {
    out.push({ beat: k, t: k * b, accent: k % meter.beatsPerBar === 0 });
  }
  return out;
}

/**
 * a klikkek hozzáadása egy kikevert szelethez (idővonal-minta `from` … `to`); a szelet előtt indult,
 * de még szóló klikk vége is belekerül. A klikk kezdete mintapontos: `round(k · beat · sr)`.
 */
export function addMetronome(out: Float32Array[], from: number, to: number, sr: number, cfg: MetronomeConfig): void {
  const g = Math.max(0, Math.min(1, cfg.gain));
  if (g === 0 || to <= from) return;
  const len = Math.round(CLICK_SEC * sr);
  for (const c of metronomeClicks(Math.max(0, (from - len) / sr), to / sr, cfg.bpm, cfg.meter)) {
    const at = Math.round(c.t * sr);
    const a = Math.max(from, at);
    const b = Math.min(to, at + len);
    for (let s = a; s < b; s++) {
      const v = g * clickSample(c.accent, s - at, sr);
      for (const ch of out) ch[s - from] += v;
    }
  }
}
