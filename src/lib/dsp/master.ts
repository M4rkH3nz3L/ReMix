import { KERNEL, runKernel } from '@/lib/dspKernels';
import { dbToLin, Gain, type Processor } from '@/lib/dsp/processor';
import { highShelf, lowShelf, peaking } from '@/lib/dsp/filters';
import { Compressor, Limiter, Multiband } from '@/lib/dsp/dynamics';

/** 🎛️ A master-lánc a keveréken: EQ, multiband, kompresszor, szaturáció, hangosság, csúcsplafon. */

/**
 * 🎛️ A master-lánc a keveréken (a szerver kétmenetes masterének felépítése): EQ (mély polc
 * 110 Hz, közép 1 kHz, magas polc 8 kHz) → (multiband) → a mért erősítés a cél-LUFS-re →
 * csúcsplafon a `truePeak`-re. `gain` nélkül (a mérő előmenet) a hangosság-lépés kimarad.
 */
export function buildMasterChain(
  master: { eq?: { low: number; mid: number; high: number }; multiband?: boolean; compressor?: { threshold: number; ratio: number }; saturation?: number; truePeak: number },
  sr: number,
  gain?: number
): Processor[] {
  const chain: Processor[] = [];
  if (master.eq?.low) chain.push(lowShelf(110, master.eq.low, sr));
  if (master.eq?.mid) chain.push(peaking(1000, master.eq.mid, sr));
  if (master.eq?.high) chain.push(highShelf(8000, master.eq.high, sr));
  if (master.multiband) chain.push(new Multiband(sr));
  // 🗜️🔥 master-kompresszor és szaturáció (a szerver `masterGraph`-jának tükre: acompressor + aeval tanh)
  const comp = masterCompressorParams(master.compressor);
  if (comp) chain.push(new Compressor(comp.threshold, comp.ratio, MASTER_COMP_ATTACK_MS, MASTER_COMP_RELEASE_MS, sr));
  const k = saturationDrive(master.saturation);
  if (k) chain.push(new Saturator(k));
  if (gain !== undefined) {
    chain.push(new Gain(gain), new Limiter(dbToLin(master.truePeak), 50, sr));
  }
  return chain;
}

/** a master-kompresszor (szorított) paraméterei; ki → null */
export const MASTER_COMP_ATTACK_MS = 10;
export const MASTER_COMP_RELEASE_MS = 150;
export function masterCompressorParams(c: { threshold: number; ratio: number } | undefined): { threshold: number; ratio: number } | null {
  if (!c) return null;
  return { threshold: Math.max(-40, Math.min(0, c.threshold)), ratio: Math.max(1, Math.min(20, c.ratio)) };
}

/** a szaturáció meghajtása (k = 1 + 7·mérték); 0 / hiányzó → null */
export function saturationDrive(amount: number | undefined): number | null {
  const a = Math.max(0, Math.min(1, amount ?? 0));
  return a > 0 ? Math.round((1 + 7 * a) * 1000) / 1000 : null;
}

/** 🔥 lágy telítés: y = tanh(k·x)/tanh(k) — a 0 dBFS marad 0 dBFS, a halkabb rész erősödik, felharmonikusok */
export class Saturator implements Processor {
  private readonly p: Float64Array;
  constructor(k: number) {
    this.p = Float64Array.of(k, 1 / Math.tanh(k));
  }
  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.SAT, l, r, this.p, new Float64Array(0));
  }
}
