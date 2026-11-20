import { sampleChannel } from '@/lib/keyframes';
import type { Keyframe } from '@/types/project';
import { KERNEL, runKernel } from '@/lib/dspKernels';
import { AUTO_BLOCK, type Processor } from '@/lib/dsp/processor';

/** 🔁 Késleltetés-alapú feldolgozók: visszhang/zengés és Haas-szélesítés. */

/**
 * 🏛️/🔁 Visszhang (előrecsatolt, több leágazás): kimenet = (be·inGain + Σ késleltetett_be·decayᵢ)·outGain
 * — a szerver `aecho=in:out:késések:csillapítások` beállításaival. A zengés két korai
 * visszaverődés (40 / 75 ms), a delay egy hosszú (120–500 ms).
 */
export class Echo implements Processor {
  /** a két csatorna vonala egymás után (csatornánként `len` minta) */
  private readonly lines: Float32Array;
  /** írófej (bal), írófej (jobb) */
  private readonly st = new Float64Array(2);
  /** be-erősítés ki-erősítés n · késések · csillapítások */
  private readonly p: Float64Array;
  private readonly n: number;

  constructor(inGain: number, outGain: number, delaysMs: number[], decays: number[], sr: number) {
    const taps = delaysMs.map((ms) => Math.round((ms / 1000) * sr));
    this.n = taps.length;
    this.lines = new Float32Array(2 * Math.max(1, Math.max(...taps) + 1));
    this.p = Float64Array.of(inGain, outGain, taps.length, ...taps, ...decays);
  }

  /** 🎛️ a csillapítások automációja: a mérték (0–1) görbéje → csillapítások (64 mintánként) */
  auto?: { kfs: Keyframe[]; fallback: number; decaysOf: (amount: number) => number[]; sr: number };

  processStereo(l: Float32Array, r: Float32Array, pos = 0): void {
    if (!this.auto) {
      runKernel(KERNEL.ECHO, l, r, this.p, this.st, this.lines);
      return;
    }
    // automáció: a darab az automáció 64 mintás rácsán szakaszokra bomlik, szakaszonként a görbe értékével
    const a = this.auto;
    let i = 0;
    while (i < l.length) {
      const at = pos + i;
      const next = Math.min(l.length, i + (AUTO_BLOCK - (at % AUTO_BLOCK)));
      const decays = a.decaysOf(sampleChannel(a.kfs, (at - (at % AUTO_BLOCK)) / a.sr, a.fallback));
      for (let k = 0; k < this.n; k++) this.p[3 + this.n + k] = decays[k];
      runKernel(KERNEL.ECHO, l.subarray(i, next), r.subarray(i, next), this.p, this.st, this.lines);
      i = next;
    }
  }
}

/**
 * 🎧 Haas-szélesítés: a közép (L+R)/2 jel a bal oldalra 2,05, a jobbra 2,12 ms késéssel kerül —
 * a szerver `haas` alapbeállítása (mono vagy szűk jelből széles sztereó-kép).
 */
export class Haas implements Processor {
  private readonly line: Float32Array;
  private readonly st = new Float64Array(1);
  private readonly p: Float64Array;

  constructor(sr: number, leftMs = 2.05, rightMs = 2.12) {
    const dl = Math.round((leftMs / 1000) * sr);
    const dr = Math.round((rightMs / 1000) * sr);
    this.line = new Float32Array(Math.max(1, Math.max(dl, dr) + 1));
    this.p = Float64Array.of(dl, dr);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.HAAS, l, r, this.p, this.st, this.line);
  }
}
