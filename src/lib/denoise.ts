/**
 * 🧹 Spektrális zajszűrés (saját): rövid idejű Fourier-transzformáció 1024 mintás, gyök-Hann
 * ablakkal, 50% átfedéssel (tökéletes visszaállítás). A két csatorna EGY komplex FFT-ben megy
 * (bal = valós, jobb = képzetes rész): a valós, szimmetrikus maszk mindkettőre egyszerre hat —
 * negyedannyi munka, mint csatornánként 75% átfedéssel. A zajprofil bin-enként a halk keretek
 * teljesítményéből (a 15. percentilisből becsült átlag), a csillapítás Wiener-szerű túlvonással, legfeljebb
 * `maxReductionDb` (az ffmpeg `afftdn` alapértéke 12 dB), idő- és frekvencia-simítással (nincs
 * „zenélő zaj”). Az egész szakaszon egyszer fut (előmenet); az előnézet és az export ugyanazt
 * a kimenetet használja.
 */

const N = 1024;
const HOP = N / 2;

const tables = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();
function tablesFor(n: number) {
  let t = tables.get(n);
  if (!t) {
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    t = { rev, cos, sin };
    tables.set(n, t);
  }
  return t;
}

/** helyben számolt radix-2 FFT előre számolt táblákkal (`inverse`: skálázás nélkül) */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const p = i + k;
        const q = p + half;
        const ar = re[q] * wr - im[q] * wi;
        const ai = re[q] * wi + im[q] * wr;
        re[q] = re[p] - ar;
        im[q] = im[p] - ai;
        re[p] += ar;
        im[p] += ai;
      }
    }
  }
}

const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = Math.sin((Math.PI * (i + 0.5)) / N); // gyök-Hann: sin² 50%-on összegezve 1

/**
 * sztereó zajszűrés; a kimenet ugyanolyan hosszú. A telefon JS-motorján ~0,4 s egy hang-
 * másodpercre — ezért ~12 ms munka után mindig visszaadja a vezérlést (a felület folyékony marad).
 */
export async function denoiseStereo(l: Float32Array, r: Float32Array, maxReductionDb = 12): Promise<[Float32Array, Float32Array]> {
  let slice = Date.now();
  const breathe = async () => {
    if (Date.now() - slice > 12) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      slice = Date.now();
    }
  };
  const len = l.length;
  const frames = Math.ceil((len + N) / HOP);
  const bins = N / 2 + 1;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const load = (f: number) => {
    const start = f * HOP - N / 2;
    for (let i = 0; i < N; i++) {
      const s = start + i;
      const inside = s >= 0 && s < len;
      re[i] = inside ? l[s] * win[i] : 0;
      im[i] = inside ? r[s] * win[i] : 0;
    }
    fft(re, im);
  };
  /** a két csatorna átlagos teljesítménye a k. binben (a csomagolt spektrumból) */
  const power = (k: number) => {
    const j = (N - k) % N;
    // X_L = (Z[k] + conj Z[N−k]) / 2, X_R = (Z[k] − conj Z[N−k]) / 2i
    const lr = (re[k] + re[j]) / 2;
    const li = (im[k] - im[j]) / 2;
    const rr = (im[k] + im[j]) / 2;
    const ri = (re[j] - re[k]) / 2;
    return (lr * lr + li * li + rr * rr + ri * ri) / 2;
  };
  // 1. menet: zajprofil minden 2. keretből — bin-enként a teljesítmény 15. percentilise
  const sampled: Float32Array[] = [];
  for (let f = 0; f < frames; f += 2) {
    await breathe();
    load(f);
    const p = new Float32Array(bins);
    for (let k = 0; k < bins; k++) p[k] = power(k);
    sampled.push(p);
  }
  const noise = new Float64Array(bins);
  const col = new Float32Array(sampled.length);
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < sampled.length; f++) col[f] = sampled[f][k];
    col.sort();
    // a zaj teljesítménye bin-enként exponenciális eloszlású: a 15. percentilis = −ln(0,85)·átlag
    noise[k] = col[Math.floor(sampled.length * 0.15)] / 0.1625;
  }
  // 2. menet: maszk + visszaalakítás (átlapolt összeadás)
  const floor = Math.pow(10, -maxReductionDb / 20);
  const outL = new Float64Array(len + 2 * N);
  const outR = new Float64Array(len + 2 * N);
  const prev = new Float64Array(bins).fill(1);
  const g = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    await breathe();
    load(f);
    for (let k = 0; k < bins; k++) {
      const p = power(k);
      // Wiener-szerű túlvonás a teljesítményben (a zaj átlagának kétszerese)
      const raw = p > 0 ? 1 - (2 * noise[k]) / p : 0;
      g[k] = Math.max(floor, Math.sqrt(Math.max(0, raw)));
    }
    for (let k = 0; k < bins; k++) {
      // frekvencia-simítás (3 bin) és időbeli simítás (lassú elengedés)
      const sm = (g[Math.max(0, k - 1)] + g[k] + g[Math.min(bins - 1, k + 1)]) / 3;
      const v = Math.max(sm, prev[k] * 0.5);
      prev[k] = v;
      re[k] *= v;
      im[k] *= v;
      if (k > 0 && k < N / 2) {
        re[N - k] *= v;
        im[N - k] *= v;
      }
    }
    fft(re, im, true);
    const start = f * HOP - N / 2 + N;
    for (let i = 0; i < N; i++) {
      outL[start + i] += (re[i] / N) * win[i];
      outR[start + i] += (im[i] / N) * win[i];
    }
  }
  const yl = new Float32Array(len);
  const yr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    yl[i] = outL[i + N];
    yr[i] = outR[i + N];
  }
  return [yl, yr];
}
