/**
 * 🥁 V8 (AUDIO-PROD) — AI-dob a telefonon: a Magenta „Drums RNN” (drum_kit_rnn, Google Magenta, Apache-2.0)
 * futtatása tiszta JS-ben (expo-mentes mag; Androidon és iOS-en is fut, natív függés nélkül).
 *
 * A modell: 3 réteg LSTM (256), AttentionCellWrapper (32 lépés), kimenet 512 osztály = a 9 dob-osztály
 * bitmaszkja lépésenként (16-od rács), segéd-bemenet: 6 bites bináris számláló (−1/1, LSB elöl). A port a
 * magenta-js `MusicRNN` + `AttentionWrapper` lépéseit követi; egy eltéréssel: a figyelem lekérdezésénél az
 * eredeti TensorFlow-cella (`AttentionCellWrapper._attention`, `_linear(..., bias=True)`) a `attention/bias`
 * tagot is hozzáadja — a magenta-js kihagyja; itt alapból a TF-hű út fut (`attentionBias`), a referencia-
 * összevetéshez kikapcsolható. A súlyok egy fájlban (`RXW1`: fejléc-JSON + float32), a katalógusból letöltve.
 */

export interface DrumRnnVars {
  [name: string]: { data: Float32Array; shape: number[] };
}

/** `RXW1` fájl → változók (a float32 adat másolás nélkül, nézetként) */
export function parseDrumRnnWeights(buf: ArrayBuffer): DrumRnnVars {
  const head = new Uint8Array(buf, 0, 4);
  if (String.fromCharCode(...head) !== 'RXW1') throw new Error('drumRnn: rossz fájl-formátum');
  const len = new DataView(buf).getUint32(4, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as { vars: Record<string, { offset: number; shape: number[] }> };
  const base = 8 + len;
  const all = new Float32Array(buf, base, (buf.byteLength - base) / 4);
  const out: DrumRnnVars = {};
  for (const [name, v] of Object.entries(json.vars)) {
    const n = v.shape.reduce((a, b) => a * b, 1);
    out[name] = { data: all.subarray(v.offset, v.offset + n), shape: v.shape };
  }
  return out;
}

const P = 'rnn/attention_cell_wrapper/';
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** y += x · W (W: [in, out] sorfolytonosan); a nulla bemenetet átugorja (one-hot → ritka) */
function addMatVec(y: Float32Array, x: ArrayLike<number>, W: Float32Array, inN: number, outN: number, xOffset = 0): void {
  for (let i = 0; i < inN; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = (xOffset + i) * outN;
    for (let j = 0; j < outN; j++) y[j] += xi * W[row + j];
  }
}

export interface DrumRnnOptions {
  /** a TF-hű figyelem-bias (alapból igen; a magenta-js-referenciához ki) */
  attentionBias?: boolean;
  attnLength?: number;
  counterBits?: number;
}

export class DrumRnn {
  readonly classes: number;
  readonly hidden: number;
  readonly inputSize: number;
  private readonly layers: { kernel: Float32Array; bias: Float32Array; inN: number }[] = [];
  private readonly v: DrumRnnVars;
  private readonly attnLength: number;
  private readonly bits: number;
  private readonly useAttnBias: boolean;

  constructor(vars: DrumRnnVars, opts: DrumRnnOptions = {}) {
    this.v = vars;
    this.attnLength = opts.attnLength ?? 32;
    this.bits = opts.counterBits ?? 6;
    this.useAttnBias = opts.attentionBias ?? true;
    for (let l = 0; ; l++) {
      const k = vars[`${P}multi_rnn_cell/cell_${l}/basic_lstm_cell/kernel`];
      if (!k) break;
      this.layers.push({ kernel: k.data, bias: vars[`${P}multi_rnn_cell/cell_${l}/basic_lstm_cell/bias`].data, inN: k.shape[0] });
    }
    this.hidden = this.layers[0].bias.length / 4;
    this.classes = vars['fully_connected/biases'].data.length;
    this.inputSize = vars[`${P}bias`].data.length; // a figyelem-bemeneti vetítés kimenete = a cella bemenete
  }

  private get(name: string): Float32Array {
    return this.v[name].data;
  }

  /**
   * A `primer` (lépésenkénti címkék, ≥ 1) folytatása `steps` lépéssel. `temperature` nélkül argmax; a
   * `random` 0–1 közötti álvéletlen (a teszt determinisztikus). Visszaadja az új címkéket és (kérésre)
   * lépésenként a valószínűségeket.
   */
  continue(primer: readonly number[], steps: number, temperature?: number, random: () => number = Math.random, keepProbs = false): { labels: number[]; probs: Float32Array[] } {
    const H = this.hidden;
    const L = this.layers.length;
    const A = this.attnLength;
    const C = this.classes;
    const c = Array.from({ length: L }, () => new Float32Array(H));
    const h = Array.from({ length: L }, () => new Float32Array(H));
    let attention = new Float32Array(H);
    // a figyelem-állapot (a legrégebbi elöl) és a hozzá tartozó, előre szorzott jellemzők (conv2d 1×1 = mátrix)
    const states: Float32Array[] = Array.from({ length: A }, () => new Float32Array(H));
    const feats: Float32Array[] = Array.from({ length: A }, () => new Float32Array(H));
    const Win = this.get(`${P}kernel`);
    const bIn = this.get(`${P}bias`);
    const Wk = this.get(`${P}attention/attn_w`);
    const v = this.get(`${P}attention/attn_v`);
    const Wq = this.get(`${P}attention/kernel`);
    const bq = this.get(`${P}attention/bias`);
    const Wo = this.get(`${P}attention_output_projection/kernel`);
    const bo = this.get(`${P}attention_output_projection/bias`);
    const Wfc = this.get('fully_connected/weights');
    const bfc = this.get('fully_connected/biases');
    const inputLen = C + this.bits;
    const total = primer.length + steps;
    const labels: number[] = [];
    const probs: Float32Array[] = [];
    let last: Float32Array | null = null;
    const x = new Float32Array(inputLen);
    for (let i = 0; i < total; i++) {
      let label: number;
      if (i < primer.length) {
        label = primer[i];
      } else {
        const logits = new Float32Array(C);
        logits.set(bfc);
        addMatVec(logits, last!, Wfc, H, C);
        if (temperature) for (let k = 0; k < C; k++) logits[k] /= temperature;
        let mx = -Infinity;
        for (let k = 0; k < C; k++) mx = Math.max(mx, logits[k]);
        let sum = 0;
        const p = new Float32Array(C);
        for (let k = 0; k < C; k++) sum += p[k] = Math.exp(logits[k] - mx);
        for (let k = 0; k < C; k++) p[k] /= sum;
        if (keepProbs) probs.push(p);
        if (temperature) {
          let r = random();
          label = C - 1;
          for (let k = 0; k < C; k++) {
            r -= p[k];
            if (r <= 0) {
              label = k;
              break;
            }
          }
        } else {
          label = 0;
          for (let k = 1; k < C; k++) if (logits[k] > logits[label]) label = k;
        }
        labels.push(label);
      }
      if (i === total - 1) break;
      // bemenet: one-hot címke + bináris számláló (a (lépés+1) bitjei, −1/1)
      x.fill(0);
      x[label] = 1;
      for (let b = 0; b < this.bits; b++) x[C + b] = Math.floor((i + 1) / 2 ** b) % 2 ? 1 : -1;
      // 1) figyelem-bemeneti vetítés: [x, attention] · Win + b
      const rnnIn = new Float32Array(this.inputSize);
      rnnIn.set(bIn);
      addMatVec(rnnIn, x, Win, inputLen, this.inputSize, 0);
      addMatVec(rnnIn, attention, Win, H, this.inputSize, inputLen);
      // 2) a többrétegű LSTM (BasicLSTMCell: kapuk i, j, f, o; forget-bias 1)
      let input: Float32Array = rnnIn;
      for (let l = 0; l < L; l++) {
        const { kernel, bias, inN } = this.layers[l];
        const g = new Float32Array(4 * H);
        g.set(bias);
        addMatVec(g, input, kernel, inN - H, 4 * H, 0);
        addMatVec(g, h[l], kernel, H, 4 * H, inN - H);
        const cl = c[l];
        const hl = h[l];
        for (let k = 0; k < H; k++) {
          cl[k] = cl[k] * sigmoid(g[2 * H + k] + 1) + sigmoid(g[k]) * Math.tanh(g[H + k]);
          hl[k] = Math.tanh(cl[k]) * sigmoid(g[3 * H + k]);
        }
        input = hl;
      }
      // 3) figyelem: lekérdezés = [c0, h0, c1, h1, …] · Wq (+ bq a TF-hű úton)
      const y = new Float32Array(H);
      if (this.useAttnBias) y.set(bq);
      for (let l = 0; l < L; l++) {
        addMatVec(y, c[l], Wq, H, H, 2 * l * H);
        addMatVec(y, h[l], Wq, H, H, (2 * l + 1) * H);
      }
      const s = new Float32Array(A);
      let smax = -Infinity;
      for (let t = 0; t < A; t++) {
        let acc = 0;
        const f = feats[t];
        for (let k = 0; k < H; k++) acc += v[k] * Math.tanh(f[k] + y[k]);
        s[t] = acc;
        smax = Math.max(smax, acc);
      }
      let ssum = 0;
      for (let t = 0; t < A; t++) ssum += s[t] = Math.exp(s[t] - smax);
      const newAttn = new Float32Array(H);
      for (let t = 0; t < A; t++) {
        const a = s[t] / ssum;
        const st = states[t];
        for (let k = 0; k < H; k++) newAttn[k] += a * st[k];
      }
      // 4) kimenet: [h_utolsó, új figyelem] · Wo + bo
      const out = new Float32Array(H);
      out.set(bo);
      addMatVec(out, h[L - 1], Wo, H, H, 0);
      addMatVec(out, newAttn, Wo, H, H, H);
      // 5) a figyelem-állapot léptetése (a legrégebbi ki, a kimenet be) + a jellemzője
      const oldS = states.shift()!;
      const oldF = feats.shift()!;
      oldS.set(out);
      oldF.fill(0);
      addMatVec(oldF, out, Wk, H, H);
      states.push(oldS);
      feats.push(oldF);
      attention = newAttn;
      last = out;
    }
    return { labels, probs };
  }
}

// ── kódolás: a Magenta 9 dob-osztálya ↔ a ReMix dobgép 8 hangja ─────────────────────────────────────────────
/** a Magenta-osztályok: lábdob, pergő, zárt hi-hat, nyitott hi-hat, mély / közép / magas tam, crash, ride */
export const MAGENTA_CLASSES = 9;
export type DrumVoiceName = 'kick' | 'snare' | 'hihat' | 'clap' | 'tom' | 'rim' | 'crash' | 'perc';

/** a ReMix-hang → Magenta-osztály (a primerhez) */
export const VOICE_TO_CLASS: Record<DrumVoiceName, number> = { kick: 0, snare: 1, clap: 1, rim: 1, hihat: 2, tom: 5, crash: 7, perc: 8 };

/** Magenta-osztály → ReMix-hang (+ hangsúly: a nyitott hi-hat hangsúlyos hi-hat) */
export const CLASS_TO_VOICE: readonly { voice: DrumVoiceName; accent?: boolean }[] = [
  { voice: 'kick' },
  { voice: 'snare' },
  { voice: 'hihat' },
  { voice: 'hihat', accent: true },
  { voice: 'tom' },
  { voice: 'tom' },
  { voice: 'tom' },
  { voice: 'crash' },
  { voice: 'perc' },
];

/** a dobgép mintája (hangonként a lépések) → lépésenkénti címkék (bitmaszk) */
export function patternToLabels(pattern: Partial<Record<DrumVoiceName, readonly boolean[]>>, steps: number): number[] {
  const out = new Array<number>(steps).fill(0);
  for (const [voice, row] of Object.entries(pattern) as [DrumVoiceName, readonly boolean[]][]) {
    const cls = VOICE_TO_CLASS[voice];
    if (cls === undefined || !row) continue;
    for (let s = 0; s < Math.min(steps, row.length); s++) if (row[s]) out[s] |= 1 << cls;
  }
  return out;
}

/** lépésenkénti címkék → hangonkénti lépés-sorok + a hangsúlyos lépések */
export function labelsToPattern(labels: readonly number[]): { pattern: Record<DrumVoiceName, boolean[]>; accents: Partial<Record<DrumVoiceName, number[]>> } {
  const voices: DrumVoiceName[] = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'crash', 'perc'];
  const pattern = Object.fromEntries(voices.map((v) => [v, new Array<boolean>(labels.length).fill(false)])) as Record<DrumVoiceName, boolean[]>;
  const accents: Partial<Record<DrumVoiceName, number[]>> = {};
  labels.forEach((lab, s) => {
    for (let c = 0; c < MAGENTA_CLASSES; c++) {
      if (!(lab & (1 << c))) continue;
      const { voice, accent } = CLASS_TO_VOICE[c];
      pattern[voice][s] = true;
      if (accent) (accents[voice] = accents[voice] ?? []).push(s);
    }
  });
  return { pattern, accents };
}

/** determinisztikus álvéletlen (mulberry32) — a teszthez és a megismételhető „variációhoz” */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
