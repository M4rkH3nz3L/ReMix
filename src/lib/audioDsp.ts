import { sampleChannel } from '@/lib/keyframes';
import { fxStageOrder, type FxStage } from '@/lib/fxOrder';
import type { AudioFx, Keyframe } from '@/types/project';
import { compGainDb, KERNEL, runKernel } from '@/lib/dspKernels';

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

type Coeffs = { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number };

function highpassCoeffs(f: number, sr: number, q = 0.707): Coeffs {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return { b0: (1 + cos) / 2, b1: -(1 + cos), b2: (1 + cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
}

function lowpassCoeffs(f: number, sr: number, q = 0.707): Coeffs {
  const w = omega(f, sr);
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return { b0: (1 - cos) / 2, b1: 1 - cos, b2: (1 - cos) / 2, a0: 1 + alpha, a1: -2 * cos, a2: 1 - alpha };
}

function peakingCoeffs(f: number, gainDb: number, sr: number, q = 1): Coeffs {
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

/** az automáció rácsa (minta): a klip saját idejéhez igazítva — a darabolás nem hagy nyomot */
const AUTO_BLOCK = 64;

/**
 * 🎛️ Automatizált szűrő: a paraméter (frekvencia vagy erősítés) a kulcskocka-görbéből, 64
 * mintánként frissül (a klip saját rácsán); az állapot folytonos — nincs kattogás.
 */
export class AutoBiquad implements Processor {
  private readonly bq: Biquad;
  private last = Number.NaN;

  constructor(
    private readonly design: (v: number) => Coeffs,
    private readonly kfs: Keyframe[],
    private readonly fallback: number,
    private readonly sr: number
  ) {
    this.bq = new Biquad(design(fallback));
  }

  processStereo(l: Float32Array, r: Float32Array, pos: number): void {
    let i = 0;
    while (i < l.length) {
      const at = pos + i;
      const next = Math.min(l.length, i + (AUTO_BLOCK - (at % AUTO_BLOCK)));
      // az érték a RÁCSPONTBÓL (nem a darab kezdetéből) — így a darabolás nem hagy nyomot
      const v = sampleChannel(this.kfs, (at - (at % AUTO_BLOCK)) / this.sr, this.fallback);
      if (v !== this.last) {
        this.bq.setCoeffs(this.design(v));
        this.last = v;
      }
      this.bq.processStereo(l.subarray(i, next), r.subarray(i, next));
      i = next;
    }
  }
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
  private readonly att: number;
  private readonly rel: number;
  /** küszöb arány felfutás lecsengés térd */
  private readonly p: Float64Array;
  /** env */
  private readonly st = new Float64Array(1);

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
    this.p = Float64Array.of(thresholdDb, ratio, this.att, this.rel, kneeDb);
  }

  /** a statikus görbe: bemeneti szint (dB) → erősítés (dB) — lágy térd: négyzetes átmenet */
  gainDb(levelDb: number): number {
    return compGainDb(levelDb, this.thresholdDb, this.ratio, this.kneeDb);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.COMP, l, r, this.p, this.st);
  }
}

/**
 * 🚪 Zajkapu (lefelé tágító): a küszöb alatti részt az arány szerint halkítja, legfeljebb a
 * `rangeLin` szintig. A szerver alapbeállítása: küszöb 0,05 (≈ −26 dB), 9:1, 5 / 80 ms, 0,06.
 */
export class Gate implements Processor {
  private readonly att: number;
  private readonly rel: number;
  /** küszöb (dB) padló (dB) arány felfutás lecsengés */
  private readonly p: Float64Array;
  /** env gain */
  private readonly st = Float64Array.of(0, 1);

  constructor(
    thresholdLin: number,
    ratio: number,
    attackMs: number,
    releaseMs: number,
    rangeLin: number,
    sr: number
  ) {
    this.att = coeff(attackMs, sr);
    this.rel = coeff(releaseMs, sr);
    this.p = Float64Array.of(20 * Math.log10(thresholdLin), 20 * Math.log10(rangeLin), ratio, this.att, this.rel);
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.GATE, l, r, this.p, this.st);
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
  /** padló felfutás lecsengés sr pos · a detektor (5500 Hz-es felüláteresztő) együtthatói */
  private readonly p: Float64Array;
  /** envHi envAll gain · a polc együtthatói (kezdetben átengedő) · a polc és a detektor állapota */
  private readonly st = new Float64Array(24);

  constructor(sr: number, maxCutDb = 12) {
    const detect = highpass(5500, sr).coeffs();
    this.p = Float64Array.of(dbToLin(-maxCutDb), coeff(2, sr), coeff(60, sr), sr, 0, detect[0], detect[1], detect[2], detect[3], detect[4]);
    this.st[2] = 1;
    this.st[3] = 1;
  }

  processStereo(l: Float32Array, r: Float32Array, pos: number): void {
    // a polc a klip saját 32 mintás rácsán frissül (a darab eleje nem rácspont)
    this.p[4] = pos;
    runKernel(KERNEL.DEESS, l, r, this.p, this.st);
  }
}

/**
 * 🧱 Limiter: kemény plafon (`limit`, lineáris). A csúcsra azonnal reagál (a kimenet SOSEM lépi
 * át), utána simán enged vissza (`releaseMs`). A szerver alapbeállítása: 0,95.
 */
export class Limiter implements Processor {
  /** plafon lecsengés */
  private readonly p: Float64Array;
  /** gain */
  private readonly st = Float64Array.of(1);

  constructor(limit: number, releaseMs: number, sr: number) {
    this.p = Float64Array.of(limit, coeff(releaseMs, sr));
  }

  processStereo(l: Float32Array, r: Float32Array): void {
    runKernel(KERNEL.LIMIT, l, r, this.p, this.st);
  }
}

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
const SUPPORTED = new Set<keyof AudioFx>(['order', 'highpass', 'lowpass', 'eq', 'gate', 'deEsser', 'compressor', 'limiter', 'reverb', 'delay', 'stereoWide', 'pitchSemitones', 'harmony', 'normalize', 'denoise']);

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
/** 🎛️ a klip effekt-automációs görbéi */
export interface FxAutomation {
  fxLowpass?: Keyframe[];
  fxHighpass?: Keyframe[];
  fxReverb?: Keyframe[];
  fxDelay?: Keyframe[];
  fxEqLow?: Keyframe[];
  fxEqMid?: Keyframe[];
  fxEqHigh?: Keyframe[];
}

export const FX_AUTO_KEYS = ['fxLowpass', 'fxHighpass', 'fxReverb', 'fxDelay', 'fxEqLow', 'fxEqMid', 'fxEqHigh'] as const;

export function buildFxChain(fx: AudioFx | undefined, sr: number, normGain = 1, deReverb = false, auto?: FxAutomation): Processor[] {
  const has = (k: keyof FxAutomation) => (auto?.[k]?.length ?? 0) > 0;
  if (!fx && !deReverb && !FX_AUTO_KEYS.some(has)) {
    return [];
  }
  fx = fx ?? {};
  const chain: Processor[] = [];
  // 🏚️ visszhang-csökkentés (a szerver `dereverbChain`-je): lágy kapu a lecsengő farokra és a
  // „dobozos” alsó-közép sáv visszavétele (a zajszűrés-része a szakasz-előmenetben fut)
  if (deReverb) {
    chain.push(new Gate(0.02, 2.5, 8, 90, 0.06, sr), peaking(300, -3, sr, 1.2));
  }
  // 🎛️ automatizált paraméternél a görbe szól (a statikus érték az alap); a szorítás a statikussal azonos
  const f = fx;
  const hpF = (v: number) => clampN(v, 20, 2000);
  const lpF = (v: number) => clampN(v, 1000, 20000);
  const g = (v: number | undefined) => clampN(v || 0, -12, 12);
  const band = (key: 'fxEqLow' | 'fxEqMid' | 'fxEqHigh', freq: number, base: number | undefined) => {
    if (has(key)) {
      chain.push(new AutoBiquad((v) => peakingCoeffs(freq, g(v), sr), auto![key]!, g(base), sr));
    } else if (g(base)) {
      chain.push(peaking(freq, g(base), sr));
    }
  };
  const reverbDecays = (amount: number) => {
    // a mérték 0-nál a zengés elhal (a 0,3-as alap is lehalkul) — a görbe 0-ja tényleg száraz
    const a = clampN(amount, 0, 1);
    const dec = a > 0 ? Number((0.3 + a * 0.5).toFixed(2)) : 0;
    return [dec, Number((dec * 0.7).toFixed(2))];
  };
  // 🔀 a mozgatható fokozatok a klip sorrendjében (`fxOrder.ts`; a szerver ugyanezt követi). Az alap
  // sorrend a szerveré: szűrők → EQ → (zajszűrés: előmenet) → kapu → de-esser → kompresszor → zengés →
  // visszhang → szélesítés; utána mindig a normalizálás és a limiter
  const stages: Record<FxStage, () => void> = {
    filters: () => {
      if (has('fxHighpass')) {
        chain.push(new AutoBiquad((v) => highpassCoeffs(hpF(v), sr), auto!.fxHighpass!, f.highpass || 20, sr));
      } else if (f.highpass && f.highpass > 0) {
        chain.push(highpass(Math.round(hpF(f.highpass)), sr));
      }
      if (has('fxLowpass')) {
        chain.push(new AutoBiquad((v) => lowpassCoeffs(lpF(v), sr), auto!.fxLowpass!, f.lowpass || 20000, sr));
      } else if (f.lowpass && f.lowpass > 0) {
        chain.push(lowpass(Math.round(lpF(f.lowpass)), sr));
      }
    },
    eq: () => {
      band('fxEqLow', 100, f.eq?.low);
      band('fxEqMid', 1000, f.eq?.mid);
      band('fxEqHigh', 8000, f.eq?.high);
    },
    gate: () => {
      if (f.gate) chain.push(new Gate(0.05, 9, 5, 80, 0.06, sr));
    },
    deEsser: () => {
      if (f.deEsser) chain.push(new DeEsser(sr));
    },
    compressor: () => {
      if (f.compressor) chain.push(new Compressor(-18, 3, 5, 150, sr));
    },
    reverb: () => {
      if ((f.reverb && f.reverb > 0) || has('fxReverb')) {
        const e = new Echo(0.8, 0.9, [40, 75], reverbDecays(f.reverb ?? 0), sr);
        if (has('fxReverb')) e.auto = { kfs: auto!.fxReverb!, fallback: f.reverb ?? 0, decaysOf: reverbDecays, sr };
        chain.push(e);
      }
    },
    delay: () => {
      if ((f.delay && f.delay > 0) || has('fxDelay')) {
        // a delay ideje a statikus mértékből (a késleltetési vonal hossza nem automatizálható kattogás nélkül)
        const a = clampN(f.delay ?? 0.5, 0, 1);
        const delayDecay = (amount: number) => [clampN(amount, 0, 1) > 0 ? Number((0.2 + clampN(amount, 0, 1) * 0.5).toFixed(2)) : 0];
        const e = new Echo(0.8, 0.6, [Math.round(120 + a * 380)], delayDecay(f.delay ?? 0), sr);
        if (has('fxDelay')) e.auto = { kfs: auto!.fxDelay!, fallback: f.delay ?? 0, decaysOf: delayDecay, sr };
        chain.push(e);
      }
    },
    stereoWide: () => {
      if (f.stereoWide) chain.push(new Haas(sr));
    },
  };
  for (const stage of fxStageOrder(f.order)) stages[stage]();
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
