/**
 * 🎚️ Folyamatos (darabolás-független) átmintavételező — pure, expo-mentes (AUDIO-PROD: a telefonos WAV-export
 * 48 kHz-en is). Ablakozott sinc (Blackman), racionális arány fázistáblával: 44,1 → 48 kHz-nél a pozíciók 160
 * kimeneti mintánként ismétlődnek, így minden fázis súlyai előre számoltak (a mintánkénti trigonometria nélkül).
 * Lefelé (pl. 48 → 44,1) a vágási frekvencia a kimeneti Nyquist (anti-aliasing). A kimenet hossza pontosan
 * `round(bemenet · out / in)` minta, a darabolástól függetlenül bitre azonos.
 */

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export class StreamResampler {
  readonly up: number;
  readonly down: number;
  private readonly half: number;
  private readonly table: Float32Array[];
  /** a pufferben lévő bemenet (csatornánként) és az első minta globális indexe */
  private buf: Float32Array[];
  private bufStart = 0;
  private bufLen = 0;
  /** a következő kimeneti minta indexe */
  private outIndex = 0;
  private inTotal = 0;

  constructor(
    inRate: number,
    outRate: number,
    private readonly channels: number,
    halfTaps?: number
  ) {
    const g = gcd(inRate, outRate);
    this.up = outRate / g; // ennyi fázis
    this.down = inRate / g; // bemeneti lépés fázisonként
    // lefelé az átlapolódás ellen hosszabb szűrő és lejjebb vágás (a kimeneti Nyquist 90 %-a)
    const downsampling = outRate < inRate;
    halfTaps = halfTaps ?? (downsampling ? 48 : 16);
    this.half = halfTaps;
    const cutoff = downsampling ? (outRate / inRate) * 0.9 : 0.97;
    this.table = [];
    for (let p = 0; p < this.up; p++) {
      const frac = (p * this.down) / this.up - Math.floor((p * this.down) / this.up);
      const w = new Float32Array(2 * halfTaps);
      let sum = 0;
      for (let k = 0; k < 2 * halfTaps; k++) {
        const x = k - (halfTaps - 1) - frac; // a minta távolsága a kimeneti pozíciótól
        const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
        const n = (x + halfTaps) / (2 * halfTaps); // 0…1 az ablakban
        const blackman = 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
        w[k] = s * Math.max(0, blackman);
        sum += w[k];
      }
      for (let k = 0; k < w.length; k++) w[k] /= sum; // egységnyi DC-erősítés
      this.table.push(w);
    }
    this.buf = Array.from({ length: channels }, () => new Float32Array(4096));
  }

  /** a kimeneti hossz egy adott bemeneti hosszhoz */
  static outFrames(inFrames: number, inRate: number, outRate: number): number {
    return Math.round((inFrames * outRate) / inRate);
  }

  private append(chunk: Float32Array[]): void {
    const n = chunk[0]?.length ?? 0;
    if (this.bufLen + n > this.buf[0].length) {
      const size = Math.max(this.buf[0].length * 2, this.bufLen + n);
      this.buf = this.buf.map((b) => {
        const nb = new Float32Array(size);
        nb.set(b.subarray(0, this.bufLen));
        return nb;
      });
    }
    for (let c = 0; c < this.channels; c++) this.buf[c].set(chunk[c] ?? chunk[0], this.bufLen);
    this.bufLen += n;
    this.inTotal += n;
  }

  /** annyi kimenet, amennyi a meglévő bemenetből (a jobb oldali ablakkal együtt) kiszámolható */
  private drain(limitOut: number, final: boolean): Float32Array[] {
    const out: number[][] = Array.from({ length: this.channels }, () => []);
    for (;;) {
      if (this.outIndex >= limitOut) break;
      const posNum = this.outIndex * this.down; // a bemeneti pozíció × up
      const base = Math.floor(posNum / this.up);
      const phase = this.outIndex % this.up;
      const first = base - (this.half - 1);
      const last = base + this.half;
      if (!final && last >= this.bufStart + this.bufLen) break;
      const w = this.table[phase];
      for (let c = 0; c < this.channels; c++) {
        const b = this.buf[c];
        let acc = 0;
        for (let k = 0; k < w.length; k++) {
          const idx = first + k - this.bufStart;
          if (idx >= 0 && idx < this.bufLen) acc += b[idx] * w[k];
        }
        out[c].push(acc);
      }
      this.outIndex++;
    }
    // a már nem kellő bemenet eldobása (a következő kimenet ablakának bal széléig)
    const keepFrom = Math.floor((this.outIndex * this.down) / this.up) - (this.half - 1);
    const drop = Math.max(0, Math.min(this.bufLen, keepFrom - this.bufStart));
    if (drop > 0) {
      for (const b of this.buf) b.copyWithin(0, drop, this.bufLen);
      this.bufStart += drop;
      this.bufLen -= drop;
    }
    return out.map((a) => Float32Array.from(a));
  }

  /** egy darab bemenet → a most kiszámolható kimenet */
  process(chunk: Float32Array[]): Float32Array[] {
    this.append(chunk);
    return this.drain(Number.MAX_SAFE_INTEGER, false);
  }

  /** a bemenet vége: a maradék kimenet a pontos hosszig (a jobb széle csenddel kiegészítve) */
  flush(): Float32Array[] {
    const total = Math.round((this.inTotal * this.up) / this.down);
    return this.drain(total, true);
  }
}

/** egy teljes (nem folyamatos) darab átmintavételezése: process + flush, a pontos hosszal */
export function resampleChannels(channels: Float32Array[], inRate: number, outRate: number): Float32Array[] {
  if (inRate === outRate || channels.length === 0) return channels;
  const r = new StreamResampler(inRate, outRate, channels.length);
  const a = r.process(channels);
  const b = r.flush();
  return a.map((x, c) => {
    const out = new Float32Array(x.length + b[c].length);
    out.set(x);
    out.set(b[c], x.length);
    return out;
  });
}

