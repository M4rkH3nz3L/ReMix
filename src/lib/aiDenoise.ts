/**
 * 🔇 V8 (AUDIO-PROD) — AI-zajszűrés a telefonon (expo-mentes, tiszta mag).
 *
 * A modell: RNNoise v0.2 (xiph, BSD-3) — neurális, 48 kHz, 480 mintás (10 ms) keretek, csatornánként egy
 * állapot; a C-mag a buildben (`RemixRender.rnnoise*`, iOS + Android), a súlyok a gyári katalógusból. Itt a
 * keretezés (kitöltés, hogy a vége is kiürüljön), a modell késésének kiegyenlítése (a kimenet a bemenethez
 * képest `RNNOISE_DELAY` mintával később jön) és az erősség (a száraz és a tisztított jel keverése) — a
 * kiegyenlítés után a keverés fázishelyes (nincs fésűszűrés).
 */
import { StreamResampler } from '@/lib/streamResampler';

export const RNNOISE_SR = 48000;
export const RNNOISE_FRAME = 480;
/** a modell algoritmikus késése mintában: a v0.2 KÉT keretnyit (960) késleltet — iPaden mérve (480-zal 441 minta
 * maradt 44,1 kHz-en = 480 48 kHz-en) */
export const RNNOISE_DELAY = 960;

/** a feldolgozandó keretek száma: a teljes jel + a késés kiürítése, egész keretre kerekítve */
export function denoiseFrames(samples: number, delay = RNNOISE_DELAY): number {
  return Math.ceil((samples + delay) / RNNOISE_FRAME);
}

/** a bemenet kerethatárra kitöltve (nullákkal), hogy a késés utáni vége is kijöjjön */
export function padForDenoise(x: Float32Array, delay = RNNOISE_DELAY): Float32Array {
  const out = new Float32Array(denoiseFrames(x.length, delay) * RNNOISE_FRAME);
  out.set(x);
  return out;
}

/**
 * A tisztított jel visszaigazítva (a késés levágva, a hossz az eredeti) és a száraz jellel keverve:
 * `strength` 1 = teljesen tisztított, 0 = eredeti.
 */
export function alignAndMix(dry: Float32Array, wet: Float32Array, strength: number, delay = RNNOISE_DELAY): Float32Array {
  const s = Math.max(0, Math.min(1, strength));
  const out = new Float32Array(dry.length);
  for (let i = 0; i < dry.length; i++) {
    const w = i + delay < wet.length ? wet[i + delay] : 0;
    out[i] = dry[i] * (1 - s) + w * s;
  }
  return out;
}

/** a késés mérése keresztkorrelációval (a füstteszt ellenőrzi vele a `RNNOISE_DELAY`-t): a legjobb eltolás 0…max */
export function measureDelay(dry: Float32Array, wet: Float32Array, maxLag = 2048): number {
  let best = 0;
  let bestVal = -Infinity;
  const n = Math.min(dry.length, wet.length) - maxLag;
  for (let lag = 0; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += dry[i] * wet[i + lag];
    if (acc > bestVal) {
      bestVal = acc;
      best = lag;
    }
  }
  return best;
}

/** egyszerű, növekvő float-sor (FIFO) */
class Fifo {
  private buf = new Float32Array(1 << 16);
  private start = 0;
  private end = 0;
  get length(): number {
    return this.end - this.start;
  }
  push(x: Float32Array): void {
    if (this.end + x.length > this.buf.length) {
      const live = this.buf.subarray(this.start, this.end);
      const next = new Float32Array(Math.max(this.buf.length, (live.length + x.length) * 2));
      next.set(live);
      this.buf = next;
      this.end = live.length;
      this.start = 0;
    }
    this.buf.set(x, this.end);
    this.end += x.length;
  }
  take(n: number): Float32Array {
    const out = this.buf.slice(this.start, this.start + n);
    this.start += n;
    return out;
  }
  drop(n: number): number {
    const k = Math.min(n, this.length);
    this.start += k;
    return k;
  }
}

/** a folyamatos átmintavételező felülete (JS `StreamResampler` vagy a natív tükre) */
export interface ResamplerLike {
  process(chunk: Float32Array[]): Float32Array[];
  flush(): Float32Array[];
}

/** a modell egy csatornára: `frames` × 480 minta (48 kHz) → ugyanannyi kimenet; vissza: beszéd-valószínűség */
export type DenoiseRun = (channel: number, input: Float32Array, output: Float32Array) => number;


/**
 * Folyamatos (darabonkénti) AI-zajszűrő a projekt mintavételén: 44,1 kHz be → 48 kHz → RNNoise (csatornánként)
 * → késés-levágás + erősség-keverés → 44,1 kHz ki. A memória a darab méretével arányos (órás forrás is mehet).
 */
export class StreamingDenoiser {
  private readonly up: ResamplerLike;
  private readonly down: ResamplerLike;
  private readonly pending: Fifo[];
  private readonly dry: Fifo[];
  private readonly wet: Fifo[];
  private toDrop: number[];
  private vadSum = 0;
  private vadN = 0;
  /** 🧪 időmérés (ms): átmintavételezés fel / le, modell, keverés */
  readonly timings = { up: 0, model: 0, down: 0, mix: 0 };

  constructor(
    private readonly channels: number,
    private readonly strength: number,
    private readonly run: DenoiseRun,
    projectRate = 44100,
    private readonly delay = RNNOISE_DELAY,
    /** az átmintavételező gyára (a telefonon natív — `nativeResampler`; alap: a JS) */
    makeResampler: (inRate: number, outRate: number, channels: number) => ResamplerLike = (a, b, c) => new StreamResampler(a, b, c)
  ) {
    this.up = makeResampler(projectRate, RNNOISE_SR, channels);
    this.down = makeResampler(RNNOISE_SR, projectRate, channels);
    this.pending = Array.from({ length: channels }, () => new Fifo());
    this.dry = Array.from({ length: channels }, () => new Fifo());
    this.wet = Array.from({ length: channels }, () => new Fifo());
    this.toDrop = Array.from({ length: channels }, () => delay);
  }

  /** az átlagos beszéd-valószínűség (a VAD tájékoztató) */
  get vad(): number {
    return this.vadN > 0 ? this.vadSum / this.vadN : 0;
  }

  private feed48(u: Float32Array[], real: boolean): void {
    for (let c = 0; c < this.channels; c++) {
      if (real) this.dry[c].push(u[c]);
      this.pending[c].push(u[c]);
      const frames = Math.floor(this.pending[c].length / RNNOISE_FRAME);
      if (frames === 0) continue;
      const inp = this.pending[c].take(frames * RNNOISE_FRAME);
      const out = new Float32Array(inp.length);
      const tm = Date.now();
      this.vadSum += this.run(c, inp, out);
      this.timings.model += Date.now() - tm;
      this.vadN++;
      // a modell késése: az első `delay` kimeneti minta a bemenet előtti időhöz tartozik → eldobva
      let o = out;
      if (this.toDrop[c] > 0) {
        const k = Math.min(this.toDrop[c], o.length);
        this.toDrop[c] -= k;
        o = o.subarray(k);
      }
      this.wet[c].push(o);
    }
  }

  private drain(): Float32Array[] {
    const t0 = Date.now();
    const n = Math.min(...this.dry.map((f, c) => Math.min(f.length, this.wet[c].length)));
    const s = Math.max(0, Math.min(1, this.strength));
    const mixed = this.dry.map((f, c) => {
      const d = f.take(n);
      const w = this.wet[c].take(n);
      for (let i = 0; i < n; i++) d[i] = d[i] * (1 - s) + w[i] * s;
      return d;
    });
    const t1 = Date.now();
    this.timings.mix += t1 - t0;
    const r = this.down.process(mixed);
    this.timings.down += Date.now() - t1;
    return r;
  }

  /** egy darab (projekt-mintavétel, csatornánként) → a kész kimenet darabja (a késés miatt rövidebb lehet) */
  push(block: Float32Array[]): Float32Array[] {
    const t0 = Date.now();
    const u = this.up.process(block);
    this.timings.up += Date.now() - t0;
    this.feed48(u, true);
    return this.drain();
  }

  /** a vége: a felbontó maradéka, a modell kiürítése (csend a késésnyi időre), a visszabontó maradéka */
  finish(): Float32Array[] {
    this.feed48(this.up.flush(), true);
    const need = this.delay + RNNOISE_FRAME;
    this.feed48(Array.from({ length: this.channels }, () => new Float32Array(need)), false);
    const a = this.drain();
    const b = this.down.flush();
    return a.map((x, c) => {
      const out = new Float32Array(x.length + b[c].length);
      out.set(x);
      out.set(b[c], x.length);
      return out;
    });
  }
}
