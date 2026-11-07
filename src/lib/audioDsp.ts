import type { AudioFx } from '@/types/project';

/**
 * 🎛️ A KÖZÖS hang-DSP (PRO-AUDIO „azt kapod, amit hallasz”): az előnézet és a telefonos export
 * ugyanezt a kódot futtatja (`mixRange`). A szűrők a szerver ffmpeg-láncának (`voicechain.js`
 * `audioFxChain`) matematikáját követik — RBJ-biquad, direkt I. alak, 64 bites állapot —, így a
 * telefon és a szerver kimenete kivonva mérhetően egyezik.
 *
 * Ami itt még nincs, az a `fxUnsupported`-ban jelzett (a klip addig a régi úton szól).
 */

/** másodrendű IIR szűrő (direkt I. alak, csatornánkénti állapot) */
export class Biquad {
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;
  private x1 = [0, 0];
  private x2 = [0, 0];
  private y1 = [0, 0];
  private y2 = [0, 0];

  constructor(c: { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number }) {
    this.b0 = c.b0 / c.a0;
    this.b1 = c.b1 / c.a0;
    this.b2 = c.b2 / c.a0;
    this.a1 = c.a1 / c.a0;
    this.a2 = c.a2 / c.a0;
  }

  reset(): void {
    this.x1 = [0, 0];
    this.x2 = [0, 0];
    this.y1 = [0, 0];
    this.y2 = [0, 0];
  }

  /** helyben szűr egy csatornát */
  process(buf: Float32Array, ch: number): void {
    let x1 = this.x1[ch];
    let x2 = this.x2[ch];
    let y1 = this.y1[ch];
    let y2 = this.y2[ch];
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      buf[i] = y;
    }
    this.x1[ch] = x1;
    this.x2[ch] = x2;
    this.y1[ch] = y1;
    this.y2[ch] = y2;
  }
}

const omega = (f: number, sr: number) => (2 * Math.PI * f) / sr;

/** ffmpeg `highpass=f=…` (2 pólus, Q = 0,707) */
export function highpass(f: number, sr: number, q = 0.707): Biquad {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return new Biquad({ b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha });
}

/** ffmpeg `lowpass=f=…` (2 pólus, Q = 0,707) */
export function lowpass(f: number, sr: number, q = 0.707): Biquad {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return new Biquad({ b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha });
}

/** ffmpeg `equalizer=f=…:t=q:w=…:g=…` (csúcs-EQ) */
export function peaking(f: number, gainDb: number, sr: number, q = 1): Biquad {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  return new Biquad({ b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A });
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** a közös DSP-ben már megvalósított effektek */
const SUPPORTED = new Set<keyof AudioFx>(['highpass', 'lowpass', 'eq']);

/** van-e a klipen olyan effekt, amit a közös DSP még nem tud (akkor a régi úton szól) */
export function fxUnsupported(fx: AudioFx | undefined): boolean {
  if (!fx) {
    return false;
  }
  return (Object.keys(fx) as (keyof AudioFx)[]).some((k) => {
    const v = fx[k];
    const active = typeof v === 'object' && v !== null ? Object.values(v).some((x) => x) : !!v;
    return active && !SUPPORTED.has(k);
  });
}

/** van-e a klipen bármilyen (támogatott) effekt */
export function fxActive(fx: AudioFx | undefined): boolean {
  return buildFxChain(fx, 44100).length > 0;
}

/**
 * A klip effekt-lánca a szerver sorrendjében (szűrők → EQ). Üres = nincs feldolgozás. A
 * paraméter-szorítás a szerverével azonos.
 */
export function buildFxChain(fx: AudioFx | undefined, sr: number): Biquad[] {
  if (!fx) {
    return [];
  }
  const chain: Biquad[] = [];
  if (fx.highpass && fx.highpass > 0) {
    chain.push(highpass(Math.round(clampN(fx.highpass, 20, 2000)), sr));
  }
  if (fx.lowpass && fx.lowpass > 0) {
    chain.push(lowpass(Math.round(clampN(fx.lowpass, 1000, 20000)), sr));
  }
  if (fx.eq) {
    const g = (v: number | undefined) => clampN(v || 0, -12, 12);
    if (g(fx.eq.low)) chain.push(peaking(100, g(fx.eq.low), sr));
    if (g(fx.eq.mid)) chain.push(peaking(1000, g(fx.eq.mid), sr));
    if (g(fx.eq.high)) chain.push(peaking(8000, g(fx.eq.high), sr));
  }
  return chain;
}

/**
 * Egy klip futó effekt-állapota a darabos keveréshez: a lánc és hogy hol tart. Ugrásnál (a
 * következő minta nem ott van, ahol a lánc abbahagyta) a hívó újraindítja és bejáratja.
 */
export interface FxState {
  chain: Biquad[];
  /** a következő feldolgozandó idővonal-minta */
  next: number;
}

/** a bejáratás hossza (minta): a biquadok ennyi alatt bőven lecsengenek (20 Hz-es HPF ~8 ms) */
export const FX_WARMUP = Math.round(0.2 * 44100);

/** helyben feldolgoz egy sztereó szakaszt a láncon */
export function runChain(chain: Biquad[], l: Float32Array, r: Float32Array): void {
  for (const bq of chain) {
    bq.process(l, 0);
    bq.process(r, 1);
  }
}
