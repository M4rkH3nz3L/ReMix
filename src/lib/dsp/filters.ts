import { sampleChannel } from '@/lib/keyframes';
import type { Keyframe } from '@/types/project';
import { KERNEL, runKernel } from '@/lib/dspKernels';
import { AUTO_BLOCK, type Processor } from '@/lib/dsp/processor';

/** 🎛️ Szűrők: RBJ-biquad (direkt I. alak, 64 bites állapot), polcok és az automatizált szűrő. */

/** másodrendű IIR szűrő (direkt I. alak, csatornánkénti állapot) */
export class Biquad implements Processor {
  /** normált együtthatók: b0 b1 b2 a1 a2 */
  private readonly k = new Float64Array(5);
  /** állapot: x1 x2 y1 y2 (bal), x1 x2 y1 y2 (jobb) — 64 bites */
  private st = new Float64Array(8);

  constructor(c: { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }) {
    this.setCoeffs(c);
  }

  /** új együtthatók (az állapot marad — automációhoz) */
  setCoeffs(c: { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }): void {
    this.k[0] = c.b0 / c.a0;
    this.k[1] = c.b1 / c.a0;
    this.k[2] = c.b2 / c.a0;
    this.k[3] = c.a1 / c.a0;
    this.k[4] = c.a2 / c.a0;
  }

  /** a normált együtthatók (a de-esser detektora a natív magnak adja tovább) */
  coeffs(): Float64Array {
    return this.k;
  }

  reset(): void {
    this.st = new Float64Array(8);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.BIQUAD, l, r, this.k, this.st);
  }
}

const omega = (f: number, sr: number) => (2 * Math.PI * f) / sr;

export type Coeffs = { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number };

export function highpassCoeffs(f: number, sr: number, q = 0.707): Coeffs {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
}

export function lowpassCoeffs(f: number, sr: number, q = 0.707): Coeffs {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return { b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
}

export function peakingCoeffs(f: number, gainDb: number, sr: number, q = 1): Coeffs {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
}

/** ffmpeg `highpass=f=…` (2 pólus, Q = 0,707) */
export function highpass(f: number, sr: number, q = 0.707): Biquad {
  return new Biquad(highpassCoeffs(f, sr, q));
}

/** ffmpeg `lowpass=f=…` (2 pólus, Q = 0,707) */
export function lowpass(f: number, sr: number, q = 0.707): Biquad {
  return new Biquad(lowpassCoeffs(f, sr, q));
}

/** ffmpeg `equalizer=f=…:t=q:w=…:g=…` (csúcs-EQ) */
export function peaking(f: number, gainDb: number, sr: number, q = 1): Biquad {
  return new Biquad(peakingCoeffs(f, gainDb, sr, q));
}

/**
 * 🎛️ Automatizált szűrő: a paraméter (frekvencia vagy erősítés) a kulcskocka-görbéből, 64
 * mintánként frissül (a klip saját rácsán); az állapot folytonos — nincs kattogás.
 */
export class AutoBiquad implements Processor {
  private readonly bq: Biquad;
  private last = Number.NaN;

  private last2 = Number.NaN;

  constructor(
    private readonly design: (v: number, w: number) => Coeffs,
    private readonly kfs: Keyframe[],
    private readonly fallback: number,
    private readonly sr: number,
    /** 🎛️ V7.4: második automatizált paraméter (pl. a sáv frekvenciája az erősítés mellett) */
    private readonly kfs2: Keyframe[] | undefined = undefined,
    private readonly fallback2 = 0
  ) {
    this.bq = new Biquad(design(fallback, fallback2));
  }

  processStereo(l: Float32Array, r: Float32Array, pos: number): void {
    let i = 0;
    while (i < l.length) {
      const at = pos + i;
      const next = Math.min(l.length, i + (AUTO_BLOCK - (at % AUTO_BLOCK)));
      // az érték a RÁCSPONTBÓL (nem a darab kezdetéből) — így a darabolás nem hagy nyomot
      const grid = (at - (at % AUTO_BLOCK)) / this.sr;
      const v = sampleChannel(this.kfs, grid, this.fallback);
      const w = this.kfs2 ? sampleChannel(this.kfs2, grid, this.fallback2) : this.fallback2;
      if (v !== this.last || w !== this.last2) {
        this.bq.setCoeffs(this.design(v, w));
        this.last = v;
        this.last2 = w;
      }
      this.bq.processStereo(l.subarray(i, next), r.subarray(i, next));
      i = next;
    }
  }
}

/** RBJ magas-polc (high-shelf) együtthatók, S = 1 */
function highShelfCoeffs(f: number, gainDb: number, sr: number) {
  const A = Math.pow(10, gainDb / 40);
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const sq = 2 * Math.sqrt(A) * alpha;
  return {
    b0: A * (A + 1 + (A - 1) * cos + sq),
    b1: -2 * A * (A - 1 + (A + 1) * cos),
    b2: A * (A + 1 + (A - 1) * cos - sq),
    a0: A + 1 - (A - 1) * cos + sq,
    a1: 2 * (A - 1 - (A + 1) * cos),
    a2: A + 1 - (A - 1) * cos - sq,
  };
}

/** RBJ magas-polc szűrő */
export function highShelf(f: number, gainDb: number, sr: number): Biquad {
  return new Biquad(highShelfCoeffs(f, gainDb, sr));
}

/** RBJ mély-polc (low-shelf) együtthatók, S = 1 */
export function lowShelf(f: number, gainDb: number, sr: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const sq = 2 * Math.sqrt(A) * alpha;
  return new Biquad({
    b0: A * (A + 1 - (A - 1) * cos + sq),
    b1: 2 * A * (A - 1 - (A + 1) * cos),
    b2: A * (A + 1 - (A - 1) * cos - sq),
    a0: A + 1 + (A - 1) * cos + sq,
    a1: -2 * (A - 1 + (A + 1) * cos),
    a2: A + 1 + (A - 1) * cos - sq,
  });
}
