import { compGainDb, KERNEL, runKernel } from '@/lib/dspKernels';
import { coeff, dbToLin, type Processor } from '@/lib/dsp/processor';
import { highpass, lowpass, type Biquad } from '@/lib/dsp/filters';

/** 🗜️ Dinamika: kompresszor, kapu, de-esser, limiter, oldalági halkító, háromsávos kompresszor. */

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
    // 2026-11-14 (V9): az ffmpeg `sidechaincompress` együtthatói — 1 / (ms · sr / 4000), azaz ~ms/4 időállandó
    // (a „350 ms” elengedés ≈ 88 ms); eddig ms-os időállandóval a zene a telefonon lassabban jött vissza, mint a
    // szerveres exportban (mérve: ütések között −35 dB vs −17 dB)
    this.att = Math.min(1, 4000 / (attackMs * sr));
    this.rel = Math.min(1, 4000 / (releaseMs * sr));
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
