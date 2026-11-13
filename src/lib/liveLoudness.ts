import { kWeighting } from '@/lib/loudness';

/**
 * 📊 Élő hangosság és true-peak — tiszta mag (expo-mentes). Az előnézet-motor a ténylegesen szóló
 * keverést (az exporttal azonos DSP: effektek, halkítás, master) szeletenként adja; a mérő a lejátszófej
 * idejére számol (BS.1770-4 / EBU R128):
 *
 * - momentary = az utolsó 400 ms, short-term = az utolsó 3 s (K-szűrt, csatornánként összegzett energia);
 * - integrált = a lejátszás eleje óta, 400 ms-os, 75 %-ban átlapolt ablakok, −70 LUFS abszolút és
 *   −10 LU relatív kapuval;
 * - true-peak = 4× túlmintavétel (48 együtthatós ablakozott sinc, polifázisban) — a mintacsúcs
 *   a minták közti csúcsot nem látja (fs/4-es szinusz 45°-os fázissal: +3,01 dB).
 *
 * Nem folytatólagos szelet (ugrás) → a mérés onnan újraindul.
 */

const TAPS = 48;
const PHASES = 4;

/** a 4×-es interpoláló szűrő együtthatói (Kaiser-szerű Blackman-ablak), fázisonként normálva */
function upsampleKernel(): Float32Array[] {
  const h = new Float64Array(TAPS);
  const mid = (TAPS - 1) / 2;
  for (let n = 0; n < TAPS; n++) {
    const x = (n - mid) / PHASES;
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (TAPS - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (TAPS - 1));
    h[n] = sinc * w;
  }
  return Array.from({ length: PHASES }, (_, p) => {
    const k = Float32Array.from({ length: TAPS / PHASES }, (_, j) => h[j * PHASES + p]);
    const sum = k.reduce((a, b) => a + b, 0);
    return k.map((v) => v / sum);
  });
}
const KERNEL = upsampleKernel();
const HIST = TAPS / PHASES;

export interface LoudnessReading {
  momentary: number;
  shortTerm: number;
  integrated: number;
  /** true-peak (dBTP) az utolsó 3 s-ban */
  truePeak: number;
  /** a legnagyobb true-peak a mérés eleje óta (dBTP) */
  truePeakMax: number;
}

const lufs = (p: number) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
const dbtp = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export class LiveLoudness {
  private readonly blockLen: number;
  private filters: ReturnType<typeof kWeighting>;
  /** 100 ms-os blokkok: K-szűrt energia (a két csatorna összege, mintánkénti átlag) és true-peak */
  private energy: number[] = [];
  private peaks: number[] = [];
  private acc = 0;
  private accPeak = 0;
  private accN = 0;
  private start = 0;
  private next = -1;
  /** gyűrűpuffer csatornánként (kétszeres hosszal: az ablak mindig folytonosan olvasható) */
  private ring: [Float32Array, Float32Array] = [new Float32Array(2 * HIST), new Float32Array(2 * HIST)];
  private pos = 0;
  private histN = 0;

  constructor(private readonly sr: number) {
    this.blockLen = Math.round(0.1 * sr);
    this.filters = kWeighting(sr);
  }

  /** a mérés újraindul `from`-tól (ugrás, új terv) */
  reset(from: number): void {
    this.filters = kWeighting(this.sr);
    this.energy = [];
    this.peaks = [];
    this.acc = 0;
    this.accPeak = 0;
    this.accN = 0;
    this.start = from;
    this.next = from;
    this.ring = [new Float32Array(2 * HIST), new Float32Array(2 * HIST)];
    this.pos = 0;
    this.histN = 0;
  }

  /** egy szelet (a projekt `from`. mintájától) — a nem folytatólagos szelet újraindítja a mérést */
  push(from: number, l: Float32Array, r: Float32Array): void {
    if (from !== this.next) this.reset(from);
    const n = Math.min(l.length, r.length);
    const kl = Float32Array.from(l.subarray(0, n));
    const kr = Float32Array.from(r.subarray(0, n));
    for (const f of this.filters) f.processStereo(kl, kr);
    for (let i = 0; i < n; i++) {
      this.acc += kl[i] * kl[i] + kr[i] * kr[i];
      // true-peak: az eredeti minta + a 3 köztes (polifázis), csatornánként; a gyűrű a legújabbtól visszafelé
      this.pos = (this.pos + HIST - 1) % HIST;
      for (let c = 0; c < 2; c++) {
        const ring = this.ring[c];
        const x = c === 0 ? l[i] : r[i];
        ring[this.pos] = x;
        ring[this.pos + HIST] = x;
        let m = Math.abs(x);
        if (this.histN >= HIST) {
          for (let p = 1; p < PHASES; p++) {
            const k = KERNEL[p];
            let y = 0;
            for (let j = 0; j < HIST; j++) y += ring[this.pos + j] * k[j];
            const a = Math.abs(y);
            if (a > m) m = a;
          }
        }
        if (m > this.accPeak) this.accPeak = m;
      }
      if (this.histN < HIST) this.histN++;
      if (++this.accN === this.blockLen) {
        this.energy.push(this.acc / this.blockLen);
        this.peaks.push(this.accPeak);
        this.acc = 0;
        this.accPeak = 0;
        this.accN = 0;
      }
    }
    this.next = from + n;
  }

  /**
   * 📏 hangosság-tartomány (LRA, EBU Tech 3342): a 3 s-os rövid távú hangosság 100 ms-onként, abszolút
   * kapu −70 LUFS, relatív kapu −20 LU az átlag alatt, LRA = a 95. és a 10. percentilis különbsége (LU)
   */
  loudnessRange(): number {
    const st: number[] = [];
    let sum = 0;
    for (let i = 0; i < this.energy.length; i++) {
      sum += this.energy[i];
      if (i >= 30) sum -= this.energy[i - 30];
      if (i >= 29) st.push(sum / 30);
    }
    const abs = st.filter((p) => lufs(p) > -70);
    if (abs.length === 0) return 0;
    const gate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
    const rel = abs.filter((p) => lufs(p) > gate).map(lufs).sort((a, b) => a - b);
    if (rel.length < 2) return 0;
    const at = (q: number) => rel[Math.min(rel.length - 1, Math.max(0, Math.round(q * (rel.length - 1))))];
    return at(0.95) - at(0.1);
  }

  /** a mérés a projekt `at`. mintájáig (a lejátszófej); a még be nem ért blokkok nem számítanak */
  readAt(at: number): LoudnessReading {
    const upto = Math.max(0, Math.min(this.energy.length, Math.floor((at - this.start) / this.blockLen)));
    const mean = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this.energy[i];
      return b > a ? s / (b - a) : 0;
    };
    const momentary = upto >= 4 ? lufs(mean(upto - 4, upto)) : -Infinity;
    const shortTerm = upto >= 30 ? lufs(mean(upto - 30, upto)) : -Infinity;
    const windows: number[] = [];
    for (let i = 4; i <= upto; i++) windows.push(mean(i - 4, i));
    const abs = windows.filter((p) => lufs(p) > -70);
    let integrated = -Infinity;
    if (abs.length > 0) {
      const gate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const rel = abs.filter((p) => lufs(p) > gate);
      if (rel.length > 0) integrated = lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
    }
    let tp = 0;
    for (let i = Math.max(0, upto - 30); i < upto; i++) tp = Math.max(tp, this.peaks[i]);
    let tpMax = 0;
    for (let i = 0; i < upto; i++) tpMax = Math.max(tpMax, this.peaks[i]);
    return { momentary, shortTerm, integrated, truePeak: dbtp(tp), truePeakMax: dbtp(tpMax) };
  }
}
