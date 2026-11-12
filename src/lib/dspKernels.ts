/**
 * ⚡ A közös hang-DSP forró ciklusai (AP9 / natív DSP) — állapot nélküli magok. Az állapot a hívó
 * `Float64Array`-jében él (a darabok között folytonos), a késleltetési vonal egy `Float32Array`.
 *
 * Ugyanez a mag natívan is megvan (`RemixRender.dspRun`, Swift/Kotlin, azonos aritmetikával és
 * sorrenddel): a telefonon az előnézet ÉS a telefonos export a natívat használja (a JIT nélküli
 * Hermesben a teljes lánc 3 sávon nem fért bele a valós időbe), a teszt, a web és a szerver-paritás
 * ezt a JS-változatot. A JS-változat bitre a korábbi `audioDsp.ts`-ciklusokkal azonos.
 *
 * Expo-mentes: a natív függvényt az app regisztrálja (`setNativeDsp`).
 */

export const KERNEL = { BIQUAD: 0, COMP: 1, GATE: 2, LIMIT: 3, SAT: 4, HAAS: 5, ECHO: 6, DEESS: 7 } as const;
export type KernelKind = (typeof KERNEL)[keyof typeof KERNEL];

export type DspRun = (kind: number, l: Float32Array, r: Float32Array, p: Float64Array, st: Float64Array, aux: Float32Array | null) => void;

let native: DspRun | null = null;

/** a natív mag bekötése (az app indulásakor); null = a JS-változat */
export function setNativeDsp(fn: DspRun | null): void {
  native = fn;
}

/** a natív mag fut-e */
export const nativeDspActive = (): boolean => native !== null;

const dbToLin = (db: number) => Math.pow(10, db / 20);

/** a kompresszor statikus görbéje (a `Compressor.gainDb` és a natív mag közös képlete) */
export function compGainDb(levelDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const over = levelDb - thresholdDb;
  const half = kneeDb / 2;
  if (over <= -half) return 0;
  if (over >= half) return (1 / ratio - 1) * over;
  return ((1 / ratio - 1) * (over + half) ** 2) / (2 * kneeDb);
}

/** RBJ magas-polc normált együtthatói (b0, b1, b2, a1, a2), S = 1 */
export function highShelfNorm(f: number, gainDb: number, sr: number): [number, number, number, number, number] {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * f) / sr;
  const cos = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const sq = 2 * Math.sqrt(A) * alpha;
  const b0 = A * (A + 1 + (A - 1) * cos + sq);
  const b1 = -2 * A * (A - 1 + (A + 1) * cos);
  const b2 = A * (A + 1 + (A - 1) * cos - sq);
  const a0 = A + 1 - (A - 1) * cos + sq;
  const a1 = 2 * (A - 1 - (A + 1) * cos);
  const a2 = A + 1 - (A - 1) * cos - sq;
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function biquadCh(buf: Float32Array, p: Float64Array, st: Float64Array, o: number): void {
  let x1 = st[o];
  let x2 = st[o + 1];
  let y1 = st[o + 2];
  let y2 = st[o + 3];
  const b0 = p[0];
  const b1 = p[1];
  const b2 = p[2];
  const a1 = p[3];
  const a2 = p[4];
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
  st[o] = x1;
  st[o + 1] = x2;
  st[o + 2] = y1;
  st[o + 3] = y2;
}

const JS: Record<number, (l: Float32Array, r: Float32Array, p: Float64Array, st: Float64Array, aux: Float32Array | null) => void> = {
  // p: b0 b1 b2 a1 a2 · st: x1 x2 y1 y2 (bal), x1 x2 y1 y2 (jobb)
  [KERNEL.BIQUAD]: (l, r, p, st) => {
    biquadCh(l, p, st, 0);
    biquadCh(r, p, st, 4);
  },
  // p: küszöb (dB) arány felfutás lecsengés térd · st: env
  [KERNEL.COMP]: (l, r, p, st) => {
    let env = st[0];
    const att = p[2];
    const rel = p[3];
    for (let i = 0; i < l.length; i++) {
      const pw = (l[i] * l[i] + r[i] * r[i]) / 2;
      env += (pw - env) * (pw > env ? att : rel);
      const g = env > 1e-12 ? dbToLin(compGainDb(10 * Math.log10(env), p[0], p[1], p[4])) : 1;
      l[i] *= g;
      r[i] *= g;
    }
    st[0] = env;
  },
  // p: küszöb (dB) padló (dB) arány felfutás lecsengés · st: env gain
  [KERNEL.GATE]: (l, r, p, st) => {
    let env = st[0];
    let gain = st[1];
    const thrDb = p[0];
    const floorDb = p[1];
    const ratio = p[2];
    const att = p[3];
    const rel = p[4];
    for (let i = 0; i < l.length; i++) {
      const pk = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      env += (pk - env) * (pk > env ? att : rel);
      const lev = 20 * Math.log10(env + 1e-12);
      const targetDb = lev >= thrDb ? 0 : Math.max(floorDb, (lev - thrDb) * (ratio - 1));
      const target = dbToLin(targetDb);
      gain += (target - gain) * (target > gain ? att : rel);
      l[i] *= gain;
      r[i] *= gain;
    }
    st[0] = env;
    st[1] = gain;
  },
  // p: plafon lecsengés · st: gain
  [KERNEL.LIMIT]: (l, r, p, st) => {
    let gain = st[0];
    const limit = p[0];
    const rel = p[1];
    for (let i = 0; i < l.length; i++) {
      const pk = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      const need = pk * gain > limit ? limit / pk : 1;
      gain = need < gain ? need : gain + (1 - gain) * rel;
      if (pk * gain > limit) gain = limit / pk;
      l[i] *= gain;
      r[i] *= gain;
    }
    st[0] = gain;
  },
  // p: k norm
  [KERNEL.SAT]: (l, r, p) => {
    const k = p[0];
    const norm = p[1];
    for (let i = 0; i < l.length; i++) {
      l[i] = Math.tanh(k * l[i]) * norm;
      r[i] = Math.tanh(k * r[i]) * norm;
    }
  },
  // p: bal késés jobb késés (minta) · st: írófej · aux: a vonal
  [KERNEL.HAAS]: (l, r, p, st, aux) => {
    const line = aux!;
    const len = line.length;
    let w = st[0];
    const dl = p[0];
    const dr = p[1];
    for (let i = 0; i < l.length; i++) {
      line[w] = (l[i] + r[i]) / 2;
      w = (w + 1) % len;
      l[i] = line[(w - 1 - dl + 2 * len) % len];
      r[i] = line[(w - 1 - dr + 2 * len) % len];
    }
    st[0] = w;
  },
  // p: be-erősítés ki-erősítés n · késések[n] · csillapítások[n] · st: írófej (bal), írófej (jobb) · aux: bal vonal + jobb vonal
  [KERNEL.ECHO]: (l, r, p, st, aux) => {
    const all = aux!;
    const len = all.length / 2;
    const n = p[2];
    for (let ch = 0; ch < 2; ch++) {
      const buf = ch === 0 ? l : r;
      const base = ch * len;
      let w = st[ch];
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        all[base + w] = x;
        w = (w + 1) % len;
        let y = x * p[0];
        for (let k = 0; k < n; k++) y += all[base + ((w - 1 - p[3 + k] + 2 * len) % len)] * p[3 + n + k];
        buf[i] = y * p[1];
      }
      st[ch] = w;
    }
  },
  // p: padló felfutás lecsengés sr pos · detektor b0 b1 b2 a1 a2 (5–9)
  // st: envHi envAll gain · polc k0..k4 (3–7) · polc x1 x2 y1 y2 (bal 8–11, jobb 12–15) · detektor (16–23)
  [KERNEL.DEESS]: (l, r, p, st) => {
    const n = l.length;
    const hl = Float32Array.from(l);
    const hr = Float32Array.from(r);
    biquadCh(hl, p.subarray(5, 10), st, 16);
    biquadCh(hr, p.subarray(5, 10), st, 20);
    const floor = p[0];
    const att = p[1];
    const rel = p[2];
    const sr = p[3];
    const pos = p[4];
    let envHi = st[0];
    let envAll = st[1];
    let gain = st[2];
    let b0 = st[3];
    let b1 = st[4];
    let b2 = st[5];
    let a1 = st[6];
    let a2 = st[7];
    for (let i = 0; i < n; i++) {
      const ph = (hl[i] * hl[i] + hr[i] * hr[i]) / 2;
      const pa = (l[i] * l[i] + r[i] * r[i]) / 2;
      envHi += (ph - envHi) * (ph > envHi ? att : rel);
      envAll += (pa - envAll) * (pa > envAll ? att : rel);
      const ratio = envAll > 1e-12 ? envHi / envAll : 0;
      const target = ratio > 0.3 ? Math.max(floor, (0.3 / ratio) ** 2) : 1;
      gain += (target - gain) * (target < gain ? att : rel);
      if ((pos + i) % 32 === 0) {
        [b0, b1, b2, a1, a2] = highShelfNorm(6000, 20 * Math.log10(gain), sr);
      }
      for (let ch = 0; ch < 2; ch++) {
        const buf = ch === 0 ? l : r;
        const o = ch === 0 ? 8 : 12;
        const x = buf[i];
        const y = b0 * x + b1 * st[o] + b2 * st[o + 1] - a1 * st[o + 2] - a2 * st[o + 3];
        st[o + 1] = st[o];
        st[o] = x;
        st[o + 3] = st[o + 2];
        st[o + 2] = y;
        buf[i] = y;
      }
    }
    st[0] = envHi;
    st[1] = envAll;
    st[2] = gain;
    st[3] = b0;
    st[4] = b1;
    st[5] = b2;
    st[6] = a1;
    st[7] = a2;
  },
};

/** egy mag futtatása helyben (natívan, ha be van kötve) */
export function runKernel(kind: KernelKind, l: Float32Array, r: Float32Array, p: Float64Array, st: Float64Array, aux: Float32Array | null = null): void {
  if (l.length === 0) return;
  // ugyanaz a tömb mindkét csatornán: a JS a sorrendi viselkedést adja (a natív mag külön másolatokon dolgozna)
  if (native && l !== r) native(kind, l, r, p, st, aux);
  else JS[kind](l, r, p, st, aux);
}

/** 🧪 a JS-változat közvetlenül (a natív = JS összevetéshez) */
export function runKernelJs(kind: KernelKind, l: Float32Array, r: Float32Array, p: Float64Array, st: Float64Array, aux: Float32Array | null = null): void {
  if (l.length === 0) return;
  JS[kind](l, r, p, st, aux);
}
