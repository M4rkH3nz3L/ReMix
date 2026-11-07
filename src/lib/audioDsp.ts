import type { AudioFx } from '@/types/project';

/**
 * 🎛️ A KÖZÖS hang-DSP (PRO-AUDIO „azt kapod, amit hallasz”): az előnézet és a telefonos export
 * ugyanezt a kódot futtatja (`mixRange`). A szűrők a szerver ffmpeg-láncának (`voicechain.js`
 * `audioFxChain`) matematikáját követik — RBJ-biquad, direkt I. alak, 64 bites állapot —, így a
 * telefon és a szerver kimenete kivonva mérhetően egyezik.
 *
 * A dinamika (kompresszor, kapu, de-esser, limiter) SAJÁT megvalósítás ugyanazokkal a
 * beállításokkal (az ffmpeg C-kódja LGPL — nem portoljuk); az előnézet és a telefonos export
 * mintára azonos, a szerveres export a telefon keverését kapja.
 *
 * Ami itt még nincs, az a `fxUnsupported`-ban jelzett (a klip addig a régi úton szól).
 */

/** egy sztereó feldolgozó lépés (helyben dolgozik; az állapota a darabok között megmarad) */
export interface Processor {
  /** `pos`: az `l[0]` minta helye a klipen belül — a blokkos frissítés rácsa ehhez igazodik,
   * így a darabolás (előnézet 125 ms, export 250 ms) nem hagy nyomot */
  processStereo(l: Float32Array, r: Float32Array, pos: number): void;
}

/** másodrendű IIR szűrő (direkt I. alak, csatornánkénti állapot) */
export class Biquad implements Processor {
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

  processStereo(l: Float32Array, r: Float32Array): void {
    this.process(l, 0);
    this.process(r, 1);
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


const dbToLin = (db: number) => Math.pow(10, db / 20);
/** egypólusú simítás együtthatója `ms` időállandóra */
const coeff = (ms: number, sr: number) => 1 - Math.exp(-1 / ((ms / 1000) * sr));

/**
 * 🗜️ Kompresszor (lefelé): összekapcsolt sztereó, RMS-érzékelés egypólusú felfutás/lecsengés
 * simítással, lágy térd (a küszöb körül `kneeDb` szélesen), a többi a hangerő-arány szerint.
 * A szerver alapbeállítása: −18 dB, 3:1, 5 / 150 ms.
 */
export class Compressor implements Processor {
  private env = 0;
  private readonly att: number;
  private readonly rel: number;

  constructor(
    private readonly thresholdDb: number,
    private readonly ratio: number,
    attackMs: number,
    releaseMs: number,
    sr: number,
    private readonly kneeDb = 9
  ) {
    this.att = coeff(attackMs, sr);
    this.rel = coeff(releaseMs, sr);
  }

  /** a statikus görbe: bemeneti szint (dB) → erősítés (dB) */
  gainDb(levelDb: number): number {
    const over = levelDb - this.thresholdDb;
    const half = this.kneeDb / 2;
    if (over <= -half) return 0;
    if (over >= half) return (1 / this.ratio - 1) * over;
    // lágy térd: négyzetes átmenet
    return ((1 / this.ratio - 1) * (over + half) ** 2) / (2 * this.kneeDb);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    let env = this.env;
    for (let i = 0; i < l.length; i++) {
      const p = (l[i] * l[i] + r[i] * r[i]) / 2;
      env += (p - env) * (p > env ? this.att : this.rel);
      const g = env > 1e-12 ? dbToLin(this.gainDb(10 * Math.log10(env))) : 1;
      l[i] *= g;
      r[i] *= g;
    }
    this.env = env;
  }
}

/**
 * 🚪 Zajkapu (lefelé tágító): a küszöb alatti részt az arány szerint halkítja, legfeljebb a
 * `rangeLin` szintig. A szerver alapbeállítása: küszöb 0,05 (≈ −26 dB), 9:1, 5 / 80 ms, 0,06.
 */
export class Gate implements Processor {
  private env = 0;
  private gain = 1;
  private readonly att: number;
  private readonly rel: number;

  constructor(
    private readonly thresholdLin: number,
    private readonly ratio: number,
    attackMs: number,
    releaseMs: number,
    private readonly rangeLin: number,
    sr: number
  ) {
    this.att = coeff(attackMs, sr);
    this.rel = coeff(releaseMs, sr);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    let env = this.env;
    let gain = this.gain;
    const thrDb = 20 * Math.log10(this.thresholdLin);
    const floorDb = 20 * Math.log10(this.rangeLin);
    for (let i = 0; i < l.length; i++) {
      const p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      env += (p - env) * (p > env ? this.att : this.rel);
      const lev = 20 * Math.log10(env + 1e-12);
      const targetDb = lev >= thrDb ? 0 : Math.max(floorDb, (lev - thrDb) * (this.ratio - 1));
      const target = dbToLin(targetDb);
      // nyitás gyorsan, zárás lassan (nincs kattogás)
      gain += (target - gain) * (target > gain ? this.att : this.rel);
      l[i] *= gain;
      r[i] *= gain;
    }
    this.env = env;
    this.gain = gain;
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
function highShelf(f: number, gainDb: number, sr: number): Biquad {
  return new Biquad(highShelfCoeffs(f, gainDb, sr));
}

/**
 * 🐍 De-esser (dinamikus magas-polc): a sziszegő sáv (5,5 kHz fölött) szintjét a teljes jelhez
 * méri; ha a magas sáv a teljes jel 30%-ánál erősebb (sziszegő mássalhangzó — a magánhangzóké
 * ~1%), egy 6 kHz-es magas-polc annál jobban vág, legfeljebb −12 dB-ig. A polc a klip saját
 * 32 mintás rácsán frissül (a darabolástól független), az állapota folytonos (nincs kattogás).
 */
export class DeEsser implements Processor {
  private readonly detect: Biquad;
  private envHi = 0;
  private envAll = 0;
  private gain = 1;
  private readonly att: number;
  private readonly rel: number;
  private x1 = [0, 0];
  private x2 = [0, 0];
  private y1 = [0, 0];
  private y2 = [0, 0];
  /** a polc aktuális (normált) együtthatói: b0, b1, b2, a1, a2 — kezdetben átengedő */
  private k: [number, number, number, number, number] = [1, 0, 0, 0, 0];

  constructor(private readonly sr: number, private readonly maxCutDb = 12) {
    this.detect = highpass(5500, sr);
    this.att = coeff(2, sr);
    this.rel = coeff(60, sr);
  }

  processStereo(l: Float32Array, r: Float32Array, pos: number): void {
    const hl = Float32Array.from(l);
    const hr = Float32Array.from(r);
    this.detect.processStereo(hl, hr);
    const floor = dbToLin(-this.maxCutDb);
    // az együtthatók CSAK a rácspontokon változnak (a darab eleje nem rácspont)
    let [b0, b1, b2, a1, a2] = this.k;
    const coeffs = () => {
      const c = highShelfCoeffs(6000, 20 * Math.log10(this.gain), this.sr);
      [b0, b1, b2, a1, a2] = this.k = [c.b0 / c.a0, c.b1 / c.a0, c.b2 / c.a0, c.a1 / c.a0, c.a2 / c.a0];
    };
    for (let i = 0; i < l.length; i++) {
      const ph = (hl[i] * hl[i] + hr[i] * hr[i]) / 2;
      const pa = (l[i] * l[i] + r[i] * r[i]) / 2;
      this.envHi += (ph - this.envHi) * (ph > this.envHi ? this.att : this.rel);
      this.envAll += (pa - this.envAll) * (pa > this.envAll ? this.att : this.rel);
      const ratio = this.envAll > 1e-12 ? this.envHi / this.envAll : 0;
      const target = ratio > 0.3 ? Math.max(floor, (0.3 / ratio) ** 2) : 1;
      this.gain += (target - this.gain) * (target < this.gain ? this.att : this.rel);
      // a polc a klip saját 32 mintás rácsán frissül
      if ((pos + i) % 32 === 0) coeffs();
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch === 0 ? l : r;
        const x = buf[i];
        const y = b0 * x + b1 * this.x1[ch] + b2 * this.x2[ch] - a1 * this.y1[ch] - a2 * this.y2[ch];
        this.x2[ch] = this.x1[ch];
        this.x1[ch] = x;
        this.y2[ch] = this.y1[ch];
        this.y1[ch] = y;
        buf[i] = y;
      }
    }
  }
}

/**
 * 🧱 Limiter: kemény plafon (`limit`, lineáris). A csúcsra azonnal reagál (a kimenet SOSEM lépi
 * át), utána simán enged vissza (`releaseMs`). A szerver alapbeállítása: 0,95.
 */
export class Limiter implements Processor {
  private gain = 1;
  private readonly rel: number;

  constructor(private readonly limit: number, releaseMs: number, sr: number) {
    this.rel = coeff(releaseMs, sr);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    let gain = this.gain;
    for (let i = 0; i < l.length; i++) {
      const p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      const need = p * gain > this.limit ? this.limit / p : 1;
      gain = need < gain ? need : gain + (1 - gain) * this.rel;
      if (p * gain > this.limit) gain = this.limit / p;
      l[i] *= gain;
      r[i] *= gain;
    }
    this.gain = gain;
  }
}

/** késleltetési vonal (gyűrűpuffer) — a darabok között folytonos */
class DelayLine {
  private buf: Float32Array;
  private w = 0;
  constructor(maxSamples: number) {
    this.buf = new Float32Array(Math.max(1, maxSamples + 1));
  }
  /** beírja `x`-et, és visszaadja a `d` mintával korábbit */
  push(x: number, d: number): number {
    this.buf[this.w] = x;
    const len = this.buf.length;
    const out = this.buf[(this.w - d + len) % len];
    this.w = (this.w + 1) % len;
    return out;
  }
  /** a `d` mintával korábbi érték (beírás nélkül, a most beírt utánra számolva) */
  tap(d: number): number {
    const len = this.buf.length;
    return this.buf[(this.w - 1 - d + 2 * len) % len];
  }
  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) % this.buf.length;
  }
}

/**
 * 🏛️/🔁 Visszhang (előrecsatolt, több leágazás): kimenet = (be·inGain + Σ késleltetett_be·decayᵢ)·outGain
 * — a szerver `aecho=in:out:késések:csillapítások` beállításaival. A zengés két korai
 * visszaverődés (40 / 75 ms), a delay egy hosszú (120–500 ms).
 */
export class Echo implements Processor {
  private lines: [DelayLine, DelayLine];
  private readonly taps: number[];

  constructor(
    private readonly inGain: number,
    private readonly outGain: number,
    delaysMs: number[],
    private readonly decays: number[],
    sr: number
  ) {
    this.taps = delaysMs.map((ms) => Math.round((ms / 1000) * sr));
    const max = Math.max(...this.taps);
    this.lines = [new DelayLine(max), new DelayLine(max)];
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    const io = [l, r];
    for (let ch = 0; ch < 2; ch++) {
      const buf = io[ch];
      const line = this.lines[ch];
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        line.write(x);
        let y = x * this.inGain;
        for (let k = 0; k < this.taps.length; k++) y += line.tap(this.taps[k]) * this.decays[k];
        buf[i] = y * this.outGain;
      }
    }
  }
}

/**
 * 🎧 Haas-szélesítés: a közép (L+R)/2 jel a bal oldalra 2,05, a jobbra 2,12 ms késéssel kerül —
 * a szerver `haas` alapbeállítása (mono vagy szűk jelből széles sztereó-kép).
 */
export class Haas implements Processor {
  private readonly line: DelayLine;
  private readonly dl: number;
  private readonly dr: number;

  constructor(sr: number, leftMs = 2.05, rightMs = 2.12) {
    this.dl = Math.round((leftMs / 1000) * sr);
    this.dr = Math.round((rightMs / 1000) * sr);
    this.line = new DelayLine(Math.max(this.dl, this.dr));
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    for (let i = 0; i < l.length; i++) {
      this.line.write((l[i] + r[i]) / 2);
      l[i] = this.line.tap(this.dl);
      r[i] = this.line.tap(this.dr);
    }
  }
}

/**
 * 🦆 Automatikus halkítás (oldalági kompresszor): a KULCS (beszéd) RMS-burkolója vezérli a duck-
 * sín erősítését — a szerver `sidechaincompress=threshold=0.02:ratio=6:attack=25:release=350`
 * beállításaival (saját megvalósítás, lágy térddel). A sín és a kulcs külön bemenet.
 */
export class Ducker {
  private env = 0;
  private readonly att: number;
  private readonly rel: number;
  private readonly curve: Compressor;

  constructor(sr: number, thresholdLin = 0.02, ratio = 6, attackMs = 25, releaseMs = 350) {
    this.att = coeff(attackMs, sr);
    this.rel = coeff(releaseMs, sr);
    this.curve = new Compressor(20 * Math.log10(thresholdLin), ratio, attackMs, releaseMs, sr);
  }

  /** a `bus` helyben halkul a `key` szerint */
  process(busL: Float32Array, busR: Float32Array, keyL: Float32Array, keyR: Float32Array): void {
    let env = this.env;
    for (let i = 0; i < busL.length; i++) {
      const p = (keyL[i] * keyL[i] + keyR[i] * keyR[i]) / 2;
      env += (p - env) * (p > env ? this.att : this.rel);
      const g = env > 1e-12 ? dbToLin(this.curve.gainDb(10 * Math.log10(env))) : 1;
      busL[i] *= g;
      busR[i] *= g;
    }
    this.env = env;
  }
}

/** RBJ mély-polc (low-shelf) együtthatók, S = 1 */
function lowShelf(f: number, gainDb: number, sr: number): Biquad {
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

/**
 * 🎚️ Háromsávos kompresszor (a master `multiband`-je): mély (< 250 Hz) · közép (250–4000) ·
 * magas (> 4000), sávonként −18 dB, 2:1, 20 / 250 ms — a szerver `masterGraph`-jának felépítése.
 */
export class Multiband implements Processor {
  private readonly lo: Biquad;
  private readonly midHp: Biquad;
  private readonly midLp: Biquad;
  private readonly hi: Biquad;
  private readonly comps: Compressor[];

  constructor(sr: number) {
    this.lo = lowpass(250, sr);
    this.midHp = highpass(250, sr);
    this.midLp = lowpass(4000, sr);
    this.hi = highpass(4000, sr);
    this.comps = [0, 1, 2].map(() => new Compressor(-18, 2, 20, 250, sr));
  }

  processStereo(l: Float32Array, r: Float32Array, pos: number): void {
    const bands = [0, 1, 2].map(() => [l.slice(), r.slice()] as [Float32Array, Float32Array]);
    this.lo.processStereo(bands[0][0], bands[0][1]);
    this.midHp.processStereo(bands[1][0], bands[1][1]);
    this.midLp.processStereo(bands[1][0], bands[1][1]);
    this.hi.processStereo(bands[2][0], bands[2][1]);
    bands.forEach(([bl, br], k) => this.comps[k].processStereo(bl, br));
    for (let i = 0; i < l.length; i++) {
      l[i] = bands[0][0][i] + bands[1][0][i] + bands[2][0][i];
      r[i] = bands[0][1][i] + bands[1][1][i] + bands[2][1][i];
    }
    void pos;
  }
}

/**
 * 🎛️ A master-lánc a keveréken (a szerver kétmenetes masterének felépítése): EQ (mély polc
 * 110 Hz, közép 1 kHz, magas polc 8 kHz) → (multiband) → a mért erősítés a cél-LUFS-re →
 * csúcsplafon a `truePeak`-re. `gain` nélkül (a mérő előmenet) a hangosság-lépés kimarad.
 */
export function buildMasterChain(
  master: { eq?: { low: number; mid: number; high: number }; multiband?: boolean; truePeak: number },
  sr: number,
  gain?: number
): Processor[] {
  const chain: Processor[] = [];
  if (master.eq?.low) chain.push(lowShelf(110, master.eq.low, sr));
  if (master.eq?.mid) chain.push(peaking(1000, master.eq.mid, sr));
  if (master.eq?.high) chain.push(highShelf(8000, master.eq.high, sr));
  if (master.multiband) chain.push(new Multiband(sr));
  if (gain !== undefined) {
    chain.push(new Gain(gain), new Limiter(dbToLin(master.truePeak), 50, sr));
  }
  return chain;
}

/** állandó erősítés (a normalizálás előre mért erősítése) */
export class Gain implements Processor {
  constructor(private readonly g: number) {}
  processStereo(l: Float32Array, r: Float32Array): void {
    for (let i = 0; i < l.length; i++) {
      l[i] *= this.g;
      r[i] *= this.g;
    }
  }
}

/** a normalizálás célja (a szerver `loudnorm=I=-16:TP=-1.5`-e) */
export const NORMALIZE_LUFS = -16;
export const NORMALIZE_PEAK_DB = -1.5;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** a közös DSP-ben már megvalósított effektek */
const SUPPORTED = new Set<keyof AudioFx>(['highpass', 'lowpass', 'eq', 'gate', 'deEsser', 'compressor', 'limiter', 'reverb', 'delay', 'stereoWide', 'pitchSemitones', 'harmony', 'normalize', 'denoise']);

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
  return buildFxChain(fx, 44100).length > 0 || !!fx?.denoise || !!fx?.pitchSemitones || !!fx?.harmony;
}

/**
 * 🎙️ A Voice Studio egygombos csomagjai a közös DSP elemeiből (a szerver `voicechain.js`
 * tükre): hangjavítás = 75 Hz-es felüláteresztő + zajszűrés + de-esser + kompresszor
 * (−18 dB, 3:1) + −16 LUFS; visszhang-csökkentés = zajszűrés + kapu + −3 dB 300 Hz-en. A klip
 * saját effektjei megmaradnak (a felüláteresztőből a nagyobb érvényes).
 */
export function voiceFx(fx: AudioFx | undefined, enhance: boolean, deReverb: boolean): AudioFx | undefined {
  if (!enhance && !deReverb) {
    return fx;
  }
  const out: AudioFx = { ...(fx ?? {}), denoise: true };
  if (enhance) {
    out.highpass = Math.max(out.highpass ?? 0, 75);
    out.deEsser = true;
    out.compressor = true;
    out.normalize = true;
  }
  return out;
}

/**
 * A klip effekt-lánca a szerver sorrendjében (szűrők → EQ). Üres = nincs feldolgozás. A
 * paraméter-szorítás a szerverével azonos.
 */
export function buildFxChain(fx: AudioFx | undefined, sr: number, normGain = 1, deReverb = false): Processor[] {
  if (!fx && !deReverb) {
    return [];
  }
  fx = fx ?? {};
  const chain: Processor[] = [];
  // 🏚️ visszhang-csökkentés (a szerver `dereverbChain`-je): lágy kapu a lecsengő farokra és a
  // „dobozos” alsó-közép sáv visszavétele (a zajszűrés-része a szakasz-előmenetben fut)
  if (deReverb) {
    chain.push(new Gate(0.02, 2.5, 8, 90, 0.06, sr), peaking(300, -3, sr, 1.2));
  }
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
  // a szerver sorrendje: szűrők → zajszűrés (előmenet: `denoiseStereo`) → kapu → de-esser → kompresszor → … → limiter
  if (fx.gate) chain.push(new Gate(0.05, 9, 5, 80, 0.06, sr));
  if (fx.deEsser) chain.push(new DeEsser(sr));
  if (fx.compressor) chain.push(new Compressor(-18, 3, 5, 150, sr));
  if (fx.reverb && fx.reverb > 0) {
    const dec = Number((0.3 + clampN(fx.reverb, 0, 1) * 0.5).toFixed(2));
    chain.push(new Echo(0.8, 0.9, [40, 75], [dec, Number((dec * 0.7).toFixed(2))], sr));
  }
  if (fx.delay && fx.delay > 0) {
    const a = clampN(fx.delay, 0, 1);
    chain.push(new Echo(0.8, 0.6, [Math.round(120 + a * 380)], [Number((0.2 + a * 0.5).toFixed(2))], sr));
  }
  if (fx.stereoWide) chain.push(new Haas(sr));
  // 📏 normalizálás: az előmenetben mért fix erősítés −16 LUFS-re + csúcsplafon −1,5 dB
  if (fx.normalize) {
    chain.push(new Gain(normGain), new Limiter(dbToLin(NORMALIZE_PEAK_DB), 50, sr));
  }
  if (fx.limiter) chain.push(new Limiter(0.95, 50, sr));
  return chain;
}

/**
 * Egy klip futó effekt-állapota a darabos keveréshez: a lánc és hogy hol tart. Ugrásnál (a
 * következő minta nem ott van, ahol a lánc abbahagyta) a hívó újraindítja és bejáratja.
 */
export interface FxState {
  chain: Processor[];
  /** 🦆 a halkító (a sín állapota) */
  ducker?: Ducker;
  /** a következő feldolgozandó idővonal-minta */
  next: number;
}

/** a bejáratás hossza (minta): a biquadok ~10 ms, a dinamika-burkolók (150 ms lecsengés) ennyi
 * alatt bőven beállnak */
export const FX_WARMUP = Math.round(0.6 * 44100);

/** helyben feldolgoz egy sztereó szakaszt a láncon */
export function runChain(chain: Processor[], l: Float32Array, r: Float32Array, pos = 0): void {
  for (const p of chain) {
    p.processStereo(l, r, pos);
  }
}
