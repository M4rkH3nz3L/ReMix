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
 * ⚡ S20: a keretenkénti munka (FFT, teljesítmény / maszk, visszaalakítás) egy hívásban — a JS-változat és a natív
 * (`RemixRender.denoiseRun`, Swift / Kotlin) UGYANEZT számolja azonos sorrendben; a trigonometrikus táblákat és az
 * ablakot a JS adja át (`tabs` = cos | sin | rev | win), így a natív bitre egyezik (eszközön mérve).
 *
 * `params` = [N, HOP, len, f0, f1, step, floor, mód]; `state` = zajprofil (N/2+1) | az időbeli simítás állapota
 * (N/2+1). Mód 0 (profil): a `f0, f0+step, … < f1` keretek bin-teljesítménye sorban az `outL`-be (keretenként N/2+1
 * érték); mód 1 (alkalmazás): a `f0 … f1−1` keretek maszkolva, átlapoltan összeadva az `outL` / `outR`-be (a teljes
 * hossz + 2N).
 */
export type DenoiseRun = (l: Float32Array, r: Float32Array, tabs: Float64Array, state: Float64Array, outL: Float64Array, outR: Float64Array, params: Float64Array) => void;

let nativeRun: DenoiseRun | null = null;
/** a natív mag bekötése (`dspNativeClient`); null = a JS fut */
export function setNativeDenoise(fn: DenoiseRun | null): void {
  nativeRun = fn;
}
export const nativeDenoiseActive = (): boolean => nativeRun !== null;
/** 🧪 a bekötött natív mag (füstteszt: natív ↔ JS összevetés) */
export const getNativeDenoise = (): DenoiseRun | null => nativeRun;

/** a JS-oldali táblák egy tömbben: cos (N/2) | sin (N/2) | rev (N) | ablak (N) */
export function denoiseTabs(): Float64Array {
  const { rev, cos, sin } = tablesFor(N);
  const t = new Float64Array(N / 2 + N / 2 + N + N);
  t.set(cos, 0);
  t.set(sin, N / 2);
  for (let i = 0; i < N; i++) t[N + i] = rev[i];
  t.set(win, 2 * N);
  return t;
}

/** a JS-változat (a natív tükre; tesztben és natív nélkül ez fut) */
export function denoiseRunJs(l: Float32Array, r: Float32Array, tabs: Float64Array, state: Float64Array, outL: Float64Array, outR: Float64Array, params: Float64Array): void {
  const mode = params[7];
  const n = params[0];
  const hop = params[1];
  const len = params[2];
  const f0 = params[3];
  const f1 = params[4];
  const step = params[5];
  const floor = params[6];
  const half = n / 2;
  const bins = half + 1;
  const noise = state.subarray(0, bins);
  const prev = state.subarray(bins, 2 * bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const g = new Float64Array(bins);
  const fftT = (inverse: boolean) => {
    for (let i = 0; i < n; i++) {
      const j = tabs[n + i];
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
    for (let size = 2; size <= n; size <<= 1) {
      const hs = size >> 1;
      const st = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < hs; k++) {
          const wr = tabs[k * st];
          const wi = sign * tabs[half + k * st];
          const p = i + k;
          const q = p + hs;
          const ar = re[q] * wr - im[q] * wi;
          const ai = re[q] * wi + im[q] * wr;
          re[q] = re[p] - ar;
          im[q] = im[p] - ai;
          re[p] += ar;
          im[p] += ai;
        }
      }
    }
  };
  const load = (f: number) => {
    const start = f * hop - half;
    for (let i = 0; i < n; i++) {
      const s = start + i;
      const inside = s >= 0 && s < len;
      re[i] = inside ? l[s] * tabs[2 * n + i] : 0;
      im[i] = inside ? r[s] * tabs[2 * n + i] : 0;
    }
    fftT(false);
  };
  const power = (k: number) => {
    const j = (n - k) % n;
    // X_L = (Z[k] + conj Z[N−k]) / 2, X_R = (Z[k] − conj Z[N−k]) / 2i
    const lr = (re[k] + re[j]) / 2;
    const li = (im[k] - im[j]) / 2;
    const rr = (im[k] + im[j]) / 2;
    const ri = (re[j] - re[k]) / 2;
    return (lr * lr + li * li + rr * rr + ri * ri) / 2;
  };
  if (mode === 0) {
    let at = 0;
    for (let f = f0; f < f1; f += step) {
      load(f);
      for (let k = 0; k < bins; k++) outL[at++] = power(k);
    }
    return;
  }
  for (let f = f0; f < f1; f++) {
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
      if (k > 0 && k < half) {
        re[n - k] *= v;
        im[n - k] *= v;
      }
    }
    fftT(true);
    const start = f * hop - half + n;
    for (let i = 0; i < n; i++) {
      outL[start + i] += (re[i] / n) * tabs[2 * n + i];
      outR[start + i] += (im[i] / n) * tabs[2 * n + i];
    }
  }
}

/**
 * sztereó zajszűrés; a kimenet ugyanolyan hosszú. A natív mag (ha van) a keretenkénti munkát végzi, a JS a
 * zajprofil rendezését; darabokban fut, közben visszaadja a vezérlést (a felület folyékony marad).
 */
export async function denoiseStereo(l: Float32Array, r: Float32Array, maxReductionDb = 12): Promise<[Float32Array, Float32Array]> {
  const run = nativeRun ?? denoiseRunJs;
  const chunk = nativeRun ? 2048 : 64;
  const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));
  const len = l.length;
  const frames = Math.ceil((len + N) / HOP);
  const bins = N / 2 + 1;
  const tabs = denoiseTabs();
  const floor = Math.pow(10, -maxReductionDb / 20);
  // 1. menet: zajprofil minden 2. keretből — bin-enként a teljesítmény 15. percentilise
  const sampledCount = Math.ceil(frames / 2);
  const cols = Array.from({ length: bins }, () => new Float32Array(sampledCount));
  const empty = new Float64Array(0);
  const state = new Float64Array(2 * bins);
  let si = 0;
  for (let f0 = 0; f0 < frames; f0 += chunk * 2) {
    const f1 = Math.min(frames, f0 + chunk * 2);
    const cnt = Math.ceil((f1 - f0) / 2);
    const buf = new Float64Array(cnt * bins);
    run(l, r, tabs, state, buf, empty, Float64Array.of(N, HOP, len, f0, f1, 2, floor, 0));
    for (let j = 0; j < cnt; j++) for (let k = 0; k < bins; k++) cols[k][si + j] = buf[j * bins + k];
    si += cnt;
    await breathe();
  }
  const noise = state.subarray(0, bins);
  for (let k = 0; k < bins; k++) {
    const col = cols[k];
    col.sort();
    // a zaj teljesítménye bin-enként exponenciális eloszlású: a 15. percentilis = −ln(0,85)·átlag
    noise[k] = col[Math.floor(sampledCount * 0.15)] / 0.1625;
  }
  // 2. menet: maszk + visszaalakítás (átlapolt összeadás)
  const outL = new Float64Array(len + 2 * N);
  const outR = new Float64Array(len + 2 * N);
  state.fill(1, bins); // az időbeli simítás 1-ről indul
  for (let f0 = 0; f0 < frames; f0 += chunk) {
    run(l, r, tabs, state, outL, outR, Float64Array.of(N, HOP, len, f0, Math.min(frames, f0 + chunk), 1, floor, 1));
    await breathe();
  }
  const yl = new Float32Array(len);
  const yr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    yl[i] = outL[i + N];
    yr[i] = outR[i + N];
  }
  return [yl, yr];
}
